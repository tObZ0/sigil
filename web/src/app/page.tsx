"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EnvelopeCard } from "@/components/bits";
import { HeroVisual } from "@/components/hero-visual";
import { LOGO_EMBLEM, LOGO_SEED } from "@/components/logo";
import { Story } from "@/components/story";
import { ZecFeature } from "@/components/zec-feature";
import { WaxSeal } from "@/components/wax-seal";
import { DEPLOYED } from "@/lib/chain";
import { eth } from "@/lib/format";
import { useChainClock, usePoll } from "@/lib/hooks";
import { fetchLaunches, type Phase } from "@/lib/relay";

const FILTERS: { id: "all" | Phase; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sealing", label: "Sealed" },
  { id: "revealing", label: "Revealing" },
  { id: "live", label: "Live" },
  { id: "failed", label: "Returned" },
];

export default function Home() {
  const now = useChainClock();
  const { data: launches, error } = usePoll(() => (DEPLOYED ? fetchLaunches() : Promise.resolve([])), 15_000);
  const [filter, setFilter] = useState<"all" | Phase>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: launches?.length ?? 0 };
    for (const l of launches ?? []) c[l.phase] = (c[l.phase] ?? 0) + 1;
    return c;
  }, [launches]);
  const shown = (launches ?? []).filter((l) => filter === "all" || l.phase === filter || (filter === "revealing" && l.phase === "settling"));
  const raised = (launches ?? []).filter((l) => l.phase === "live").reduce((s, l) => s + l.raised, 0n);
  const bids = (launches ?? []).reduce((s, l) => s + l.bidders, 0);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <Link href="/zec" className="hero-badge">
            <span className="hero-badge-new">New</span>
            Bid with shielded ZEC, no wallet needed
            <span aria-hidden>→</span>
          </Link>
          <h1>
            Bids go in sealed.
            <br />
            <span className="soft">Price comes out fair.</span>
          </h1>
          <p className="lede">
            A token launchpad on Robinhood Chain where bids stay hidden until the window closes. Every bid is revealed
            together and everyone pays the same price, so there is nothing to snipe.
          </p>
          <div className="hero-actions">
            <Link href="/launch" className="btn">
              Launch a token
            </Link>
            <a href="#launches" className="btn ghost">
              Explore launches
            </a>
          </div>
        </div>
        <HeroVisual launches={launches} now={now} />
      </section>

      <dl className="stats">
        <div>
          <dt>Launches</dt>
          <dd className="mono">{launches ? launches.length : "—"}</dd>
        </div>
        <div>
          <dt>Raised by live tokens</dt>
          <dd className="mono">{launches ? `${eth(raised, 2)} ETH` : "—"}</dd>
        </div>
        <div>
          <dt>Bids placed</dt>
          <dd className="mono">{launches ? bids : "—"}</dd>
        </div>
        <div>
          <dt>Sealing now</dt>
          <dd className="mono">{launches ? counts.sealing ?? 0 : "—"}</dd>
        </div>
      </dl>

      <ZecFeature />

      <section className="section" id="launches">
        <div className="section-head">
          <h2>Launches</h2>
          <div className="tabs" role="group" aria-label="Filter launches">
            {FILTERS.map((f) => (
              <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
                <span>{(counts[f.id] ?? 0) + (f.id === "revealing" ? counts.settling ?? 0 : 0)}</span>
              </button>
            ))}
          </div>
        </div>
        {!DEPLOYED ? (
          <div className="empty">Sigil isn&rsquo;t deployed on this network yet.</div>
        ) : error && !launches ? (
          <div className="empty">Couldn&rsquo;t reach Robinhood Chain. Retrying…</div>
        ) : !launches ? (
          <div className="grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" />
            ))}
          </div>
        ) : shown.length ? (
          <div className="grid">
            {shown.map((l) => (
              <EnvelopeCard key={l.id} l={l} now={now} />
            ))}
          </div>
        ) : (
          <div className="empty">
            Nothing here yet. <Link href="/launch">Launch the first one →</Link>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>How it works</h2>
          <Link href="/how" className="link-arrow">
            Full rules →
          </Link>
        </div>
        <Story />
      </section>

      <section className="cta">
        <div className="cta-seal" aria-hidden>
          <WaxSeal seed={LOGO_SEED} letter="SIGIL" emblem={LOGO_EMBLEM} bold />
        </div>
        <div>
          <h2>Launch with a seal.</h2>
          <p>No presale, no team allocation, no snipers. A sealed window, one fair price, and a pool nobody can pull.</p>
        </div>
        <Link href="/launch" className="btn">
          Launch a token
        </Link>
      </section>
    </>
  );
}
