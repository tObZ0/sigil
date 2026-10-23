"use client";

import Link from "next/link";
import { DEPLOYED } from "@/lib/chain";
import { eth, short, tokens } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { fetchWire, type Wire } from "@/lib/relay";

function line(w: Wire) {
  switch (w.kind) {
    case "sealed":
      return (
        <>
          <b>Sealed</b> {short(w.who)} sealed a bid on <u>${w.symbol}</u> · {eth(w.eth, 3)} ETH deposit
        </>
      );
    case "revealed":
      return (
        <>
          <b>Revealed</b> {short(w.who)} revealed {eth(w.eth, 3)} ETH on <u>${w.symbol}</u>
        </>
      );
    case "swap":
      return (
        <>
          <b>{w.buy ? "Bought" : "Sold"}</b> {short(w.who)} {w.buy ? "bought" : "sold"} {tokens(w.tokens)} <u>${w.symbol}</u> for {eth(w.eth, 3)} ETH
        </>
      );
  }
}

/** A quiet strip of the latest on-chain events. Two copies scroll as one seamless loop. */
export function Tape() {
  const { data } = usePoll(() => (DEPLOYED ? fetchWire() : Promise.resolve([])), 20_000);
  if (!data || data.length === 0) return null;
  const items = data.map((w, i) => (
    <Link key={`${w.tx}-${w.kind}-${i}`} href={`/l/${w.launchId}`} className="tape-item">
      {line(w)}
    </Link>
  ));
  const seconds = Math.max(30, data.length * 7);
  return (
    <div className="tape" aria-label="Latest activity">
      <span className="tape-live">
        <i /> Live
      </span>
      <div className="tape-window">
        <div className="tape-track" style={{ animationDuration: `${seconds}s` }}>
          <div className="tape-run">{items}</div>
          <div className="tape-run" aria-hidden>
            {items}
          </div>
        </div>
      </div>
    </div>
  );
}
