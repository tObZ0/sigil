"use client";

import Link from "next/link";
import type { Launch, Phase } from "@/lib/relay";
import { countdown, eth, price } from "@/lib/format";
import { WaxSeal, type SealState } from "./wax-seal";

export const SEAL_STATE: Record<Phase, SealState> = {
  sealing: "intact",
  revealing: "cracked",
  settling: "cracked",
  live: "open",
  failed: "dull",
};

export const PHASE_LABEL: Record<Phase, string> = {
  sealing: "Sealed",
  revealing: "Revealing",
  settling: "Settling",
  live: "Live",
  failed: "Returned",
};

/** The phase as a small pill: a purple dot while bidding is open, grey once it's over. */
export function StatusPill({ phase }: { phase: Phase }) {
  return (
    <span className={`status status-${phase}`}>
      <i />
      {PHASE_LABEL[phase]}
    </span>
  );
}

/**
 * A price in ETH. Tiny prices keep their zero count as a real subscript
 * element: the Unicode subscript digits render full size in some fonts, and
 * 0.0₈4 must never read as 0.084.
 */
export function Price({ value }: { value: number }) {
  const s = price(value);
  const m = s.match(/^0\.0([₀-₉]+)(\d+)$/);
  if (!m) return <>{s}</>;
  const zeros = Array.from(m[1]!, (c) => c.charCodeAt(0) - 0x2080).join("");
  return (
    <span title={`${value.toExponential(3)} ETH`}>
      0.0<sub style={{ fontSize: "0.6em", verticalAlign: "-0.15em" }}>{zeros}</sub>
      {m[2]}
    </span>
  );
}

export function Coin({ l, className }: { l: Pick<Launch, "meta" | "symbol">; className?: string }) {
  return l.meta.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={l.meta.image} alt="" className={className ?? "coin"} />
  ) : (
    <span className={`${className ?? "coin"} coin-text`}>{l.symbol.slice(0, 3)}</span>
  );
}

function headline(l: Launch, now: number | null): { a: string; b: string; c: string; d: string } {
  const left = (t: number) => (now === null ? "—" : countdown(t - now));
  switch (l.phase) {
    case "sealing":
      return { a: "Seal breaks in", b: left(l.sealEnd), c: "Bids", d: `${l.bidders} sealed` };
    case "revealing":
      return { a: "Reveal closes in", b: left(l.revealEnd), c: "Opened", d: `${l.reveals} of ${l.bidders}` };
    case "settling":
      return { a: "Raised", b: `${eth(l.raised)} ETH`, c: "Status", d: "Ready to settle" };
    case "live":
      return { a: "Raised", b: `${eth(l.raised)} ETH`, c: "Pool", d: `${eth(l.ethReserve, 2)} ETH` };
    case "failed":
      return { a: "Raised", b: `${eth(l.raised)} ETH`, c: "Needed", d: `${eth(l.minRaise)} ETH` };
  }
}

export function EnvelopeCard({ l, now }: { l: Launch; now: number | null }) {
  const h = headline(l, now);
  const opened = l.bidders ? l.reveals / l.bidders : 0;
  return (
    <Link href={`/l/${l.id}`} className="lcard">
      <div className="lcard-head">
        <Coin l={l} />
        <div className="lcard-name">
          <h3>{l.name}</h3>
          <span>${l.symbol}</span>
        </div>
        <div className="lcard-seal" aria-hidden>
          <WaxSeal seed={l.token} letter={l.symbol} state={SEAL_STATE[l.phase]} bold />
        </div>
      </div>
      <p className="lcard-desc">{l.meta.description || "No description."}</p>
      <div className="lcard-status">
        <StatusPill phase={l.phase} />
        {l.phase === "revealing" || l.phase === "settling" ? (
          <span className="progress" title={`${l.reveals} of ${l.bidders} opened`}>
            <i style={{ width: `${Math.round(opened * 100)}%` }} />
          </span>
        ) : null}
      </div>
      <div className="lcard-stats">
        <div>
          <span>{h.a}</span>
          <b className="mono">{h.b}</b>
        </div>
        <div>
          <span>{h.c}</span>
          <b className="mono">{h.d}</b>
        </div>
      </div>
    </Link>
  );
}
