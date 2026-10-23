import Link from "next/link";

const STEPS = [
  {
    title: "Get a quote",
    body: "Pick a launch, a bid in ETH and the address the tokens go to. The ZEC rate is locked for 30 minutes at the median of Kraken, Coinbase and CoinGecko.",
  },
  {
    title: "Pay in shielded ZEC",
    body: "Send to a one-time shielded address from any Zcash wallet. The order counts as paid after 3 confirmations.",
  },
  {
    title: "Sigil seals the bid",
    body: "A new wallet that has never been used before places your bid, with 25–100% extra cover so the deposit doesn't give its size away.",
  },
  {
    title: "Reveal and delivery",
    body: "Sigil reveals the bid for you when the window closes. Tokens go to your address, or the bid comes back as ETH if the launch is returned.",
  },
];

/**
 * The home page's section on ZEC bids: dark panel on a white page, with the
 * order flow as it actually runs on the right.
 */
export function ZecFeature() {
  return (
    <section className="zf" aria-labelledby="zf-title">
      <div className="zf-copy">
        <span className="zf-badge">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden>
            <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
          </svg>
          Shielded ZEC
        </span>
        <h2 id="zf-title">
          Bid from Zcash.
          <br />
          <span className="zf-soft">No wallet to connect.</span>
        </h2>
        <p>
          Pay a sealed bid in shielded ZEC and Sigil places it on Robinhood Chain from a wallet of its own. The bid on
          chain isn&rsquo;t linked to the person who paid for it.
        </p>
        <p className="zf-fine">
          Sigil holds the funds from payment until the launch settles. The ZEC pages work with JavaScript off and over
          Tor.
        </p>
        <div className="zf-actions">
          <Link href="/zec" className="btn light">
            Start a ZEC bid
          </Link>
        </div>
      </div>

      <ol className="zf-flow">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="zf-n">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <b>{s.title}</b>
              <span>{s.body}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
