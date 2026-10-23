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

export function Header() {
  const path = usePathname();
  return (
    <header className="top">
      <div className="shell top-row">
        <Link href="/" className="brand" aria-label="Sigil home">
          <LogoMark variant="sigil" size={28} />
          <span className="brand-word">Sigil</span>
        </Link>
        <nav className="nav" aria-label="Sections">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={(l.href === "/" ? path === "/" : path.startsWith(l.href)) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <WalletButton />
      </div>
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
