import type { Metadata } from "next";
import Link from "next/link";
import { explorer, RELAY_ADDRESS } from "@/lib/chain";

export const metadata: Metadata = {
  title: "How it works",
  description: "The rules of a Sigil sealed launch: sealing, cover, reveal, one price, and a pool locked forever.",
};

export default function HowPage() {
  const contract = explorer(`address/${RELAY_ADDRESS}`);
  return (
    <>
      <header style={{ padding: "56px 0 20px" }}>
        <span className="kicker">The rules</span>
        <h1 style={{ marginTop: 16 }}>
          Why a seal <em>beats a race.</em>
        </h1>
        <p className="lede">
          On a normal launchpad, the first block wins. Bots buy before you can click, bundlers hide behind fifty wallets, and
          the price you pay depends on who saw it first. Sigil removes the race: nobody can act on anyone else&rsquo;s bid,
          because nobody can read it.
        </p>
      </header>

      <div className="prose">
        <h2>1. The sealed window</h2>
        <p>
          A bid goes on-chain as a hash, <code>keccak256(launch, your wallet, amount, secret)</code>, plus ETH to back it. The
          hash says nothing about the amount. Because the hash includes your wallet, nobody can copy your sealed bid.
        </p>
        <p>
          The ETH you send is visible, so Sigil lets you add <b>cover</b>: extra ETH on top of your real bid. A 1 ETH bid
          with 100% cover looks exactly like a 2 ETH bid until you reveal. Cover is refunded the moment you reveal.
        </p>
        <p>One sealed bid per wallet, per launch.</p>

        <h2>2. The reveal window</h2>
        <p>
          When sealing closes, you reveal your bid: the site sends your amount and secret, and the contract checks them
          against the hash. If they match, your bid counts and your cover comes straight back.
        </p>
        <p>
          Your secret lives in this browser and in the reveal key you download when you seal. <b>Keep the file.</b> A
          bid that&rsquo;s never revealed doesn&rsquo;t count, and if the launch goes ahead it loses 10% of its deposit to the
          pool. That penalty is what stops people sealing big bids and quietly walking away once they&rsquo;ve seen the
          others.
        </p>

        <h2>3. One price</h2>
        <p>
          500,000,000 tokens are for sale. When the reveal window closes, anyone can settle the launch. Every revealed bid
          gets <code>bid ÷ total raised × 500M</code> tokens. That&rsquo;s the same price per token for everybody: the
          first bid and the last, the whale and the minnow.
        </p>
        <p>If the revealed total is under the creator&rsquo;s minimum raise, the launch is returned: every bidder claims all of their ETH back.</p>

        <h2>4. A pool that can&rsquo;t be pulled</h2>
        <p>
          The raise, less 1.5% in fees (1% platform, 0.5% creator) and plus any no-reveal penalties, goes into a pool inside
          the Sigil contract. It opens at exactly the sale price. There are no LP tokens and no function to remove the
          liquidity: it&rsquo;s locked forever. Of the other 500M tokens, as many as the pool needs go into it, and the rest
          are burned.
        </p>
        <p>Trades pay a 1% fee in ETH, split between the creator and the platform.</p>

        <h2>What it doesn&rsquo;t hide</h2>
        <ul>
          <li>The wallet that seals a bid is public. Seal from a fresh wallet if that matters to you.</li>
          <li>Deposit sizes are public. Cover is how you blur them.</li>
          <li>Revealed bids are public once revealed, as is every trade after.</li>
        </ul>

        <h2 id="rules">The numbers</h2>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <tbody>
              <tr>
                <td>Supply</td>
                <td className="r">1,000,000,000 · no team allocation</td>
              </tr>
              <tr>
                <td>Sold in the sealed sale</td>
                <td className="r">500,000,000</td>
              </tr>
              <tr>
                <td>Fees on the raise</td>
                <td className="r">1% platform · 0.5% creator</td>
              </tr>
              <tr>
                <td>Swap fee</td>
                <td className="r">1% · half creator, half platform</td>
              </tr>
              <tr>
                <td>Unrevealed bid</td>
                <td className="r">10% to the pool if the launch goes live</td>
              </tr>
              <tr>
                <td>Sealed window</td>
                <td className="r">10 minutes to 7 days</td>
              </tr>
              <tr>
                <td>Reveal window</td>
                <td className="r">10 minutes to 2 days</td>
              </tr>
              <tr>
                <td>Minimum raise</td>
                <td className="r">set by the creator, at least 0.01 ETH</td>
              </tr>
              <tr>
                <td>Contract</td>
                <td className="r mono">{contract ? <a href={contract}>{RELAY_ADDRESS}</a> : RELAY_ADDRESS || "not deployed yet"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 30 }}>
          <Link href="/launch" className="btn">
            Launch a token
          </Link>
        </p>
      </div>
    </>
  );
}
