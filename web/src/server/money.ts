// Copied from Undertow. Amounts are bigints in their smallest unit everywhere. Floats never touch
// money: a ZEC amount typed by a user becomes zatoshis by string parsing, and
// prices become integer micro-dollars before any multiplication.

export const ZAT_PER_ZEC = 100_000_000n;
export const WEI_PER_ETH = 10n ** 18n;

/** "1.5" → 150000000n. Rejects anything that isn't a plain decimal with ≤ 8 places. */
export function parseZec(input: string): bigint | null {
  const s = input.trim();
  const m = /^(\d{1,8})(?:\.(\d{1,8}))?$/.exec(s) ?? /^\.(\d{1,8})$/.exec(s);
  if (!m) return null;
  const [whole, frac] = m.length === 3 ? [m[1] ?? "0", m[2] ?? ""] : ["0", m[1] ?? ""];
  return BigInt(whole) * ZAT_PER_ZEC + BigInt(frac.padEnd(8, "0"));
}

/** 150000000n → "1.5" */
export function formatZec(zat: bigint): string {
  return trimUnits(zat, 8);
}

/** Wei → "0.0123" with at most `places` decimals, rounded down. */
export function formatEth(wei: bigint, places = 6): string {
  return trimUnits(wei / 10n ** BigInt(18 - places), places);
}

/** Token base units → human string, rounded down to `places` significant decimals. */
export function formatUnits(amount: bigint, decimals: number, places = 4): string {
  if (decimals <= places) return trimUnits(amount, decimals);
  return trimUnits(amount / 10n ** BigInt(decimals - places), places);
}

function trimUnits(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString("en-US");
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** A USD price as integer micro-dollars. */
export function toMicroUsd(price: number): bigint {
  if (!Number.isFinite(price) || price <= 0) throw new Error(`bad price ${price}`);
  return BigInt(Math.round(price * 1e6));
}

export function formatUsd(micro: bigint): string {
  const cents = micro / 10_000n;
  return `$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export interface Rate {
  zecUsd: bigint; // micro-USD
  ethUsd: bigint; // micro-USD
}

/** Gross ETH value of `zat` at `rate`, before any fee. */
export function zatToWei(zat: bigint, rate: Rate): bigint {
  return (zat * rate.zecUsd * WEI_PER_ETH) / (ZAT_PER_ZEC * rate.ethUsd);
}

export function usdValue(zat: bigint, rate: Rate): bigint {
  return (zat * rate.zecUsd) / ZAT_PER_ZEC;
}

export function bpsDiff(a: bigint, b: bigint): number {
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  return Number(((hi - lo) * 10_000n) / hi);
}
