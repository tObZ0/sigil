import { cfg } from "./config";
import { bpsDiff, toMicroUsd, type Rate } from "./money";

// Three independent sources. A quote needs at least two of them to answer
// and to agree; we then use the median. One bad feed can't set the price,
// and if the market is moving too fast to agree on one, we stop quoting.

type Source = { name: string; fetch: () => Promise<{ zec: number; eth: number }> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

const sources: Source[] = [
  {
    name: "kraken",
    async fetch() {
      const last = async (pair: string) => {
        const body = await json(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
        const ticker = Object.values(body.result ?? {})[0] as { c?: [string] } | undefined;
        return Number(ticker?.c?.[0]);
      };
      const [zec, eth] = await Promise.all([last("ZECUSD"), last("ETHUSD")]);
      return { zec, eth };
    },
  },
  {
    name: "coinbase",
    async fetch() {
      const spot = async (pair: string) =>
        Number((await json(`https://api.coinbase.com/v2/prices/${pair}/spot`)).data?.amount);
      const [zec, eth] = await Promise.all([spot("ZEC-USD"), spot("ETH-USD")]);
      return { zec, eth };
    },
  },
  {
    name: "coingecko",
    async fetch() {
      const body = await json("https://api.coingecko.com/api/v3/simple/price?ids=zcash,ethereum&vs_currencies=usd");
      return { zec: Number(body.zcash?.usd), eth: Number(body.ethereum?.usd) };
    },
  },
];

export class PriceUnavailable extends Error {}

const TTL_MS = 30_000;
let cached: { rate: Rate; at: number } | null = null;
let inflight: Promise<Rate> | null = null;

export async function currentRate(): Promise<Rate> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate;
  inflight ??= fetchRate().finally(() => (inflight = null));
  const rate = await inflight;
  cached = { rate, at: Date.now() };
  return rate;
}

async function fetchRate(): Promise<Rate> {
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));
  const quotes: Rate[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.warn(`price: ${sources[i]!.name} failed: ${r.reason}`);
      return;
    }
    try {
      quotes.push({ zecUsd: toMicroUsd(r.value.zec), ethUsd: toMicroUsd(r.value.eth) });
    } catch {
      console.warn(`price: ${sources[i]!.name} returned nonsense`);
    }
  });
  if (quotes.length < 2) throw new PriceUnavailable("not enough price sources answered");

  const rate = { zecUsd: median(quotes.map((q) => q.zecUsd)), ethUsd: median(quotes.map((q) => q.ethUsd)) };
  for (const q of quotes) {
    if (
      bpsDiff(q.zecUsd, rate.zecUsd) > cfg().prices.maxSpreadBps ||
      bpsDiff(q.ethUsd, rate.ethUsd) > cfg().prices.maxSpreadBps
    ) {
      throw new PriceUnavailable("price sources disagree; the market is moving too fast to quote");
    }
  }
  return rate;
}

function median(xs: bigint[]): bigint {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n;
}
