"use client";

import { useEffect, useState } from "react";
import { chain, DEPLOYED, explorer, publicClient, RELAY_ADDRESS } from "@/lib/chain";

/** Footer line: is the chain reachable, its latest block, and the contract with copy + explorer link. */
export function NetStatus() {
  const [block, setBlock] = useState<bigint | null>(null);
  const [down, setDown] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      publicClient
        .getBlockNumber({ cacheTime: 0 })
        .then((b) => {
          if (!alive) return;
          setBlock(b);
          setDown(false);
        })
        .catch(() => alive && setDown(true));
    tick();
    const t = setInterval(tick, 12_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const link = DEPLOYED ? explorer(`address/${RELAY_ADDRESS}`) : null;

  return (
    <div className="net">
      <span className={`net-dot${down ? " down" : block !== null ? " up" : ""}`} aria-hidden />
      <span>
        {chain.name}
        {down ? " · unreachable" : block !== null ? <> · block <span className="mono">{block.toLocaleString("en-US")}</span></> : " · connecting…"}
      </span>
      {DEPLOYED ? (
        <span className="net-addr">
          Contract{" "}
          {link ? (
            <a className="mono" href={link} target="_blank" rel="noreferrer">
              {RELAY_ADDRESS.slice(0, 6)}…{RELAY_ADDRESS.slice(-4)}
            </a>
          ) : (
            <span className="mono">
              {RELAY_ADDRESS.slice(0, 6)}…{RELAY_ADDRESS.slice(-4)}
            </span>
          )}
          <button
            type="button"
            className="net-copy"
            onClick={() =>
              navigator.clipboard
                .writeText(RELAY_ADDRESS)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {})
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      ) : null}
    </div>
  );
}
