import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { chainNow, fetchLaunches } from "@/lib/relay";
import { countdown } from "@/lib/format";
import { cfg, zecEnabled } from "@/server/config";
import { formatEth } from "@/server/money";
import type { FormErrors, OrderForm } from "@/server/orders";
import { notFound } from "next/navigation";
import { ZEC_ON } from "@/lib/chain";
import { createZecOrder } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bid with shielded ZEC",
  description: "Seal a bid on a Sigil launch with shielded Zcash. No wallet, no trail back to you.",
};

export default async function ZecPage({ searchParams }: { searchParams: Promise<{ launch?: string }> }) {
  if (!ZEC_ON || !zecEnabled()) notFound();
  const { launch: chosen } = await searchParams;
  const flash = (await cookies()).get("zec_form")?.value;
  let f: OrderForm = { launchId: chosen ?? "", bid: "", dest: "", refund: "" };
  let errors: FormErrors = {};
  try {
    if (flash) ({ f, errors } = JSON.parse(flash) as { f: OrderForm; errors: FormErrors });
  } catch {}

  // Chain time, not wall time: phases follow block timestamps.
  const now = await chainNow().catch(() => null);
  const open = (await fetchLaunches().catch(() => [])).filter((l) => now !== null && l.phase === "sealing" && l.sealEnd - now > 15 * 60);
  const o = cfg().orders;
  const r = cfg().relayer;

  return (
    <>
      <section className="page-head">
        <span className="eyebrow">No wallet needed</span>
        <h1>
          Bid with shielded <em>ZEC</em>
        </h1>
        <p className="lede">
          Pay from any shielded Zcash wallet. Sigil seals the bid for you from a fresh wallet of its own, reveals it for
          you, and sends the tokens to your address. On-chain, nothing leads back to whoever paid.
        </p>
      </section>

      <div className="zec-grid">
        <form action={createZecOrder} className="card">
          {errors.form ? <p className="notice warn">{errors.form}</p> : null}
          <div className="field">
            <label htmlFor="launch">Launch</label>
            {open.length ? (
              <select id="launch" name="launch" className="input" defaultValue={f.launchId}>
                {open.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} (${l.symbol}): seal breaks in {countdown(l.sealEnd - (now ?? 0))}
                  </option>
                ))}
              </select>
            ) : (
              <p className="hint">No launch is taking sealed bids right now.</p>
            )}
            {errors.launchId ? <span className="err">{errors.launchId}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="bid">
              Your bid <small>the ETH that goes into the sealed bid</small>
            </label>
            <div className="input-row">
              <input id="bid" name="bid" className="input mono" inputMode="decimal" placeholder="0.25" defaultValue={f.bid} autoComplete="off" />
              <span>ETH</span>
            </div>
            {errors.bid ? <span className="err">{errors.bid}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="dest">
              Your Robinhood Chain address <small>where the tokens go; use a fresh one</small>
            </label>
            <input id="dest" name="dest" className="input mono" placeholder="0x…" defaultValue={f.dest} autoComplete="off" spellCheck={false} />
            {errors.dest ? <span className="err">{errors.dest}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="refund">
              Refund address <small>optional, shielded; used only if a payment can&rsquo;t be sealed</small>
            </label>
            <input id="refund" name="refund" className="input mono" placeholder="u1…" defaultValue={f.refund} autoComplete="off" spellCheck={false} />
            {errors.refund ? <span className="err">{errors.refund}</span> : null}
          </div>
          <button type="submit" className="btn block" disabled={!open.length}>
            Get a ZEC deposit address
          </button>
          <p className="hint" style={{ marginBottom: 0 }}>
            The quote holds for {o.quoteMinutes} minutes, or until shortly before the seal breaks, whichever is first.
          </p>
        </form>

        <aside className="card zec-terms">
          <h3>How a ZEC bid works</h3>
          <ol>
            <li>You get a shielded address made for this bid alone, and a locked ZEC price.</li>
            <li>When your ZEC confirms, Sigil funds a fresh bidding wallet and seals your bid, with extra cover so its size stays hidden.</li>
            <li>When the seal breaks, Sigil reveals it for you. You can&rsquo;t miss the reveal.</li>
            <li>Your tokens go to your address, with a little ETH for gas. If the launch is returned, your bid comes back to that address as ETH.</li>
          </ol>
          <table>
            <tbody>
              <tr>
                <td>Fee</td>
                <td className="r">{(o.feeBps / 100).toFixed(2)}% of the bid</td>
              </tr>
              <tr>
                <td>Gas for the bidding wallet</td>
                <td className="r">{formatEth(r.bidderGas)} ETH</td>
              </tr>
              <tr>
                <td>ETH sent with your tokens</td>
                <td className="r">{formatEth(r.drip)} ETH</td>
              </tr>
              <tr>
                <td>Bid size</td>
                <td className="r">
                  {formatEth(o.minBid)} to {formatEth(o.maxBid)} ETH
                </td>
              </tr>
              <tr>
                <td>Paid late or short</td>
                <td className="r">bids what it covers</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            Sigil holds your funds for the minutes between payment and the sealed bid, and the bid itself until the launch
            settles. Size bids with that in mind. <Link href="/how">The launch rules →</Link>
          </p>
        </aside>
      </div>
    </>
  );
}
