import type { Activity, Launch } from "@/lib/relay";
import { Price } from "./bits";

/** Pool price after every swap, starting from the sale price everyone paid. */
export function PriceChart({ l, activity }: { l: Launch; activity: Activity[] }) {
  const sale = Number(l.raised) / 5e26;
  const pts = [sale, ...activity.filter((a) => a.kind === "swap").map((a) => (a.kind === "swap" ? Number(a.ethReserve) / Number(a.tokenReserve) : 0))];
  if (pts.length < 2) {
    return <div className="empty" style={{ padding: 28 }}>No trades yet. The pool opened at the sale price, <Price value={sale} /> ETH.</div>;
  }
  const W = 640;
  const H = 220;
  const pad = 14;
  const lo = Math.min(...pts) * 0.97;
  const hi = Math.max(...pts) * 1.03;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  const up = last >= sale;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pool price after each trade">
      <defs>
        <linearGradient id="pc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" stopOpacity="0.35" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={pad} x2={W - pad} y1={y(sale)} y2={y(sale)} stroke="#7c3aed" strokeDasharray="4 6" strokeOpacity="0.6" />
      <text x={W - pad} y={y(sale) - 6} textAnchor="end" fontSize="11" fill="#7c3aed">
        sale price
      </text>
      <path d={`${line} L${x(pts.length - 1)},${H - pad} L${x(0)},${H - pad} Z`} fill="url(#pc)" />
      <path d={line} fill="none" stroke={up ? "#7c3aed" : "#b5541c"} strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={i === pts.length - 1 ? 4.5 : 2.5} fill={i === 0 ? "#1a0f33" : "#7c3aed"} />
      ))}
    </svg>
  );
}
