"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { Coin, PHASE_LABEL, Price, SEAL_STATE, StatusPill } from "@/components/bits";
import { PriceChart } from "@/components/price-chart";
import { SealMoment, type MomentKind } from "@/components/seal-moment";
import { WaxSeal } from "@/components/wax-seal";
import { erc20Abi, relayAbi } from "@/lib/abi";
import { chain, explorer, publicClient, RELAY_ADDRESS } from "@/lib/chain";
import { countdown, eth, short, tokens } from "@/lib/format";
import { useChainClock, usePoll } from "@/lib/hooks";
import { fetchActivity, fetchBid, fetchLaunch, poolPrice, salePrice, SALE_SUPPLY, type Activity, type Bid, type Launch } from "@/lib/relay";
import { commitmentOf, downloadTicket, findTicket, newSalt, parseTicket, saveTicket, type Ticket } from "@/lib/tickets";
import { useTx } from "@/lib/tx";

type Moment = { kind: MomentKind; ticket?: Ticket; text: React.ReactNode };
type OnMoment = (m: Moment) => void;
import { useWallet } from "@/lib/wallet";

export default function LaunchPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = Number(raw);
  const now = useChainClock();
  const w = useWallet();
  const { data: launch, error, refresh } = usePoll(() => fetchLaunch(id), 8_000, [id]);
  const { data: activity, refresh: refreshActivity } = usePoll(() => fetchActivity(id), 12_000, [id]);
  const { data: bid, refresh: refreshBid } = usePoll(
    () => (w.account ? fetchBid(id, w.account) : Promise.resolve(null)),
    10_000,
    [id, w.account],
  );
  const reload = async () => {
    await Promise.all([refresh(), refreshActivity(), refreshBid()]);
  };
  // Lives here, not in the panels: a landed tx reloads the bid and swaps the panel out.
  const [moment, setMoment] = useState<Moment | null>(null);

  if (error && launch === null) return <div className="empty" style={{ marginTop: 60 }}>Couldn&rsquo;t reach the chain. Retrying…</div>;
  if (launch === null) return <div className="skeleton" style={{ marginTop: 40, minHeight: 520 }} />;
  if (!launch) {
    return (
      <div style={{ padding: "80px 0" }}>
        <h1>
          No launch <em>here.</em>
        </h1>
        <p className="lede">There&rsquo;s no launch #{raw}.</p>
        <Link href="/" className="btn" style={{ marginTop: 24 }}>
          Back to launches
        </Link>
      </div>
    );
  }
  const l = launch;
  // Phase by the contract, clock by the chain: when a window ends between
  // polls, show the next phase straight away instead of a stuck 00:00:00.
  const ended = now !== null && ((l.phase === "sealing" && now >= l.sealEnd) || (l.phase === "revealing" && now >= l.revealEnd));

  return (
    <>
      <Link href="/" className="back">
        ← All launches
      </Link>
      <div className="lp">
        <div>
          <div className="lp-head">
            <Coin l={l} />
            <div>
              <span className="sym">${l.symbol}</span>
              <h1>{l.name}</h1>
            </div>
          </div>
          {l.meta.description ? <p className="lede">{l.meta.description}</p> : null}
          <Links l={l} />

          <PhaseCard l={l} now={now} ended={ended} />

          <div className="facts">
            <div>
              <span>Minimum raise</span>
              <b className="mono">{eth(l.minRaise)} ETH</b>
            </div>
            <div>
              <span>{l.phase === "sealing" ? "ETH under seal" : "Bids revealed"}</span>
              <b className="mono">{l.phase === "sealing" ? `${eth(l.deposits)} ETH` : `${eth(l.raised)} ETH`}</b>
            </div>
            <div>
              <span>Bids</span>
              <b className="mono">
                {l.phase === "sealing" ? l.bidders : `${l.reveals} / ${l.bidders}`}
              </b>
            </div>
            <div>
              <span>{l.phase === "live" ? "Sale price" : "Price so far"}</span>
              <b className="mono">{l.phase === "sealing" ? "sealed" : <Price value={salePrice(l)} />}</b>
            </div>
            <div>
              <span>{l.phase === "live" ? "Pool price" : "For sale"}</span>
              <b className="mono">{l.phase === "live" ? <Price value={poolPrice(l)} /> : "500M"}</b>
            </div>
            <div>
              <span>{l.phase === "live" ? "Pool ETH" : "Pool"}</span>
              <b className="mono">{l.phase === "live" ? eth(l.ethReserve, 3) : "locked forever"}</b>
            </div>
          </div>
          {l.phase === "sealing" ? (
            <p className="hint" style={{ marginTop: 10 }}>
              ETH under seal includes cover. Real bids stay hidden until each one is revealed.
            </p>
          ) : null}

          <Wall l={l} activity={activity ?? []} />

          {l.phase === "live" ? (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Price since the seal broke</h3>
              <PriceChart l={l} activity={activity ?? []} />
            </div>
          ) : null}

          <ActivityTable activity={activity ?? []} symbol={l.symbol} />
        </div>

        <aside className="panel">
          <ActionPanel l={l} bid={bid} ended={ended} reload={reload} onMoment={setMoment} />
          {l.phase === "sealing" && !ended ? (
            <div className="card zec-cta">
              <span className="hint" style={{ margin: 0 }}>
                No wallet? Bid with shielded ZEC. Sigil seals it for you.
              </span>
              <Link href={`/zec?launch=${l.id}`} className="link-arrow" style={{ whiteSpace: "nowrap" }}>
                ZEC bid →
              </Link>
            </div>
          ) : null}
          <CreatorFees l={l} />
          <div className="card" style={{ fontSize: 13.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span className="muted">Token</span>
              <a href={explorer(`token/${l.token}`) ?? "#"} target="_blank" rel="noreferrer" className="mono">
                {short(l.token)}
              </a>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
              <span className="muted">Creator</span>
              <a href={explorer(`address/${l.creator}`) ?? "#"} target="_blank" rel="noreferrer" className="mono">
                {short(l.creator)}
              </a>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
              <span className="muted">Supply</span>
              <span>1B · no team allocation</span>
            </div>
          </div>
        </aside>
      </div>
      {moment ? (
        <SealMoment kind={moment.kind} seed={l.token} symbol={l.symbol} onClose={() => setMoment(null)}>
          {moment.text}
          {moment.ticket ? (
            <>
              <div className="notice warn" style={{ textAlign: "left", marginTop: 14 }}>
                <b>Keep your reveal key.</b> It holds the secret that opens your bid. Lose it and the browser copy, and the
                bid can&rsquo;t be revealed (an unrevealed bid loses 10%).
              </div>
              <button className="btn block" style={{ marginTop: 12 }} onClick={() => downloadTicket(moment.ticket!)}>
                Download reveal key again
              </button>
            </>
          ) : null}
        </SealMoment>
      ) : null}
    </>
  );
}

function Links({ l }: { l: Launch }) {
  const items = [
    l.meta.x && { label: "X", href: l.meta.x.startsWith("http") ? l.meta.x : `https://x.com/${l.meta.x.replace(/^@/, "")}` },
    l.meta.telegram && { label: "Telegram", href: l.meta.telegram.startsWith("http") ? l.meta.telegram : `https://t.me/${l.meta.telegram.replace(/^@/, "")}` },
    l.meta.website && { label: "Website", href: l.meta.website.startsWith("http") ? l.meta.website : `https://${l.meta.website}` },
  ].filter(Boolean) as { label: string; href: string }[];
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
      {items.map((i) => (
        <a key={i.label} href={i.href} target="_blank" rel="noreferrer noopener" className="btn ghost sm">
          {i.label} ↗
        </a>
      ))}
    </div>
  );
}

