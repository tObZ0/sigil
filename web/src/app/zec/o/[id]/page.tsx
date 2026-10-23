import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { explorer } from "@/lib/chain";
import { tokens } from "@/lib/format";
import { cfg } from "@/server/config";
import { getMeta, type ZecOrder } from "@/server/db";
import { formatEth, formatUsd, formatZec } from "@/server/money";
import { findOrder, paymentsFor, received } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ZEC bid", robots: { index: false } };

const STAGES = ["Pay", "Seal", "Reveal", "Deliver"] as const;

function stage(o: ZecOrder): { at: number; halted: boolean } {
  switch (o.status) {
    case "awaiting":
    case "confirming":
      return { at: 0, halted: false };
    case "paid":
    case "funding":
    case "funded":
      return { at: 1, halted: false };
    case "sealed":
      return { at: 2, halted: false };
    case "revealed":
    case "claimed":
      return { at: 3, halted: false };
    case "delivered":
    case "refunded":
      return { at: 4, halted: false };
    case "expired":
      return { at: 0, halted: true };
    case "attention":
      return { at: o.seal_tx ? 2 : 1, halted: true };
  }
}

function headline(o: ZecOrder, confirmed: bigint, pending: bigint, depth: number): { title: string; sub: string } {
  const c = cfg().zcash.confirmations;
  switch (o.status) {
    case "awaiting":
      return { title: "Send the ZEC.", sub: `Send exactly ${formatZec(o.zat_requested)} ZEC from a shielded wallet before ${hhmm(o.expires_at)}.` };
    case "confirming":
      return pending > 0n
        ? { title: "Seen. Letting it settle.", sub: `${Math.min(depth, c)} of ${c} confirmations. Zcash makes a block about every 75 seconds.` }
        : { title: "Part of it is here.", sub: `${formatZec(confirmed)} of ${formatZec(o.zat_requested)} ZEC has arrived. Send the rest, or the bid will be for what arrived.` };
    case "paid":
    case "funding":
    case "funded":
      return { title: "Paid. Sealing your bid.", sub: o.note ?? "Sigil is funding a fresh bidding wallet and sealing the bid." };
    case "sealed":
      return { title: "Your bid is sealed.", sub: "Nobody can read it. Sigil reveals it for you when the seal breaks." };
    case "revealed":
      return { title: "Revealed. Waiting for the launch to settle.", sub: "Your bid counts. Tokens follow when the launch settles." };
    case "claimed":
      return { title: "Claimed. Sending it to you.", sub: "This takes a few seconds." };
    case "delivered":
      return { title: "Delivered.", sub: o.tokens_out ? `${tokens(BigInt(o.tokens_out))} $${o.symbol} sent to your address, with ETH for gas.` : "Your tokens were sent to your address." };
    case "refunded":
      return { title: "The launch was returned.", sub: `Your bid came back: ${formatEth(BigInt(o.refund_wei ?? "0"))} ETH sent to your address.` };
    case "expired":
      return { title: "This quote ran out.", sub: "Nothing arrived in time. If you did send ZEC, it will still be found, and handled by hand." };
    case "attention":
      return { title: "Held for a person to look at.", sub: o.note ?? "Something about this bid can't be handled automatically." };
  }
}

function hhmm(d: Date) {
  return d.toISOString().slice(11, 16) + " UTC";
}

function TxLink({ hash, label }: { hash: string | null; label: string }) {
  if (!hash || hash === "none") return null;
  const url = explorer(`tx/${hash}`);
  return (
    <tr>
      <td>{label}</td>
      <td className="r mono">{url ? <a href={url}>{hash.slice(0, 10)}…</a> : `${hash.slice(0, 10)}…`}</td>
    </tr>
  );
}

