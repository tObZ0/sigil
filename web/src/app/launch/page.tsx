"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { decodeEventLog, parseEther } from "viem";
import { EnvelopeCard } from "@/components/bits";
import { relayAbi } from "@/lib/abi";
import { chain, publicClient, RELAY_ADDRESS } from "@/lib/chain";
import { duration, eth } from "@/lib/format";
import type { Launch } from "@/lib/relay";
import { explain } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

const SEALS = [3600, 6 * 3600, 24 * 3600, 3 * 86400];
const REVEALS = [3600, 6 * 3600, 24 * 3600];

/** Squeeze an image into a small square WebP data URI, so it fits in the launch itself. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const size = 160;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const s = Math.min(bmp.width, bmp.height);
  g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const url = c.toDataURL("image/webp", q);
    if (url.length < 20_000) return url;
  }
  return c.toDataURL("image/jpeg", 0.5);
}

export default function CreatePage() {
  const w = useWallet();
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [seal, setSeal] = useState(SEALS[2]!);
  const [reveal, setReveal] = useState(REVEALS[1]!);
  const [minRaise, setMinRaise] = useState("1");
  const [fee, setFee] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicClient
      .readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "launchFee" })
      .then((f) => setFee(f as bigint))
      .catch(() => {});
  }, []);

  let minWei = 0n;
  try {
    minWei = parseEther(minRaise || "0");
  } catch {}
  const problems = [
    !name.trim() && "Give it a name.",
    !symbol && "Give it a ticker.",
    minWei < parseEther("0.01") && "The minimum raise is at least 0.01 ETH.",
  ].filter(Boolean) as string[];

  const preview: Launch = {
    id: 0,
    token: `0x${Array.from(name + symbol || "relay").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(40, "0")}`,
    creator: "0x0000000000000000000000000000000000000000",
    name: name || "Your token",
    symbol: symbol || "TICKER",
    meta: { description: description || "What's it about? One or two lines.", image, x, telegram, website },
    sealEnd: 0,
    revealEnd: 0,
    minRaise: minWei,
    deposits: 0n,
    raised: 0n,
    bidders: 0,
    reveals: 0,
    phase: "sealing",
    ethReserve: 0n,
    tokenReserve: 0n,
  };

  async function submit() {
    if (!w.client || !w.account || fee === null) return;
    setError(null);
    setBusy("Confirm in your wallet…");
    try {
      const meta = JSON.stringify({ description: description.trim(), image, x: x.trim(), telegram: telegram.trim(), website: website.trim() });
      const hash = await w.client.writeContract({
        address: RELAY_ADDRESS,
        abi: relayAbi,
        functionName: "createLaunch",
        args: [name.trim(), symbol, meta, BigInt(seal), BigInt(reveal), minWei],
        value: fee,
        account: w.client.account!,
        chain,
      });
      setBusy("Pressing the seal…");
      const r = await publicClient.waitForTransactionReceipt({ hash });
      for (const log of r.logs) {
        try {
          const ev = decodeEventLog({ abi: relayAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "LaunchCreated") return router.push(`/l/${(ev.args as { id: bigint }).id}`);
        } catch {}
      }
      router.push("/");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header style={{ padding: "56px 0 30px" }}>
        <span className="kicker">New launch</span>
        <h1 style={{ marginTop: 16 }}>
          Press your <em>seal.</em>
        </h1>
        <p className="lede">
          Your token opens with a sealed window. Bids stay hidden, open together, and everyone pays one price. No presale, no
          team allocation, no snipers.
        </p>
      </header>

      <div className="create">
        <div className="card">
          <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
            <label className="img-drop">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="Token image" />
              ) : (
                <span>
                  Add image
                  <br />
                  square works best
                </span>
              )}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setImage(await shrink(f));
                }}
              />
            </label>
            <p className="hint" style={{ maxWidth: 300 }}>
              Stored inside the launch itself, on-chain. No upload server, nothing to go missing.
            </p>
          </div>

          <div className="two">
            <div className="field">
              <label htmlFor="n">
                Name <small>{name.length}/32</small>
              </label>
              <input id="n" className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Night Heron" />
            </div>
            <div className="field">
              <label htmlFor="s">
                Ticker <small>{symbol.length}/10</small>
              </label>
              <input
                id="s"
                className="input mono"
                maxLength={10}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="HERON"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="d">
              Description <small>{description.length}/280</small>
            </label>
            <textarea id="d" className="textarea" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's it about?" />
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="x">
                X <small>optional</small>
              </label>
              <input id="x" className="input" value={x} onChange={(e) => setX(e.target.value)} placeholder="@handle" />
            </div>
            <div className="field">
              <label htmlFor="tg">
                Telegram <small>optional</small>
              </label>
              <input id="tg" className="input" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/…" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="web">
              Website <small>optional</small>
            </label>
            <input id="web" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
          </div>

          <hr style={{ border: 0, borderTop: "1.5px dashed var(--line)", margin: "8px 0 20px" }} />

          <div className="field">
            <label>
              Sealed window <small>how long bids can be sealed</small>
            </label>
            <div className="choice">
              {SEALS.map((s) => (
                <button key={s} type="button" aria-pressed={seal === s} onClick={() => setSeal(s)}>
                  {duration(s)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>
              Reveal window <small>time for bidders to reveal their bids</small>
            </label>
            <div className="choice">
              {REVEALS.map((s) => (
                <button key={s} type="button" aria-pressed={reveal === s} onClick={() => setReveal(s)}>
                  {duration(s)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="min">
              Minimum raise <small>below this, every bid is returned</small>
            </label>
            <div className="input-row" style={{ maxWidth: 260 }}>
              <input id="min" className="input mono" inputMode="decimal" value={minRaise} onChange={(e) => setMinRaise(e.target.value.replace(/[^0-9.]/g, ""))} />
              <span>ETH</span>
            </div>
          </div>

          {error ? <p className="err">{error}</p> : null}
          {!w.account ? (
            <p className="notice">Connect a wallet to launch.</p>
          ) : w.wrongChain ? (
            <button className="btn block" onClick={() => w.switchChain()}>
              Switch to {chain.name}
            </button>
          ) : (
            <button className="btn block" disabled={problems.length > 0 || !!busy || fee === null} onClick={submit}>
              {busy ?? `Seal the launch${fee ? ` · ${eth(fee)} ETH fee` : ""}`}
            </button>
          )}
          {problems.length && (name || symbol) ? <p className="hint">{problems.join(" ")}</p> : null}
        </div>

        <aside className="panel">
          <span className="kicker" style={{ display: "block", marginBottom: 12 }}>
            Preview
          </span>
          <div style={{ pointerEvents: "none" }}>
            <EnvelopeCard l={preview} now={null} />
          </div>
          <div className="card" style={{ marginTop: 16, fontSize: 14 }}>
            <h3 style={{ fontSize: 22 }}>What happens</h3>
            <ol style={{ paddingLeft: 18, margin: "8px 0 0", color: "var(--ink-2)", display: "grid", gap: 6 }}>
              <li>Bids are sealed for {duration(seal)}.</li>
              <li>Bidders reveal over {duration(reveal)}.</li>
              <li>Under {minRaise || "0"} ETH raised: every bid is returned.</li>
              <li>Otherwise 500M tokens go to bidders at one price, and the raise seeds a locked pool.</li>
              <li>You earn 0.5% of the raise and half of every 1% swap fee, forever.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