function PhaseCard({ l, now, ended }: { l: Launch; now: number | null; ended: boolean }) {
  const left = (t: number) => (now === null ? "—" : countdown(t - now));
  let title: React.ReactNode;
  let body: React.ReactNode;
  if (l.phase === "sealing" && !ended) {
    title = <>Seal breaks in</>;
    body = <b className="mono">{left(l.sealEnd)}</b>;
  } else if ((l.phase === "sealing" && ended) || (l.phase === "revealing" && !ended)) {
    title = <>Reveal window closes in</>;
    body = <b className="mono">{left(l.revealEnd)}</b>;
  } else if (l.phase === "settling" || (l.phase === "revealing" && ended)) {
    title = <>All bids are in</>;
    body = <b>Ready to settle</b>;
  } else if (l.phase === "live") {
    title = <>The seal is broken</>;
    body = (
      <b>
        {eth(l.raised)} ETH raised
      </b>
    );
  } else {
    title = <>Didn&rsquo;t reach {eth(l.minRaise)} ETH</>;
    body = <b>Every bid returned</b>;
  }
  const phase = ended ? (l.phase === "sealing" ? "revealing" : "settling") : l.phase;
  return (
    <div className="card phase-card">
      <div>
        <WaxSeal seed={l.token} letter={l.symbol} state={SEAL_STATE[phase]} />
      </div>
      <div className="clock" style={{ display: "block" }}>
        <div className="kicker">{title}</div>
        <div style={{ marginTop: 8 }}>{body}</div>
      </div>
      <div className="hide-sm">
        <StatusPill phase={phase} />
      </div>
    </div>
  );
}

