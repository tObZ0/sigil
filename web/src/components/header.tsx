"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ZEC_ON } from "@/lib/chain";
import { short } from "@/lib/format";
import { LogoMark } from "./logo";
import { useWallet } from "@/lib/wallet";

const LINKS = [
  { href: "/", label: "Launches" },
  { href: "/launch", label: "Launch a token" },
  { href: "/bids", label: "My bids" },
  ...(ZEC_ON ? [{ href: "/zec", label: "Bid with ZEC" }] : []),
  { href: "/how", label: "How it works" },
];

const X_URL = process.env.NEXT_PUBLIC_X_URL;

export function Header() {
  const path = usePathname();
  // Phones get a menu button instead of the inline links. It closes whenever
  // the page changes, so a tapped link never leaves it hanging open.
  const [menu, setMenu] = useState<string | null>(null);
  const open = menu === path;
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined;
  return (
    <header className="top">
      <div className="shell top-row">
        <Link href="/" className="brand" aria-label="Sigil home">
          <LogoMark variant="sigil" size={28} />
          <span className="brand-word">Sigil</span>
        </Link>
        <nav className="nav" aria-label="Sections">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current(l.href)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="top-end">
          {X_URL ? (
            <a href={X_URL} target="_blank" rel="noreferrer" className="x-link" aria-label="Sigil on X">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
                <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z" />
              </svg>
            </a>
          ) : null}
          <WalletButton />
          <button
            type="button"
            className="menu-btn"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setMenu(open ? null : path)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-menu" className="mobile-menu" aria-label="Sections">
          <div className="shell">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={current(l.href)} onClick={() => setMenu(null)}>
                {l.label}
              </Link>
            ))}
            {X_URL ? (
              <a href={X_URL} target="_blank" rel="noreferrer" className="mobile-menu-x">
                Follow on X
              </a>
            ) : null}
          </div>
        </nav>
      ) : null}
    </header>
  );
}

export function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("click", off);
    return () => removeEventListener("click", off);
  }, []);

  if (w.account && w.wrongChain) {
    return (
      <button className="btn sm" onClick={() => w.switchChain()}>
        Switch to Robinhood Chain
      </button>
    );
  }
  return (
    <div className="wallet" ref={ref}>
      <button className={w.account ? "btn ghost sm" : "btn sm"} onClick={() => setOpen((o) => !o)}>
        {w.account ? (
          <>
            <i style={{ width: 8, height: 8, borderRadius: 9, background: "var(--glow)", display: "inline-block" }} /> {short(w.account)}
          </>
        ) : (
          "Connect"
        )}
      </button>
      {open ? (
        <div className="wallet-menu">
          {w.account ? (
            <button
              onClick={() => {
                w.disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          ) : (
            <>
              {w.wallets.map((x) => (
                <button
                  key={x.info.uuid}
                  onClick={async () => {
                    try {
                      await w.connect(x);
                      setOpen(false);
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.info.icon} alt="" /> {x.info.name}
                </button>
              ))}
              {w.wallets.length === 0 ? (
                <button
                  onClick={async () => {
                    try {
                      await w.connect();
                      setOpen(false);
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Browser wallet
                </button>
              ) : null}
              {w.devAvailable ? (
                <button
                  onClick={() => {
                    w.connectDev();
                    setOpen(false);
                  }}
                >
                  🧪 Dev wallet (local chain)
                </button>
              ) : null}
              {err ? <div className="note err">{err}</div> : <div className="note">Rabby, MetaMask, or any EIP-6963 wallet.</div>}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
