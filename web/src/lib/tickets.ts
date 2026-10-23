import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * A sealed bid's secret: the real amount and the salt. Without it the bid
 * can't be revealed, and an unrevealed bid loses 10%. It never leaves the
 * browser except as a file the bidder downloads.
 */
export type Ticket = {
  v: 1;
  chainId: number;
  relay: Address;
  launchId: number;
  bidder: Address;
  amount: string; // wei, decimal string
  deposit: string; // wei
  salt: Hex;
  symbol: string;
  sealedAt: number;
};

/** Must match RelayLaunchpad.commitmentOf exactly. */
export function commitmentOf(launchId: number, bidder: Address, amount: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }], [BigInt(launchId), bidder, amount, salt]),
  );
}

export function newSalt(): Hex {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

const KEY = "relay:tickets:v1";

function key(t: Pick<Ticket, "chainId" | "relay" | "launchId" | "bidder">) {
  return `${t.chainId}:${t.relay.toLowerCase()}:${t.launchId}:${t.bidder.toLowerCase()}`;
}

export function loadTickets(): Ticket[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (Object.values(JSON.parse(raw)) as Ticket[]) : [];
  } catch {
    return [];
  }
}

export function saveTicket(t: Ticket) {
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Ticket>) : {};
    all[key(t)] = t;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode or blocked storage: the downloaded file is the backup.
  }
}

export function findTicket(chainId: number, relay: Address, launchId: number, bidder: Address): Ticket | null {
  return loadTickets().find((t) => key(t) === key({ chainId, relay, launchId, bidder })) ?? null;
}

export function parseTicket(text: string): Ticket | null {
  try {
    const t = JSON.parse(text) as Ticket;
    if (t.v !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(t.salt) || !/^\d+$/.test(t.amount)) return null;
    return t;
  } catch {
    return null;
  }
}

export function downloadTicket(t: Ticket) {
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sigil-reveal-key-${t.symbol.toLowerCase()}-${t.launchId}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