function Wall({ l, activity }: { l: Launch; activity: Activity[] }) {
  const sealers = activity.filter((a) => a.kind === "sealed");
  const revealed = new Set(activity.filter((a) => a.kind === "revealed").map((a) => a.who.toLowerCase()));
  const over = l.phase === "live" || l.phase === "failed" || l.phase === "settling";
  if (!sealers.length) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Bids</h3>
      <p className="hint" style={{ margin: 0 }}>
        One dot per bidder. {l.phase === "sealing" ? "All still sealed." : "Filled dots have been revealed."}
        {over ? " Grey ones were never revealed and lose 10% to the pool." : ""}
      </p>
      <div className="wall">
        {sealers.map((s) => {
          const open = revealed.has(s.who.toLowerCase());
          return <span key={s.tx} className={`mini-env${open ? " open" : over ? " lost" : ""}`} title={short(s.who)} />;
        })}
      </div>
    </div>
  );
}

function ActivityTable({ activity, symbol }: { activity: Activity[]; symbol: string }) {
  if (!activity.length) return null;
  const rows = [...activity].reverse().slice(0, 40);
  return (
    <div className="section" style={{ marginTop: 24 }}>
      <h3 style={{ marginBottom: 12 }}>Activity</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>What</th>
              <th>Who</th>
              <th className="r">ETH</th>
              <th className="r">{symbol}</th>
              <th className="r">Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={`${a.tx}-${i}`}>
                <td>
                  {a.kind === "sealed" ? (
                    <span className="pill sealed">sealed</span>
                  ) : a.kind === "revealed" ? (
                    <span className="pill revealed">revealed</span>
                  ) : (
                    <span className={`pill ${a.buy ? "buy" : "sell"}`}>{a.buy ? "buy" : "sell"}</span>
                  )}
                </td>
                <td className="mono">{short(a.who)}</td>
                <td className="r mono">
                  {a.kind === "sealed" ? <span title="Deposit, including any cover">{eth(a.eth)} *</span> : eth(a.eth)}
                </td>
                <td className="r mono">{a.kind === "swap" ? tokens(a.tokens) : "—"}</td>
                <td className="r">
                  {explorer(`tx/${a.tx}`) ? (
                    <a href={explorer(`tx/${a.tx}`)!} target="_blank" rel="noreferrer" className="muted">
                      {a.tx.slice(0, 8)}↗
                    </a>
                  ) : (
                    <span className="muted">{a.tx.slice(0, 8)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">* A sealed deposit is the bid plus any cover. The real bid only shows once revealed.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ actions */

function ActionPanel({ l, bid, ended, reload, onMoment }: { l: Launch; bid: Bid | null; ended: boolean; reload: () => Promise<void>; onMoment: OnMoment }) {
  const w = useWallet();
  const sealed = !!bid && bid.commitment !== `0x${"0".repeat(64)}`;

  if (!w.account) {
    return (
      <div className="card">
        <h3>{l.phase === "sealing" ? "Seal a bid" : l.phase === "live" ? "Trade" : PHASE_LABEL[l.phase]}</h3>
        <p className="muted" style={{ marginTop: 0 }}>Connect a wallet to take part.</p>
        <p className="hint">Use the Connect button at the top.</p>
      </div>
    );
  }
  if (w.wrongChain) {
    return (
      <div className="card">
        <h3>Wrong network</h3>
        <button className="btn block" onClick={() => w.switchChain()}>
          Switch to {chain.name}
        </button>
      </div>
    );
  }
  if (l.phase === "sealing" && !ended) return sealed ? <SealedReceipt l={l} bid={bid!} /> : <SealForm l={l} reload={reload} onMoment={onMoment} />;
  if (l.phase === "revealing" || (l.phase === "sealing" && ended)) {
    if (!sealed) return <Closed text="Sealing is closed. This wallet didn't seal a bid." />;
    return <RevealForm l={l} bid={bid!} reload={reload} ready={l.phase === "revealing"} onMoment={onMoment} />;
  }
  if (l.phase === "settling") return <SettleCard l={l} reload={reload} />;
  return (
    <>
      {sealed && !bid!.claimed ? <ClaimCard l={l} bid={bid!} reload={reload} onMoment={onMoment} /> : null}
      {l.phase === "live" ? <SwapCard l={l} reload={reload} /> : !sealed ? <Closed text="This launch was returned. Bidders can claim their ETH back." /> : null}
      {sealed && bid!.claimed ? (
        <div className="card notice good" style={{ marginBottom: 16 }}>
          {l.phase === "live" ? "Your tokens are claimed." : "Your ETH is back in your wallet."}
        </div>
      ) : null}
    </>
  );
}

function Closed({ text }: { text: string }) {
  return (
    <div className="card">
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

function TxStatus({ tx }: { tx: ReturnType<typeof useTx> }) {
  if (tx.busy) return <p className="hint">{tx.busy}</p>;
  if (tx.error) return <p className="err">{tx.error}</p>;
  return null;
}

const COVERS = [0, 25, 50, 100, 200];

function SealForm({ l, reload, onMoment }: { l: Launch; reload: () => Promise<void>; onMoment: OnMoment }) {
  const w = useWallet();
  const tx = useTx();
  const [amount, setAmount] = useState("");
  const [cover, setCover] = useState(50);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  let bidWei = 0n;
  try {
    bidWei = amount ? parseEther(amount) : 0n;
  } catch {
    bidWei = 0n;
  }
  const coverWei = (bidWei * BigInt(cover)) / 100n;
  const deposit = bidWei + coverWei;
  const share = l.deposits + deposit > 0n ? Number(deposit) / Number(l.deposits + deposit) : 0;

  if (ticket) {
    return (
      <div className="card">
        <h3>Sealed.</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Your bid of <b>{eth(BigInt(ticket.amount))} ETH</b> is sealed inside a {eth(BigInt(ticket.deposit))} ETH deposit.
        </p>
        <div className="notice warn">
          <b>Download your reveal key now.</b> It holds the secret that opens your bid. This browser kept a copy, but if you
          clear it or switch devices without the file, you can&rsquo;t reveal, and an unrevealed bid loses 10%.
        </div>
        <button className="btn block" style={{ marginTop: 14 }} onClick={() => downloadTicket(ticket)}>
          Download reveal key
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Seal a bid</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Only a hash of your bid goes on-chain. Nobody can read it until you reveal.
      </p>
      <div className="field">
        <label htmlFor="amt">Your real bid</label>
        <div className="input-row">
          <input id="amt" className="input mono" inputMode="decimal" placeholder="0.5" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <span>ETH</span>
        </div>
      </div>
      <div className="field">
        <label>
          Cover <small>extra ETH that hides your size, refunded at reveal</small>
        </label>
        <div className="choice">
          {COVERS.map((c) => (
            <button key={c} aria-pressed={cover === c} onClick={() => setCover(c)} type="button">
              {c === 0 ? "None" : `+${c}%`}
            </button>
          ))}
        </div>
        {bidWei > 0n ? (
          <>
            <div className="split-bar">
              <i className="bid" style={{ width: `${(Number(bidWei) / Number(deposit)) * 100}%` }} />
              <i className="cov" style={{ width: `${(Number(coverWei) / Number(deposit)) * 100}%` }} />
            </div>
            <div className="hint mono">
              Deposit {eth(deposit)} ETH = bid {eth(bidWei)} + cover {eth(coverWei)}
            </div>
          </>
        ) : null}
      </div>
      {bidWei > 0n ? (
        <div className="notice" style={{ fontSize: 13.5 }}>
          If everyone stopped here, your deposit would be ~{(share * 100).toFixed(1)}% of all sealed deposits. Your real share
          depends on what everyone reveals: you get <b>bid ÷ total raised × 500M</b> tokens.
        </div>
      ) : null}
      <button
        className="btn block"
        style={{ marginTop: 14 }}
        disabled={!w.client || bidWei === 0n || !!tx.busy}
        onClick={async () => {
          if (!w.client || !w.account) return;
          const salt = newSalt();
          const t: Ticket = {
            v: 1,
            chainId: chain.id,
            relay: RELAY_ADDRESS,
            launchId: l.id,
            bidder: w.account,
            amount: bidWei.toString(),
            deposit: deposit.toString(),
            salt,
            symbol: l.symbol,
            sealedAt: Math.floor(Date.now() / 1000),
          };
          // Keep the secret before sending: if the tab dies after the tx lands, it's still here.
          saveTicket(t);
          const ok = await tx.run(
            "Sealing",
            () =>
              w.client!.writeContract({
                address: RELAY_ADDRESS,
                abi: relayAbi,
                functionName: "seal",
                args: [BigInt(l.id), commitmentOf(l.id, w.account!, bidWei, salt)],
                value: deposit,
                account: w.client!.account!,
                chain,
              }),
            reload,
          );
          if (ok) {
            setTicket(t);
            downloadTicket(t);
            onMoment({
              kind: "sealed",
              ticket: t,
              text: (
                <p>
                  A real bid of <b>{eth(bidWei)} ETH</b> inside a {eth(deposit)} ETH deposit. Nobody can read it until you
                  break the seal. Your reveal key just downloaded.
                </p>
              ),
            });
          }
        }}
      >
        {tx.busy ? tx.busy : `Seal ${bidWei > 0n ? eth(deposit) + " ETH" : "my bid"}`}
      </button>
      <TxStatus tx={tx} />
      <p className="hint">
        You&rsquo;ll get a reveal key to keep. Reveal it after the seal breaks, or lose 10% of the deposit.
      </p>
    </div>
  );
}

function SealedReceipt({ l, bid }: { l: Launch; bid: Bid }) {
  const w = useWallet();
  const t = w.account ? findTicket(chain.id, RELAY_ADDRESS, l.id, w.account) : null;
  return (
    <div className="card">
      <h3>Your bid is sealed</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {eth(bid.deposit)} ETH deposited{t ? `, with a real bid of ${eth(BigInt(t.amount))} ETH` : ""}.
      </p>
      {t ? (
        <>
          <div className="notice good">This browser holds your reveal key. Keep a downloaded copy too.</div>
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => downloadTicket(t)}>
            Download reveal key
          </button>
        </>
      ) : (
        <div className="notice warn">
          This browser doesn&rsquo;t have the reveal key for this bid. Find the file you downloaded when you sealed it;
          you&rsquo;ll need it to reveal.
        </div>
      )}
      <p className="hint">You&rsquo;ll be able to reveal once the seal breaks.</p>
    </div>
  );
}

function RevealForm({ l, bid, reload, ready, onMoment }: { l: Launch; bid: Bid; reload: () => Promise<void>; ready: boolean; onMoment: OnMoment }) {
  const w = useWallet();
  const tx = useTx();
  const [uploaded, setUploaded] = useState<Ticket | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const stored = useMemo(() => (w.account ? findTicket(chain.id, RELAY_ADDRESS, l.id, w.account) : null), [w.account, l.id]);
  const ticket = uploaded ?? stored;

  if (bid.revealed) {
    return (
      <div className="card notice good">
        <h3>Opened.</h3>
        <p style={{ margin: 0 }}>
          Your bid of <b>{eth(bid.amount)} ETH</b> is in, and your cover of {eth(bid.deposit - bid.amount)} ETH came
          back. Tokens arrive when the launch settles.
        </p>
      </div>
    );
  }
  const matches = ticket && w.account && commitmentOf(l.id, w.account, BigInt(ticket.amount), ticket.salt) === bid.commitment;

  return (
    <div className="card">
      <h3>Break your seal</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Reveal your bid before the window closes. Cover comes back straight away.
      </p>
      {ticket ? (
        matches ? (
          <div className="notice good">
            Reveal key found: bid <b>{eth(BigInt(ticket.amount))} ETH</b>, cover {eth(bid.deposit - BigInt(ticket.amount))} ETH.
          </div>
        ) : (
          <div className="notice warn">The reveal key in this browser doesn&rsquo;t match this wallet&rsquo;s seal. Load the right file.</div>
        )
      ) : (
        <div className="notice warn">No reveal key in this browser. Load the file you downloaded when you sealed.</div>
      )}
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="tf">
          Reveal key <small>sigil-reveal-key-….json</small>
        </label>
        <input
          id="tf"
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const t = parseTicket(await f.text());
            if (!t || t.launchId !== l.id) return setFileErr("That file isn't a reveal key for this launch.");
            setFileErr(null);
            setUploaded(t);
            saveTicket(t);
          }}
        />
        {fileErr ? <span className="err">{fileErr}</span> : null}
      </div>
      <button
        className="btn glow block"
        disabled={!ready || !matches || !!tx.busy}
        onClick={async () => {
          const amount = BigInt(ticket!.amount);
          const ok = await tx.run(
            "Revealing",
            () =>
              w.client!.writeContract({
                address: RELAY_ADDRESS,
                abi: relayAbi,
                functionName: "reveal",
                args: [BigInt(l.id), amount, ticket!.salt],
                account: w.client!.account!,
                chain,
              }),
            reload,
          );
          if (ok) {
            onMoment({
              kind: "opened",
              text: (
                <p>
                  Your <b>{eth(amount)} ETH</b> bid counts.{bid.deposit > amount ? <> The {eth(bid.deposit - amount)} ETH of cover is already back in your wallet.</> : null} Tokens arrive when the launch settles.
                </p>
              ),
            });
          }
        }}
      >
        {tx.busy ?? (ready ? "Break the seal" : "Waiting for the next block…")}
      </button>
      <TxStatus tx={tx} />
    </div>
  );
}

function SettleCard({ l, reload }: { l: Launch; reload: () => Promise<void> }) {
  const w = useWallet();
  const tx = useTx();
  const willFail = l.raised < l.minRaise;
  return (
    <div className="card">
      <h3>Settle the launch</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {willFail
          ? `Revealed bids came to ${eth(l.raised)} ETH, under the ${eth(l.minRaise)} ETH minimum. Settling returns every bid.`
          : <>Revealed bids came to {eth(l.raised)} ETH. Settling opens the pool at <Price value={salePrice(l)} /> ETH per token and unlocks claims.</>}{" "}
        Anyone can do it.
      </p>
      <button
        className="btn block"
        disabled={!w.client || !!tx.busy}
        onClick={() =>
          tx.run(
            "Settling",
            () =>
              w.client!.writeContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "settle", args: [BigInt(l.id)], account: w.client!.account!, chain }),
            reload,
          )
        }
      >
        {tx.busy ?? "Settle"}
      </button>
      <TxStatus tx={tx} />
    </div>
  );
}

function ClaimCard({ l, bid, reload, onMoment }: { l: Launch; bid: Bid; reload: () => Promise<void>; onMoment: OnMoment }) {
  const w = useWallet();
  const tx = useTx();
  let what: string;
  if (l.phase === "failed") what = `${eth(bid.revealed ? bid.amount : bid.deposit)} ETH back`;
  else if (bid.revealed) what = `${tokens((bid.amount * SALE_SUPPLY) / l.raised)} ${l.symbol}`;
  else what = `${eth((bid.deposit * 9000n) / 10000n)} ETH back (bid never revealed, 10% kept)`;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>Claim</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Waiting for you: <b style={{ color: "var(--ink)" }}>{what}</b>
      </p>
      <button
        className="btn block"
        disabled={!!tx.busy}
        onClick={async () => {
          const ok = await tx.run(
            "Claiming",
            () => w.client!.writeContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "claim", args: [BigInt(l.id)], account: w.client!.account!, chain }),
            reload,
          );
          if (ok) onMoment({ kind: "claimed", text: <p>Delivered to your wallet: <b>{what}</b>.</p> });
        }}
      >
        {tx.busy ?? "Claim"}
      </button>
      <TxStatus tx={tx} />
    </div>
  );
}

