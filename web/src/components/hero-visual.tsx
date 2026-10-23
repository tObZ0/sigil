"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ZEC_ON } from "@/lib/chain";
import { eth } from "@/lib/format";
import { launchCreatedAt, poolPrice, salePrice, type Launch } from "@/lib/relay";
import { Coin, Price, SEAL_STATE } from "./bits";
import { WaxSeal } from "./wax-seal";

/**
 * Which launches the hero shows. Sealing ones first, busiest first; if none
 * are sealing, ones revealing; failing that, the biggest live raise.
 */
function pick(launches: Launch[]): Launch[] {
  const by = (p: Launch["phase"]) => launches.filter((l) => l.phase === p).sort((a, b) => b.bidders - a.bidders);
  const sealing = by("sealing");
  if (sealing.length) return sealing.slice(0, 3);
  const revealing = [...by("revealing"), ...by("settling")];
  if (revealing.length) return revealing.slice(0, 3);
  return by("live")
    .sort((a, b) => (b.raised > a.raised ? 1 : -1))
    .slice(0, 1);
}

function Flip({ seconds }: { seconds: number }) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const parts = d > 0 ? [d, Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60)] : [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const labels = d > 0 ? ["days", "hrs", "min"] : ["hrs", "min", "sec"];
  return (
    <div className="flip" role="timer">
      {parts.map((v, i) => (
        <div key={labels[i]} className="flip-unit">
          <span className="flip-digits">
            {String(v)
              .padStart(2, "0")
              .split("")
              .map((ch, j) => (
                <b key={j}>{ch}</b>
              ))}
          </span>
          <small>{labels[i]}</small>
        </div>
      ))}
    </div>
  );
}

/**
 * The hero's right side: the launch to watch right now, as a live card.
 * It counts down to the seal breaking, shows how many bids are sealed (never
 * how much: that's the point), and rotates through the busiest launches.
 */
export function HeroVisual({ launches, now }: { launches: Launch[] | null; now: number | null }) {
  const list = launches ? pick(launches) : [];
  const [index, setIndex] = useState(0);
  const l = list.length ? list[index % list.length]! : null;
  const [started, setStarted] = useState<{ id: number; at: number } | null>(null);

  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => setIndex((i) => i + 1), 7000);
    return () => clearInterval(t);
  }, [list.length]);

  useEffect(() => {
    if (!l || started?.id === l.id) return;
    let cancelled = false;
    launchCreatedAt(l.id)
      .then((at) => {
        if (!cancelled && at !== null) setStarted({ id: l.id, at });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [l, started?.id]);

  if (!l) {
    return (
      <div className="feat feat-empty">
        <p className="muted">No launch is live yet.</p>
        <Link href="/launch" className="btn">
          Launch the first one
        </Link>
      </div>
    );
  }

  const sealing = l.phase === "sealing";
  const revealing = l.phase === "revealing" || l.phase === "settling";
  const end = sealing ? l.sealEnd : l.revealEnd;
  const begin = sealing ? (started?.id === l.id ? started.at : null) : l.sealEnd;
  const progress = now !== null && begin !== null ? Math.min(1, Math.max(0, (now - begin) / (end - begin))) : null;

  return (
    <div className="feat-wrap">
      <article className="feat" key={l.id}>
        <div className="feat-seal" aria-hidden>
          <WaxSeal seed={l.token} letter={l.symbol} state={SEAL_STATE[l.phase]} />
        </div>
        <header className="feat-head">
          <span className={`feat-tag${sealing ? " hot" : ""}`}>
            <i /> {sealing ? "Featured · sealing now" : revealing ? "Featured · revealing now" : "Featured · live"}
          </span>
        </header>
        <div className="feat-title">
          <Coin l={l} />
          <div style={{ minWidth: 0 }}>
            <h3>{l.name}</h3>
            <span>${l.symbol}</span>
          </div>
        </div>

        {sealing || revealing ? (
          <>
            <span className="feat-label">{sealing ? "Seal breaks in" : "Reveal closes in"}</span>
            {now === null ? <div className="flip-skeleton" /> : <Flip seconds={end - now} />}
            <div className="feat-stats">
              {sealing ? (
                <span>
                  <b>{l.bidders}</b> bids sealed · <span className="redact">█████</span> ETH
                </span>
              ) : (
                <span>
                  <b>
                    {l.reveals}/{l.bidders}
                  </b>{" "}
                  opened · {eth(l.raised)} ETH so far
                </span>
              )}
            </div>
            <div className="feat-bar" title={progress === null ? undefined : `${Math.round(progress * 100)}% of the window gone`}>
              <i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
            <span className="feat-note">
              {progress === null ? " " : `${Math.round(progress * 100)}% of the ${sealing ? "sealing" : "reveal"} window gone`}
            </span>
          </>
        ) : (
          <div className="feat-live">
            <div>
              <span className="feat-label">Raised at one fair price</span>
              <b className="feat-big">{eth(l.raised)} ETH</b>
            </div>
            <div>
              <span className="feat-label">Pool price vs sale</span>
              <b className="feat-big">
                {salePrice(l) ? `${poolPrice(l) >= salePrice(l) ? "+" : "−"}${Math.abs((poolPrice(l) / salePrice(l) - 1) * 100).toFixed(1)}%` : <Price value={poolPrice(l)} />}
              </b>
            </div>
          </div>
        )}

        <div className="feat-actions">
          <Link href={`/l/${l.id}`} className="btn">
            {sealing ? "Seal a bid" : revealing ? "Watch the reveal" : "Trade"}
          </Link>
          {sealing && ZEC_ON ? (
            <Link href={`/zec?launch=${l.id}`} className="btn ghost">
              Bid with ZEC
            </Link>
          ) : null}
        </div>
      </article>
      {list.length > 1 ? (
        <div className="feat-dots" role="tablist" aria-label="Featured launches">
          {list.map((x, i) => (
            <button key={x.id} role="tab" aria-selected={i === index % list.length} aria-label={x.name} onClick={() => setIndex(i)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
