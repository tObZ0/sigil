import { getAddress, isAddress, parseEther } from "viem";
import { publicClient } from "@/lib/chain";
import { chainNow, fetchLaunch } from "@/lib/relay";
import { cfg } from "./config";
import { db, type OrderStatus, type ZecOrder } from "./db";
import { isOrderId, looksShielded, orderId } from "./ids";
import { formatEth, formatZec } from "./money";
import { currentRate, PriceUnavailable } from "./prices";
import { bidForPayment, quoteForBid, type Costs } from "./quote";
import { depositAddress } from "./zcash";

export function costs(): Costs {
  const r = cfg().relayer;
  return { feeBps: cfg().orders.feeBps, gas: r.bidderGas, drip: r.drip };
}

export type OrderForm = { launchId: string; bid: string; dest: string; refund: string };
export type FormErrors = Partial<Record<keyof OrderForm | "form", string>>;

/**
 * Opens a ZEC order: validates the form, locks a rate, and hands out a fresh
 * shielded address. The quote runs out a safe margin before the seal breaks,
 * so a payment that lands on time can always still be sealed.
 */
export async function openOrder(f: OrderForm): Promise<{ ok: true; id: string } | { ok: false; errors: FormErrors }> {
  const o = cfg().orders;
  const errors: FormErrors = {};

  const launchId = Number(f.launchId);
  const launch = Number.isInteger(launchId) && launchId >= 0 ? await fetchLaunch(launchId).catch(() => null) : null;
  if (!launch) errors.launchId = "Pick a launch.";

  let bid = 0n;
  try {
    bid = parseEther(f.bid.trim() as `${number}`);
  } catch {
    errors.bid = "Enter a bid in ETH, like 0.25.";
  }
  if (!errors.bid && (bid < o.minBid || bid > o.maxBid)) errors.bid = `Bids are ${formatEth(o.minBid)} to ${formatEth(o.maxBid)} ETH.`;

  const dest = f.dest.trim();
  if (!isAddress(dest, { strict: false })) errors.dest = "That isn't a Robinhood Chain address (0x and 40 characters).";
  else {
    const code = await publicClient.getCode({ address: getAddress(dest) }).catch(() => undefined);
    if (code && code !== "0x" && !code.startsWith("0xef0100")) errors.dest = "That's a contract. Use a wallet address you hold the key to.";
  }

  const refund = f.refund.trim();
  if (refund && !looksShielded(refund, cfg().zcash.network)) errors.refund = "Refunds go to a shielded address (u1… or zs1…), or leave it empty.";

  let expiresAt = new Date(0);
  if (launch) {
    const now = await chainNow();
    if (launch.phase !== "sealing") errors.launchId = "That launch isn't taking sealed bids any more.";
    else {
      const latest = (launch.sealEnd - o.sealMargin * 60) * 1000;
      const end = Math.min(Date.now() + o.quoteMinutes * 60_000, Date.now() + (latest - now * 1000));
      if (end - Date.now() < 5 * 60_000) errors.launchId = "This launch's seal breaks too soon for a ZEC payment to confirm. Pick another.";
      expiresAt = new Date(end);
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  let rate;
  try {
    rate = await currentRate();
  } catch (e) {
    return { ok: false, errors: { form: e instanceof PriceUnavailable ? "Prices are moving too fast to quote right now. Try again in a minute." : "Couldn't get a price. Try again in a minute." } };
  }
  const q = quoteForBid(bid, rate, costs());
  if (q.zat > o.maxZat) return { ok: false, errors: { bid: `That's more than ${formatZec(o.maxZat)} ZEC. Bid less.` } };

  const sql = db();
  const [{ slot }] = await sql<{ slot: bigint }[]>`select nextval('zec_slot') as slot`;
  const address = await depositAddress(slot);
  const id = orderId();
  await sql`
    insert into zec_orders (id, slot, deposit_address, status, expires_at, launch_id, symbol, dest_address,
                            refund_address, bid_wei, zat_requested, zec_usd, eth_usd)
    values (${id}, ${slot}, ${address}, 'awaiting', ${expiresAt}, ${launchId}, ${launch!.symbol}, ${getAddress(dest)},
            ${refund || null}, ${bid.toString()}, ${q.zat}, ${rate.zecUsd}, ${rate.ethUsd})`;
  return { ok: true, id };
}

export async function findOrder(id: string): Promise<ZecOrder | null> {
  if (!isOrderId(id)) return null;
  const [o] = await db()<ZecOrder[]>`select * from zec_orders where id = ${id}`;
  return o ?? null;
}

export function paymentsFor(slot: bigint) {
  return db()<{ txid: string; height: bigint; block_time: Date; zatoshis: bigint }[]>`
    select txid, height, block_time, zatoshis from payments where slot = ${slot} order by height`;
}

export interface Received {
  confirmed: bigint;
  pending: bigint;
  /** Confirmations of the shallowest payment. */
  depth: number;
}

export function received(payments: { height: bigint; zatoshis: bigint }[], tip: bigint | null, confirmations: number): Received {
  let confirmed = 0n;
  let pending = 0n;
  let depth = Infinity;
  for (const p of payments) {
    const confs = tip === null ? 0 : Number(tip - p.height + 1n);
    depth = Math.min(depth, Math.max(confs, 0));
    if (confs >= confirmations) confirmed += p.zatoshis;
    else pending += p.zatoshis;
  }
  return { confirmed, pending, depth: depth === Infinity ? 0 : depth };
}

// A payment sent in the last minute of a quote can land a block or two later.
const EXPIRY_GRACE_MS = 10 * 60_000;
// Wallets round. Within half a percent of the quote counts as paid in full.
const FULL_PAYMENT = 995n;

/**
 * Moves orders from waiting to paid based on what the Zcash chain shows.
 * Bookkeeping only: no money moves here; the bidder does that.
 */
export async function reconcile(tip: bigint | null): Promise<void> {
  if (tip === null) return;
  const sql = db();
  const open = await sql<ZecOrder[]>`
    select o.* from zec_orders o
    where o.status in ('awaiting', 'confirming')
       or (o.status = 'expired' and exists (select 1 from payments p where p.slot = o.slot))`;

  const now = Date.now();
  for (const order of open) {
    const payments = await paymentsFor(order.slot);
    const { confirmed, pending } = received(payments, tip, cfg().zcash.confirmations);
    const expired = now > order.expires_at.getTime();

    let next: OrderStatus = order.status;
    let note = order.note;
    let settled: bigint | null = null;
    let late = false;
    let bid: bigint | null = null;
    let fee: bigint | null = null;

    if (confirmed + pending === 0n) {
      if (now > order.expires_at.getTime() + EXPIRY_GRACE_MS) next = "expired";
    } else if (pending > 0n || (!expired && confirmed * 1000n < order.zat_requested * FULL_PAYMENT)) {
      next = "confirming"; // still arriving, or partly paid with time left
    } else {
      // Paid on time: the locked rate. Paid late: the rate now.
      late = payments.some((p) => p.block_time.getTime() > order.expires_at.getTime());
      const rate = late ? await currentRate().catch(() => null) : { zecUsd: order.zec_usd, ethUsd: order.eth_usd };
      if (!rate) continue; // no price right now; try again next tick
      const split = bidForPayment(confirmed, rate, costs());
      settled = confirmed;
      if (!split || split.bid < cfg().orders.minBid) {
        next = "attention";
        note = `Received ${formatZec(confirmed)} ZEC, too little for a ${formatEth(cfg().orders.minBid)} ETH bid after costs. Refund it.`;
      } else {
        next = "paid";
        bid = split.bid;
        fee = split.fee;
      }
    }

    if (next !== order.status || settled !== null) {
      await sql`
        update zec_orders set status = ${next}, note = ${note}, zat_settled = ${settled}, priced_late = ${late},
          final_bid_wei = ${bid === null ? null : bid.toString()}, fee_wei = ${fee === null ? null : fee.toString()},
          updated_at = now()
        where id = ${order.id} and status = ${order.status}`;
    }
  }
}

/** Forgets where tokens went once an order is closed and the bidder has had time to read it. */
export async function prune(): Promise<void> {
  await db()`
    update zec_orders set dest_address = null, refund_address = null, salt = null
    where status in ('delivered', 'refunded', 'expired')
      and dest_address is not null
      and updated_at < now() - make_interval(days => ${cfg().orders.retentionDays})`;
}
