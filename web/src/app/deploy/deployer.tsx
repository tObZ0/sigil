"use client";

import { useState } from "react";
import { createPublicClient, createWalletClient, custom, http, numberToHex, parseEther, type Address, type Chain, type EIP1193Provider } from "viem";
import { IS_LOCAL, localChain, robinhood } from "@/lib/chain";
import { LAUNCHPAD_BYTECODE, LAUNCHPAD_CONSTRUCTOR } from "@/lib/deploy-bytecode";
import { eth } from "@/lib/format";
import { explain } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

const LAUNCH_FEE = parseEther("0.0005");

type Target = { key: "robinhoodMainnet" | "localhost"; chain: Chain };
const TARGETS: Target[] = [{ key: "robinhoodMainnet", chain: robinhood }, ...(IS_LOCAL ? [{ key: "localhost" as const, chain: localChain }] : [])];

type Done = { address: Address; block: number; tx: `0x${string}`; saved: string | null };

export function Deployer() {
  const { wallets } = useWallet();
  const [target, setTarget] = useState<Target>(TARGETS[0]!);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const pub = createPublicClient({ chain: target.chain, transport: http() });
  const onChain = chainId === target.chain.id;

  async function refresh(p: EIP1193Provider, a: Address) {
    const id = Number(await p.request({ method: "eth_chainId" }));
    setChainId(id);
    setBalance(id === target.chain.id ? await pub.getBalance({ address: a }) : null);
  }

  async function connect(p: EIP1193Provider) {
    setError(null);
    try {
      const [a] = (await p.request({ method: "eth_requestAccounts" })) as Address[];
      if (!a) return;
      setProvider(p);
      setAccount(a);
      p.on("chainChanged", () => void refresh(p, a));
      p.on("accountsChanged", (x: unknown) => {
        const next = (x as Address[])[0] ?? null;
        setAccount(next);
        if (next) void refresh(p, next);
      });
      await refresh(p, a);
    } catch (e) {
      setError(explain(e));
    }
  }

  async function switchChain() {
    if (!provider || !account) return;
    setError(null);
    const c = target.chain;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(c.id) }] });
    } catch {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: numberToHex(c.id),
              chainName: c.name,
              nativeCurrency: c.nativeCurrency,
              rpcUrls: c.rpcUrls.default.http,
              blockExplorerUrls: c.blockExplorers ? [c.blockExplorers.default.url] : undefined,
            },
          ],
        });
      } catch (e) {
        return setError(explain(e));
      }
    }
    await refresh(provider, account);
  }

  async function deploy() {
    if (!provider || !account) return;
    setError(null);
    setBusy("Confirm the deploy in your wallet…");
    try {
      const wallet = createWalletClient({ account, chain: target.chain, transport: custom(provider) });
      const tx = await wallet.deployContract({ abi: LAUNCHPAD_CONSTRUCTOR, bytecode: LAUNCHPAD_BYTECODE, args: [account, LAUNCH_FEE] });
      setBusy("Waiting for the block…");
      const r = await pub.waitForTransactionReceipt({ hash: tx });
      if (r.status !== "success" || !r.contractAddress) throw new Error("The deploy transaction failed on-chain.");
      const code = await pub.getCode({ address: r.contractAddress });
      if (!code || code === "0x") throw new Error("No contract code at the new address.");
      const block = Number(r.blockNumber);
      const res = await fetch("/api/dev/deployment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: target.key, address: r.contractAddress, block, tx }),
      }).catch(() => null);
      const saved = res?.ok ? ((await res.json()) as { saved: string }).saved : null;
      setDone({ address: r.contractAddress, block, tx, saved });
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  const explorer = target.chain.blockExplorers?.default.url;
  const injected = typeof window !== "undefined" ? (window as unknown as { ethereum?: EIP1193Provider }).ethereum : undefined;

  return (
    <>
      <header style={{ padding: "56px 0 20px" }}>
        <span className="kicker">Local tool · not part of the live site</span>
        <h1 style={{ marginTop: 16 }}>Deploy SigilLaunchpad</h1>
        <p className="lede">
          You sign the deploy in your own wallet, so its key never leaves it. The connected wallet becomes the fee
          recipient, and this can&rsquo;t be changed later.
        </p>
      </header>

      <div className="card" style={{ maxWidth: 640 }}>
        {TARGETS.length > 1 ? (
          <div className="field">
            <label>Network</label>
            <div className="choice">
              {TARGETS.map((t) => (
                <button key={t.key} type="button" aria-pressed={target.key === t.key} disabled={!!busy || !!done} onClick={() => setTarget(t)}>
                  {t.chain.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <table className="kv">
          <tbody>
            <tr>
              <td>Network</td>
              <td className="r">
                {target.chain.name} · chain {target.chain.id}
              </td>
            </tr>
            <tr>
              <td>Deployer and fee recipient</td>
              <td className="r mono">{account ?? "not connected"}</td>
            </tr>
            <tr>
              <td>Balance</td>
              <td className="r mono">{balance === null ? "—" : `${eth(balance)} ETH`}</td>
            </tr>
            <tr>
              <td>Launch fee</td>
              <td className="r mono">{eth(LAUNCH_FEE)} ETH</td>
            </tr>
          </tbody>
        </table>

        {error ? <p className="err">{error}</p> : null}

        {done ? (
          <div className="notice" style={{ marginTop: 16 }}>
            <b>Deployed.</b> SigilLaunchpad is at <span className="mono">{done.address}</span>, block {done.block}.
            {explorer ? (
              <>
                {" "}
                <a href={`${explorer}/address/${done.address}`} target="_blank" rel="noreferrer">
                  View on the explorer
                </a>
                .
              </>
            ) : null}
            <br />
            {done.saved ? `Saved to ${done.saved}.` : "Couldn't save the deployment file. Copy the address and block above."}
          </div>
        ) : !account ? (
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {wallets.map((w) => (
              <button key={w.info.uuid} className="btn block" onClick={() => connect(w.provider)}>
                Connect {w.info.name}
              </button>
            ))}
            {!wallets.length && injected ? (
              <button className="btn block" onClick={() => connect(injected)}>
                Connect wallet
              </button>
            ) : null}
            {!wallets.length && !injected ? <p className="notice">No wallet found. Open this page in a browser with Rabby or MetaMask.</p> : null}
          </div>
        ) : !onChain ? (
          <button className="btn block" style={{ marginTop: 16 }} onClick={switchChain}>
            Switch wallet to {target.chain.name}
          </button>
        ) : (
          <button className="btn block" style={{ marginTop: 16 }} disabled={!!busy || !balance} onClick={deploy}>
            {busy ?? "Deploy SigilLaunchpad"}
          </button>
        )}
      </div>
    </>
  );
}
