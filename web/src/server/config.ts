import { parseEther, type Hex } from "viem";
import { parseZec } from "./money";

/*
 * Settings for the ZEC relayer: the order pages (inside Next) and the worker
 * both read them. Read lazily, so `next build` never needs the secrets; a
 * missing value fails at first use with a sentence saying what to set.
 */

function str(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set. See web/.env.example.`);
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number, got "${raw}"`);
  return n;
}

function eth(name: string, fallback: string): bigint {
  return parseEther(str(name, fallback));
}

function zec(name: string, fallback: string): bigint {
  const v = parseZec(process.env[name] ?? fallback);
  if (v === null) throw new Error(`${name} must be a ZEC amount like 0.5`);
  return v;
}

export function zecEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

let cached: ReturnType<typeof load> | null = null;
export function cfg() {
  return (cached ??= load());
}

function load() {
  const mode = str("ZCASH_MODE", "live") as "live" | "dev";
  return {
    databaseUrl: str("DATABASE_URL"),
    onionAddress: process.env.ONION_ADDRESS?.trim() || null,
    zcash: {
      mode,
      network: str("ZCASH_NETWORK", "main") as "main" | "test",
      // Secrets are getters: the Vercel site reads the rest of these settings
      // but never has the keys, and only the worker's code paths touch them.
      get ufvk(): string {
        return mode === "live" ? str("RELAY_UFVK") : "";
      },
      /** Height to start scanning from on a fresh database. */
      birthday: int("SCAN_BIRTHDAY", 0),
      scannerBin: str("SCANNER_BIN", "relay-scanner"),
      confirmations: int("CONFIRMATIONS", 3),
    },
    relayer: {
      /** Sigil's float on Robinhood Chain: funds every ZEC bid. */
      get hotKey(): Hex {
        // Wallets export keys with or without the 0x; viem needs it.
        const k = str("HOT_WALLET_KEY");
        return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
      },
      /** Seed for the per-order bidding wallets. Losing it strands tokens mid-launch. */
      get orderSeed(): Hex {
        return str("ORDER_KEY_SEED") as Hex;
      },
      /** ETH the hot wallet always keeps for its own gas. */
      reserve: eth("HOT_WALLET_RESERVE_ETH", "0.002"),
      /** Gas money each bidding wallet gets for seal, reveal, claim and delivery. */
      bidderGas: eth("BIDDER_GAS_ETH", "0.0006"),
      /** ETH sent with the tokens so the bidder can move or sell them. */
      drip: eth("GAS_DRIP_ETH", "0.0003"),
    },
    orders: {
      feeBps: int("ZEC_FEE_BPS", 100),
      minBid: eth("MIN_BID_ETH", "0.002"),
      maxBid: eth("MAX_BID_ETH", "2"),
      maxZat: zec("MAX_ZEC", "100"),
      quoteMinutes: int("QUOTE_MINUTES", 30),
      /** Minutes a quote must leave before the seal breaks, so a late payment can still be sealed. */
      sealMargin: int("SEAL_MARGIN_MINUTES", 10),
      retentionDays: int("RETENTION_DAYS", 3),
    },
    prices: { maxSpreadBps: int("PRICE_MAX_SPREAD_BPS", 150) },
  };
}
