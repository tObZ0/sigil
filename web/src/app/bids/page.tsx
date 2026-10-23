"use client";

import Link from "next/link";
import { useState } from "react";
import { Coin, PHASE_LABEL, SEAL_STATE } from "@/components/bits";
import { WaxSeal } from "@/components/wax-seal";
import { chain, RELAY_ADDRESS } from "@/lib/chain";
import { eth } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { fetchBid, fetchLaunch, type Bid, type Launch } from "@/lib/relay";
import { downloadTicket, loadTickets, parseTicket, saveTicket, type Ticket } from "@/lib/tickets";
import { useWallet } from "@/lib/wallet";

type Row = { t: Ticket; l: Launch | null; b: Bid | null };

function todo(r: Row): string {
  if (!r.l || !r.b) return "";
  const { l, b } = r;
  if (l.phase === "sealing") return "Sealed. Wait for the seal to break.";
  if (l.phase === "revealing") return b.revealed ? "Opened. Waiting for settlement." : "Reveal now, before the window closes.";
  if (l.phase === "settling") return "Ready to settle.";
  if (b.claimed) return l.phase === "live" ? "Tokens claimed." : "ETH returned.";
  return l.phase === "live" ? "Claim your tokens." : "Claim your ETH back.";
}

export default function BidsPage() {
  const w = useWallet();
  const [msg, setMsg] = useState<string | null>(null);

  const load = async (): Promise<Row[]> => {
    const mine = loadTickets().filter((t) => t.chainId === chain.id && t.relay.toLowerCase() === RELAY_ADDRESS.toLowerCase());
    const out = await Promise.all(
      mine.map(async (t) => {
        const l = await fetchLaunch(t.launchId).catch(() => null);
        const b = l ? await fetchBid(t.launchId, t.bidder).catch(() => null) : null;
        return { t, l, b };
      }),
    );
    // Tickets whose seal never landed (rejected or failed tx) aren't bids.
    return out.filter((r) => r.b && r.b.commitment !== `0x${"0".repeat(64)}`).sort((a, b) => b.t.sealedAt - a.t.sealedAt);
  };
  const { data: rows, refresh } = usePoll(load, 15_000, [w.account]);

  return (
    <>
      <header style={{ padding: "56px 0 30px" }}>
        <span className="kicker">Kept in this browser</span>
        <h1 style={{ marginTop: 16 }}>
          My <em>bids</em>
        </h1>
        <p className="lede">
          Every bid you seal leaves its secret here and in a file you download. Nothing is sent to a server: lose both, and
          that bid can&rsquo;t be revealed.
        </p>
        <label className="btn ghost" style={{ marginTop: 22 }}>
          Load a reveal key
          <input
            type="file"
            accept="application/json,.json"
            hidden
            multiple
            onChange={async (e) => {
              let n = 0;
              for (const f of Array.from(e.target.files ?? [])) {
                const t = parseTicket(await f.text());
                if (t) {
                  saveTicket(t);
                  n++;
                }
              }
              setMsg(n ? `Loaded ${n} reveal key${n === 1 ? "" : "s"}.` : "That isn't a Sigil reveal key.");
              refresh();
            }}
          />
        </label>
        {msg ? <p className="hint">{msg}</p> : null}
      </header>

      {rows === null ? (
        <div className="skeleton" />
      ) : rows.length === 0 ? (
        <div className="empty">
          No bids yet. <Link href="/">Find a sealed launch →</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((r) => (
            <div key={`${r.t.launchId}-${r.t.bidder}`} className="card" style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 18, alignItems: "center" }}>
              <div style={{ width: 64 }}>{r.l ? <WaxSeal seed={r.l.token} letter={r.l.symbol} state={SEAL_STATE[r.l.phase]} /> : null}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {r.l ? <Coin l={r.l} /> : null}
                  <b>
                    {r.l?.name ?? `Launch #${r.t.launchId}`} <span className="muted">${r.t.symbol}</span>
                  </b>
                  {r.l ? <span className="pill">{PHASE_LABEL[r.l.phase]}</span> : null}
                </div>
                <div className="hint mono" style={{ marginTop: 6 }}>
                  bid {eth(BigInt(r.t.amount))} ETH · deposit {eth(BigInt(r.t.deposit))} ETH · from {r.t.bidder.slice(0, 8)}…
                </div>
                <div style={{ marginTop: 4, fontWeight: 600, color: "var(--brand)" }}>{todo(r)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="btn ghost sm" onClick={() => downloadTicket(r.t)}>
                  File
                </button>
                <Link href={`/l/${r.t.launchId}`} className="btn sm">
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
