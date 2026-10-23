"use client";

import { useEffect, useRef, useState } from "react";
import { LOGO_EMBLEM, LOGO_SEED } from "./logo";
import { WaxSeal, type SealState } from "./wax-seal";

const STEPS: { n: string; title: string; body: string; seal: SealState; note: string; detail: string }[] = [
  {
    n: "01",
    title: "Seal",
    body: "Lock ETH against a hash of your real bid. Add cover and even your deposit stops giving your size away. Nobody can read a bid: not snipers, not bundlers, not the dev.",
    seal: "intact",
    note: "Bids hidden",
    detail: "Only a hash goes on-chain",
  },
  {
    n: "02",
    title: "Break",
    body: "When the window closes, the seal cracks and every bidder reveals their own bid. Cover comes straight back. A bid that's never revealed doesn't count.",
    seal: "cracked",
    note: "Reveal window",
    detail: "Cover refunded on reveal",
  },
  {
    n: "03",
    title: "Price",
    body: "One price for everyone: ETH raised ÷ 500M tokens. Bigger bid, bigger share, same price, whether you sealed in the first block or the last.",
    seal: "open",
    note: "One price",
    detail: "ETH raised ÷ 500M tokens",
  },
  {
    n: "04",
    title: "Pool",
    body: "The raise seeds a pool that's locked forever, opening at exactly the sale price. No LP tokens, no way to pull it. Tokens the pool doesn't need are burned.",
    seal: "open",
    note: "Pool locked",
    detail: "Opens at the sale price, forever",
  },
];

/**
 * How Sigil works, told by scrolling: the steps scroll past on the left while
 * one seal on the right goes through them. On phones each step shows its own.
 */
export function Story() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const step = STEPS[active]!;
  return (
    <div className="story">
      <div className="story-steps">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-step={i}
            className={`story-step${i === active ? " on" : ""}`}
          >
            <div className="story-mini" aria-hidden>
              <WaxSeal seed={LOGO_SEED} letter="SIGIL" emblem={LOGO_EMBLEM} state={s.seal} bold />
            </div>
            <span className="story-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="story-stage" aria-hidden>
        <div className="story-seal" key={`${step.seal}-${active}`}>
          <WaxSeal seed={LOGO_SEED} letter="SIGIL" emblem={LOGO_EMBLEM} state={step.seal} ring="SIGIL ✦ SEALED LAUNCHES ✦ ROBINHOOD CHAIN ✦" />
        </div>
        <div className="story-note">
          <span className="story-dots">
            {STEPS.map((_, i) => (
              <i key={i} className={i === active ? "on" : undefined} />
            ))}
          </span>
          <b>{step.note}</b>
          <small>{step.detail}</small>
        </div>
      </div>
    </div>
  );
}
