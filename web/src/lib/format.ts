import { formatEther } from "viem";

export function eth(wei: bigint, digits = 4): string {
  const n = Number(formatEther(wei));
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function tokens(wei: bigint): string {
  const n = Number(formatEther(wei));
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** ETH per token, tiny numbers as 0.0₇123. */
export function price(n: number): string {
  if (!n) return "—";
  if (n >= 0.0001) return n.toPrecision(4);
  const s = n.toFixed(30);
  const zeros = s.slice(2).match(/^0*/)![0].length;
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[+d]).join("");
  return `0.0${sub}${s.slice(2 + zeros, 2 + zeros + 4)}`;
}

export function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function duration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} min`;
}
