import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { LogoMark } from "@/components/logo";
import { NetStatus } from "@/components/net-status";
import { Tape } from "@/components/tape";
import { IS_LOCAL, RELAY_ADDRESS } from "@/lib/chain";
import { WalletProvider } from "@/lib/wallet";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3800"),
  openGraph: { siteName: "Sigil", type: "website" },
  twitter: { card: "summary_large_image" },
  title: { default: "Sigil · sealed launches on Robinhood Chain", template: "%s · Sigil" },
  description:
    "Launch a token where every bid is sealed. No snipers, no bundles, no front-running: bids open together and everyone pays one fair price.",
};

// Baked in at build time like the contract address: most pages are static.
const ONION = process.env.NEXT_PUBLIC_ONION_ADDRESS;
const X_URL = process.env.NEXT_PUBLIC_X_URL;
const TG_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL;
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL;

export const viewport: Viewport = { themeColor: "#fcfbff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          {IS_LOCAL ? <div className="devbar">LOCAL CHAIN · test ETH only · {RELAY_ADDRESS.slice(0, 10)}…</div> : null}
          <Header />
          <Tape />
          <main className="shell">{children}</main>
          <footer className="foot">
            <div className="shell">
              <div className="foot-grid">
                <div className="foot-brand">
                  <Link href="/" className="foot-logo">
                    <LogoMark variant="sigil" size={22} />
                    <b>Sigil</b>
                  </Link>
                  <p>Sealed-bid token launches on Robinhood Chain.</p>
                  {X_URL || TG_URL ? (
                    <div className="foot-social">
                      {X_URL ? (
                        <a href={X_URL} target="_blank" rel="noreferrer">
                          X
                        </a>
                      ) : null}
                      {TG_URL ? (
                        <a href={TG_URL} target="_blank" rel="noreferrer">
                          Telegram
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <nav aria-label="Product">
                  <h4>Product</h4>
                  <Link href="/">Launches</Link>
                  <Link href="/launch">Launch a token</Link>
                  <Link href="/bids">My bids</Link>
                  <Link href="/zec">Bid with ZEC</Link>
                </nav>
                <nav aria-label="Resources">
                  <h4>Resources</h4>
                  <Link href="/how">How it works</Link>
                  <Link href="/how#rules">Fees and rules</Link>
                  {GITHUB_URL ? (
                    <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                      Source code
                    </a>
                  ) : null}
                </nav>
                <nav aria-label="Legal">
                  <h4>Legal</h4>
                  <Link href="/legal#terms">Terms</Link>
                  <Link href="/legal#privacy">Privacy</Link>
                  <Link href="/legal#risks">Risks</Link>
                </nav>
              </div>
              <div className="foot-bar">
                <NetStatus />
                <span>The contracts have not been audited.</span>
              </div>
              {ONION ? (
                <p>
                  Onion address: <span className="onion">{ONION}</span>. Check it matches every time.
                </p>
              ) : null}
              <p>
                © {new Date().getFullYear()} Sigil. Tokens launched here can lose all their value; nothing on this site is
                investment advice. Sigil is not affiliated with Robinhood Markets, Inc.
              </p>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
