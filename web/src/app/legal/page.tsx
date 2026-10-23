import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms, privacy and risks",
  description: "The terms for using Sigil, what data it keeps, and the risks of sealed token launches.",
};

const UPDATED = "23 October 2026";

export default function LegalPage() {
  return (
    <>
      <header style={{ padding: "56px 0 20px" }}>
        <span className="kicker">Last updated {UPDATED}</span>
        <h1 style={{ marginTop: 16 }}>Terms, privacy and risks</h1>
        <p className="lede">Plain-language terms for using this site and the Sigil contracts. Please read them before you bid or launch.</p>
        <nav className="toc" aria-label="On this page">
          <a href="#terms">Terms</a>
          <a href="#privacy">Privacy</a>
          <a href="#risks">Risks</a>
        </nav>
      </header>

      <div className="prose">
        <h2 id="terms">Terms of use</h2>
        <p>
          This site is an interface to smart contracts on Robinhood Chain. Launches, bids, reveals and trades are
          transactions you sign and send yourself; the contracts run them exactly as written and nobody, including the
          people who run this site, can reverse them.
        </p>
        <ul>
          <li>You are responsible for your wallet, your keys and the reveal keys you download. Lost reveal keys can&rsquo;t be recovered.</li>
          <li>Anyone can create a launch. Sigil doesn&rsquo;t review, endorse or vouch for any token listed here.</li>
          <li>
            Don&rsquo;t use Sigil if you&rsquo;re in a place where doing so is against the law, or if you&rsquo;re subject to
            sanctions.
          </li>
          <li>The site and contracts are provided as they are, without warranties of any kind.</li>
          <li>
            Fees are set in the contract and shown on <Link href="/how#rules">How it works</Link> before you sign anything.
          </li>
        </ul>
        <p>
          <b>ZEC bids</b> are different: when you pay in ZEC, Sigil holds your funds and places the bid for you until the
          launch settles. If something goes wrong that the system can&rsquo;t settle on its own, the order is stopped for a
          person to look at, and any ZEC refund is sent by hand.
        </p>

        <h2 id="privacy">Privacy</h2>
        <ul>
          <li>No accounts, no analytics, no tracking cookies.</li>
          <li>
            Your reveal keys and the wallet you last used are kept in your own browser (local storage). They never leave
            your device unless you download them.
          </li>
          <li>Blockchain data is public by nature. Anything you do on-chain can be seen by anyone, forever.</li>
          <li>
            For a ZEC bid, Sigil stores the order: the launch, the bid, the amounts and the address the tokens go to. A few
            days after the order closes, the destination address and bid secret are deleted; the rest stays as an
            accounting record.
          </li>
          <li>Pages may set one short-lived cookie to show a form error after a page reload. It holds nothing else.</li>
        </ul>

        <h2 id="risks">Risks</h2>
        <ul>
          <li>
            <b>Tokens can go to zero.</b> Most launched tokens lose most or all of their value. Only bid what you can afford
            to lose.
          </li>
          <li>
            <b>The contracts haven&rsquo;t been audited.</b> Bugs in smart contracts can lead to lost funds.
          </li>
          <li>
            <b>Missed reveals cost money.</b> If you don&rsquo;t reveal your bid in time and the launch goes live, 10% of
            your deposit goes to the pool.
          </li>
          <li>
            <b>Privacy has limits.</b> The wallet that seals a bid and the size of its deposit are public. Read{" "}
            <Link href="/how">what a seal doesn&rsquo;t hide</Link>.
          </li>
          <li>
            <b>ZEC bids are custodial.</b> Between payment and delivery your funds are held by Sigil, and exchange rates
            can move against you.
          </li>
        </ul>
        <p>Nothing on this site is financial, investment, legal or tax advice.</p>
      </div>
    </>
  );
}
