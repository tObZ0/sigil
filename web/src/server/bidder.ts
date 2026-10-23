import { concat, createWalletClient, http, keccak256, numberToHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { erc20Abi, relayAbi } from "@/lib/abi";
import { chain, publicClient, RELAY_ADDRESS } from "@/lib/chain";
import { chainNow, fetchBid, fetchLaunch } from "@/lib/relay";
import { commitmentOf } from "@/lib/tickets";
import { cfg } from "./config";
import { db, type OrderStatus, type ZecOrder } from "./db";
import { formatEth } from "./money";
import { coverFor } from "./quote";

/*
 * The only code that spends. For every paid ZEC order it walks one bidding
 * wallet through the launch: fund → seal → reveal → (settle) → claim →
 * deliver. Each order gets its own wallet because the launchpad takes one
 * sealed bid per wallet; on-chain they all look like "a Sigil bidder".
 *
 * Every step first checks the chain for its own result, so a crash between
 * sending and recording never sends twice. Anything that can't be resolved
 * that way stops at "attention" for a person, never a blind retry.
 */

/** The bidding wallet for an order slot, derived from ORDER_KEY_SEED. Nothing to store, nothing to lose but the seed. */
export function bidderAccount(slot: bigint): PrivateKeyAccount {
  const key = keccak256(concat([cfg().relayer.orderSeed, numberToHex(slot, { size: 32 })]));
  return privateKeyToAccount(key);
}

function hotAccount(): PrivateKeyAccount {
  return privateKeyToAccount(cfg().relayer.hotKey);
}

function wallet(account: PrivateKeyAccount) {
  return createWalletClient({ account, chain, transport: http() });
}

async function confirm(hash: Hex) {
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return r;
}

async function set(order: ZecOrder, fields: Record<string, string | bigint | null>, status?: OrderStatus) {
  const sql = db();
  const merged = { ...fields, ...(status ? { status } : {}) };
  await sql`update zec_orders set ${sql(merged)}, updated_at = now() where id = ${order.id}`;
  Object.assign(order, merged);
}

async function attention(order: ZecOrder, note: string) {
  console.error(`order ${order.id}: ${note}`);
  await set(order, { note }, "attention");
}

/** Cost of one plain ETH transfer, with headroom. */
async function transferCost(): Promise<bigint> {
  const price = await publicClient.getGasPrice();
  return price * 21_000n * 2n;
}

/** Advances one order by as many steps as the chain allows right now. */
export async function advance(order: ZecOrder): Promise<void> {
  // Loop so a quick order goes paid → funded → sealed in one tick.
  for (let i = 0; i < 8; i++) {
    const before = order.status;
    await step(order);
    if (order.status === before) return;
  }
}

async function step(order: ZecOrder): Promise<void> {
  const launch = await fetchLaunch(order.launch_id);
  if (!launch) return attention(order, `Launch #${order.launch_id} not found.`);
  const r = cfg().relayer;
  const me = bidderAccount(order.slot);
  const bid = BigInt(order.final_bid_wei ?? "0");

  switch (order.status) {
    case "paid": {
      const now = await chainNow();
      if (launch.phase !== "sealing" || launch.sealEnd - now < 60) {
        return attention(order, "The ZEC arrived after this launch stopped taking sealed bids. Refund it to the refund address.");
      }
      const cover = coverFor(bid, Math.random());
      const need = bid + cover + r.bidderGas;
      const hot = hotAccount();
      const float = await publicClient.getBalance({ address: hot.address });
      if (float - r.reserve < need) {
        // Not an error: the order waits for the float to be topped up.
        if (!order.note?.startsWith("Waiting")) await set(order, { note: `Waiting for Sigil's float: needs ${formatEth(need)} ETH.` });
        return;
      }
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      // Record the plan before sending, so a restart knows a transfer may be out.
      await set(order, { bidder: me.address, salt, cover_wei: cover.toString(), note: null }, "funding");
      const hash = await wallet(hot).sendTransaction({ to: me.address, value: need });
      await set(order, { fund_tx: hash });
      await confirm(hash);
      return set(order, {}, "funded");
    }

    case "funding": {
      // Interrupted between sending and recording. The balance says whether it landed.
      const need = bid + BigInt(order.cover_wei ?? "0");
      const have = await publicClient.getBalance({ address: me.address });
      if (have >= need) return set(order, {}, "funded");
      if (order.fund_tx) {
        const receipt = await publicClient.getTransactionReceipt({ hash: order.fund_tx as Hex }).catch(() => null);
        if (!receipt) return; // still pending
      }
      return attention(order, "Funding the bidding wallet didn't land. Check the hot wallet before retrying.");
    }

    case "funded": {
      const existing = await fetchBid(order.launch_id, me.address);
      if (existing.commitment !== `0x${"0".repeat(64)}`) return set(order, {}, "sealed");
      if (launch.phase !== "sealing") return attention(order, "Funded, but the seal broke before the bid went in. Sweep the bidding wallet and refund.");
      const cover = BigInt(order.cover_wei ?? "0");
      const hash = await wallet(me).writeContract({
        address: RELAY_ADDRESS,
        abi: relayAbi,
        functionName: "seal",
        args: [BigInt(order.launch_id), commitmentOf(order.launch_id, me.address, bid, order.salt as Hex)],
        value: bid + cover,
      });
      await set(order, { seal_tx: hash });
      await confirm(hash);
      return set(order, {}, "sealed");
    }

    case "sealed": {
      const b = await fetchBid(order.launch_id, me.address);
      if (b.revealed) return set(order, {}, "revealed");
      if (launch.phase === "sealing") return; // wait for the seal to break
      if (launch.phase !== "revealing") return attention(order, "The reveal window closed before this bid was revealed. It loses 10% if the launch goes live.");
      const hash = await wallet(me).writeContract({
        address: RELAY_ADDRESS,
        abi: relayAbi,
        functionName: "reveal",
        args: [BigInt(order.launch_id), bid, order.salt as Hex],
      });
      await set(order, { reveal_tx: hash });
      await confirm(hash);
      return set(order, {}, "revealed");
    }

    case "revealed": {
      if (launch.phase === "sealing" || launch.phase === "revealing") return;
      if (launch.phase === "settling") {
        // Anyone can settle. If nobody has, Sigil does it from its own wallet.
        try {
          const hash = await wallet(hotAccount()).writeContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "settle", args: [BigInt(order.launch_id)] });
          await set(order, { settle_tx: hash });
          await confirm(hash);
        } catch (e) {
          if (!String(e).includes("WrongPhase")) throw e; // someone else settled first: fine
        }
        return;
      }
      const b = await fetchBid(order.launch_id, me.address);
      if (!b.claimed) {
        const hash = await wallet(me).writeContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "claim", args: [BigInt(order.launch_id)] });
        await set(order, { claim_tx: hash });
        await confirm(hash);
      }
      return set(order, {}, "claimed");
    }

    case "claimed": {
      const dest = order.dest_address as Address | null;
      if (!dest) return attention(order, "No destination address on this order.");
      const w = wallet(me);
      if (launch.phase === "live") {
        if (!order.deliver_tx) {
          const tokens = (await publicClient.readContract({ address: launch.token, abi: erc20Abi, functionName: "balanceOf", args: [me.address] })) as bigint;
          if (tokens > 0n) {
            const hash = await w.writeContract({ address: launch.token, abi: erc20Abi, functionName: "transfer", args: [dest, tokens] });
            await set(order, { deliver_tx: hash, tokens_out: tokens.toString() });
            await confirm(hash);
          } else await set(order, { deliver_tx: "none", tokens_out: "0" });
        }
        if (!order.drip_tx) {
          const hash = await w.sendTransaction({ to: dest, value: r.drip });
          await set(order, { drip_tx: hash });
          await confirm(hash);
        }
      } else {
        // Returned launch: the bid came back to the bidding wallet. It goes on to the bidder, with the drip.
        if (!order.refund_tx) {
          const amount = bid + r.drip;
          const hash = await w.sendTransaction({ to: dest, value: amount });
          await set(order, { refund_tx: hash, refund_wei: amount.toString() });
          await confirm(hash);
        }
      }
      // Whatever's left (cover, unused gas) goes back to Sigil's float.
      if (!order.sweep_tx) {
        const left = (await publicClient.getBalance({ address: me.address })) - (await transferCost());
        if (left > 0n) {
          const hash = await w.sendTransaction({ to: hotAccount().address, value: left });
          await set(order, { sweep_tx: hash });
          await confirm(hash);
        } else await set(order, { sweep_tx: "none" });
      }
      return set(order, {}, launch.phase === "live" ? "delivered" : "refunded");
    }
  }
}