function SwapCard({ l, reload }: { l: Launch; reload: () => Promise<void> }) {
  const w = useWallet();
  const tx = useTx();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [q, setQ] = useState<{ key: string; out: bigint } | null>(null);
  const [bal, setBal] = useState<{ eth: bigint; tok: bigint } | null>(null);
  let inWei = 0n;
  try {
    inWei = amount ? parseEther(amount) : 0n;
  } catch {
    inWei = 0n;
  }

  useEffect(() => {
    if (!w.account) return;
    Promise.all([
      publicClient.getBalance({ address: w.account }),
      publicClient.readContract({ address: l.token, abi: erc20Abi, functionName: "balanceOf", args: [w.account] }) as Promise<bigint>,
    ]).then(([e, t]) => setBal({ eth: e, tok: t }));
  }, [w.account, l.token, l.ethReserve, tx.done]);

  // A quote belongs to one side and one amount; anything else shows as no quote.
  const key = `${side}:${inWei}:${l.ethReserve}`;
  const quote = q && q.key === key ? q.out : null;
  useEffect(() => {
    if (inWei === 0n) return;
    const fn = side === "buy" ? "quoteBuy" : "quoteSell";
    publicClient
      .readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: fn, args: [BigInt(l.id), inWei] })
      .then((r) => setQ({ key, out: (r as readonly [bigint, bigint])[0] }))
      .catch(() => {});
  }, [key, inWei, side, l.id]);

  const min = quote ? (quote * 98n) / 100n : 0n;
  const max = side === "buy" ? bal?.eth : bal?.tok;

  return (
    <div className="card">
      <h3>Trade</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Locked pool · 1% fee · price <Price value={poolPrice(l)} /> ETH
      </p>
      <div className="tabs2">
        <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
          Sell
        </button>
      </div>
      <div className="field">
        <label htmlFor="swap">
          You pay{" "}
          {max !== undefined ? (
            <small>
              · balance{" "}
              <button
                type="button"
                style={{ border: 0, background: "none", color: "var(--brand)", cursor: "pointer", padding: 0 }}
                onClick={() => setAmount(formatEther(side === "buy" ? (max * 99n) / 100n : max))}
              >
                {side === "buy" ? eth(max) : tokens(max)}
              </button>
            </small>
          ) : null}
        </label>
        <div className="input-row">
          <input id="swap" className="input mono" inputMode="decimal" placeholder="0.1" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <span>{side === "buy" ? "ETH" : l.symbol}</span>
        </div>
      </div>
      <div className="notice mono" style={{ fontSize: 14 }}>
        You get ≈ {quote === null ? "—" : side === "buy" ? `${tokens(quote)} ${l.symbol}` : `${eth(quote)} ETH`}
        <div className="hint">2% slippage limit</div>
      </div>
      <button
        className="btn block"
        style={{ marginTop: 14 }}
        disabled={!quote || !!tx.busy || (max !== undefined && inWei > max)}
        onClick={async () => {
          const acct = w.client!.account!;
          if (side === "buy") {
            await tx.run(
              "Buying",
              () => w.client!.writeContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "buy", args: [BigInt(l.id), min], value: inWei, account: acct, chain }),
              reload,
            );
          } else {
            const allowance = (await publicClient.readContract({ address: l.token, abi: erc20Abi, functionName: "allowance", args: [w.account as Address, RELAY_ADDRESS] })) as bigint;
            if (allowance < inWei) {
              const ok = await tx.run("Approving", () =>
                w.client!.writeContract({ address: l.token, abi: erc20Abi, functionName: "approve", args: [RELAY_ADDRESS, inWei], account: acct, chain }),
              );
              if (!ok) return;
            }
            await tx.run(
              "Selling",
              () => w.client!.writeContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "sell", args: [BigInt(l.id), inWei, min], account: acct, chain }),
              reload,
            );
          }
          setAmount("");
        }}
      >
        {tx.busy ?? (side === "buy" ? "Buy" : "Sell")}
      </button>
      {tx.done && !tx.busy ? <p className="ok">Done.</p> : null}
      <TxStatus tx={tx} />
    </div>
  );
}

function CreatorFees({ l }: { l: Launch }) {
  const w = useWallet();
  const tx = useTx();
  const [owed, setOwed] = useState<bigint | null>(null);
  const isCreator = w.account?.toLowerCase() === l.creator.toLowerCase();
  useEffect(() => {
    if (!isCreator || !w.account) return;
    publicClient.readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "owed", args: [w.account] }).then((v) => setOwed(v as bigint));
  }, [isCreator, w.account, tx.done, l.ethReserve]);
  if (!isCreator) return null;
  return (
    <div className="card">
      <h3>Your creator fees</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        0.5% of the raise and half of every swap fee. Owed across all your launches: <b className="mono">{owed === null ? "—" : eth(owed)} ETH</b>
      </p>
      <button
        className="btn ghost block"
        disabled={!owed || !!tx.busy}
        onClick={() =>
          tx.run("Withdrawing", () => w.client!.writeContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "withdraw", account: w.client!.account!, chain }))
        }
      >
        {tx.busy ?? "Withdraw"}
      </button>
      <TxStatus tx={tx} />
    </div>
  );
}