export default async function ZecOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await findOrder(id);
  if (!o) notFound();
  const payments = await paymentsFor(o.slot);
  // The worker writes the Zcash tip on every tick.
  const tipRaw = await getMeta("zcash_tip");
  const { confirmed, pending, depth } = received(payments, tipRaw ? BigInt(tipRaw) : null, cfg().zcash.confirmations);
  const { title, sub } = headline(o, confirmed, pending, depth);
  const { at, halted } = stage(o);
  const terminal = ["delivered", "refunded", "expired", "attention"].includes(o.status);
  const showDeposit = o.status === "awaiting" || (o.status === "confirming" && pending === 0n);
  const uri = `zcash:${o.deposit_address}?amount=${formatZec(o.zat_requested - confirmed).replace(/,/g, "")}`;
  const qr = showDeposit ? await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 440, color: { dark: "#0b0b0f", light: "#ffffff" } }) : null;
  const bid = BigInt(o.final_bid_wei ?? o.bid_wei);

  return (
    <>
      {/* Refreshes itself, so the page works with JavaScript off. */}
      {terminal ? null : <meta httpEquiv="refresh" content="15" />}
      <div className="zec-order">
        <div className="zec-order-head">
          <span className="eyebrow mono">bid {o.id}</span>
          {terminal ? null : <span className="hint">refreshes every 15s</span>}
        </div>
        <h1>{title}</h1>
        <p className="lede">{sub}</p>

        <ol className="stages" aria-label="Progress">
          {STAGES.map((s, i) => (
            <li key={s} className={i < at ? "past" : i === at ? (halted ? "halt" : "now") : ""}>
              {s}
            </li>
          ))}
        </ol>

        {showDeposit ? (
          <div className="deposit card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr ? <img className="qr" src={qr} alt="QR code with the deposit address and amount" width={220} height={220} /> : null}
            <div style={{ minWidth: 0 }}>
              <div className="big mono">
                {formatZec(o.zat_requested - confirmed)} <small>ZEC</small>
              </div>
              <div className="hint">≈ {formatUsd((o.zat_requested * o.zec_usd) / 100_000_000n)} · quote holds until {hhmm(o.expires_at)}</div>
              <div className="addr">{o.deposit_address}</div>
              <p className="hint">A shielded address for this bid only. Pay from a shielded wallet: from a transparent address, the sender is public.</p>
              <a className="btn ghost sm" href={uri}>
                Open in wallet
              </a>
            </div>
          </div>
        ) : null}

        <h3 style={{ marginTop: 32 }}>This bid</h3>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <tbody>
              <tr>
                <td>Launch</td>
                <td className="r">
                  <Link href={`/l/${o.launch_id}`}>${o.symbol}</Link>
                </td>
              </tr>
              <tr>
                <td>{o.final_bid_wei ? "Sealed bid" : "Bid"}</td>
                <td className="r mono">{formatEth(bid)} ETH</td>
              </tr>
              {o.cover_wei ? (
                <tr>
                  <td>Cover (Sigil&rsquo;s, returned at reveal)</td>
                  <td className="r mono">{formatEth(BigInt(o.cover_wei))} ETH</td>
                </tr>
              ) : null}
              <tr>
                <td>{o.priced_late ? "Rate when it landed" : "Locked rate"}</td>
                <td className="r mono">1 ZEC = {formatUsd(o.zec_usd)} · 1 ETH = {formatUsd(o.eth_usd)}</td>
              </tr>
              <tr>
                <td>Tokens go to</td>
                <td className="r mono">{o.dest_address ?? "erased"}</td>
              </tr>
              {o.refund_address ? (
                <tr>
                  <td>Refunds go to</td>
                  <td className="r mono">{o.refund_address.slice(0, 16)}…</td>
                </tr>
              ) : null}
              <TxLink hash={o.seal_tx} label="Sealed" />
              <TxLink hash={o.reveal_tx} label="Revealed" />
              <TxLink hash={o.deliver_tx} label="Tokens sent" />
              <TxLink hash={o.refund_tx} label="ETH returned" />
            </tbody>
          </table>
        </div>
        <p className="notice" style={{ marginTop: 18 }}>
          This page is your receipt. There&rsquo;s no account and no email: keep the link to come back. Addresses on this
          bid are erased {cfg().orders.retentionDays} days after it closes.
        </p>
      </div>
    </>
  );
}
