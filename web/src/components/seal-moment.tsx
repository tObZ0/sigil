"use client";

import { useEffect, useState, type ReactNode } from "react";
import { WaxSeal } from "./wax-seal";

export type MomentKind = "sealed" | "opened" | "claimed";

const COPY: Record<MomentKind, { kicker: string; title: ReactNode }> = {
  sealed: { kicker: "Pressed", title: <>Your bid is <em>sealed.</em></> },
  opened: { kicker: "Opened", title: <>Your seal is <em>broken.</em></> },
  claimed: { kicker: "Delivered", title: <>It&rsquo;s <em>yours.</em></> },
};

/**
 * The full-screen beat after a transaction lands: wax pressing down on a
 * seal, cracking open on a reveal, a delivery stamp on a claim.
 */
export function SealMoment({
  kind,
  seed,
  symbol,
  children,
  onClose,
}: {
  kind: MomentKind;
  seed: string;
  symbol: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  // A reveal starts whole and breaks a beat later, so you see it happen.
  const [broken, setBroken] = useState(kind !== "opened");
  useEffect(() => {
    if (kind !== "opened") return;
    const t = setTimeout(() => setBroken(true), 750);
    return () => clearTimeout(t);
  }, [kind]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);

  const state = kind === "sealed" ? "intact" : kind === "opened" ? (broken ? "open" : "cracked") : "open";
  const c = COPY[kind];
  return (
    <div className="moment" role="dialog" aria-modal="true" aria-label={c.kicker} onClick={onClose}>
      <div className="moment-card" onClick={(e) => e.stopPropagation()}>
        <div className={`moment-seal ${kind}`}>
          {kind === "sealed" ? <i className="moment-ripple" /> : null}
          <WaxSeal seed={seed} letter={symbol} state={state} />
          {kind === "claimed" ? (
            <span className="moment-badge">✓ Delivered</span>
          ) : null}
        </div>
        <span className="kicker">{c.kicker}</span>
        <h2>{c.title}</h2>
        <div className="moment-body">{children}</div>
        <button className="btn ghost" onClick={onClose}>
          Back to the launch
        </button>
      </div>
    </div>
  );
}
