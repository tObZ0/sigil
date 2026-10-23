import { useId } from "react";
import { emblemPaths, type Emblem } from "./emblem";

export type SealState = "intact" | "cracked" | "open" | "dull";

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth closed curve through points (Catmull-Rom to cubic Bezier). */
function smooth(pts: (readonly [number, number])[]) {
  const n = pts.length;
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + "Z";
}

/**
 * The puddle of wax: a circle with slow lumps (wax spreading unevenly), fine
 * jitter, and a few spills where it ran further. Same seed, same puddle.
 */
function puddle(seed: string, r: number) {
  const rand = rng(seed);
  const waves = [2, 3, 5].map((k) => ({ k, amp: 1.5 + rand() * 3, ph: rand() * Math.PI * 2 }));
  const spills = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => ({ at: rand() * Math.PI * 2, amp: 5 + rand() * 6, w: 0.18 + rand() * 0.16 }));
  const n = 56;
  return smooth(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      let rr = r + (rand() - 0.5) * 2.2;
      for (const w of waves) rr += Math.sin(a * w.k + w.ph) * w.amp;
      for (const s of spills) {
        const d = Math.atan2(Math.sin(a - s.at), Math.cos(a - s.at));
        rr += s.amp * Math.exp(-(d * d) / (2 * s.w * s.w));
      }
      return [100 + Math.cos(a) * rr, 100 + Math.sin(a) * rr] as const;
    }),
  );
}

/** The stamp's own edge: nearly round, the way a metal die presses. */
function die(seed: string, r: number) {
  const rand = rng(seed + "die");
  const n = 40;
  return smooth(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const rr = r + (rand() - 0.5) * 1.6;
      return [100 + Math.cos(a) * rr, 100 + Math.sin(a) * rr] as const;
    }),
  );
}

/** A jagged crack from top to bottom, plus a couple of hairline branches. */
function crack(seed: string) {
  const rand = rng(seed + "crack");
  const pts: [number, number][] = [[100 + (rand() - 0.5) * 10, 2]];
  for (let y = 16; y < 198; y += 11 + rand() * 9) pts.push([100 + (rand() - 0.5) * 30, y]);
  pts.push([100 + (rand() - 0.5) * 10, 198]);
  const main = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const branches = [0.32, 0.64].map((f) => {
    const p = pts[Math.floor(f * (pts.length - 1))]!;
    const dir = rand() < 0.5 ? -1 : 1;
    const len = 14 + rand() * 14;
    return `M${p[0].toFixed(1)},${p[1].toFixed(1)} l${(dir * len * 0.7).toFixed(1)},${(len * 0.35).toFixed(1)} l${(dir * len * 0.4).toFixed(1)},${(len * 0.5).toFixed(1)}`;
  });
  return { main, branches };
}

const PURPLE = { light: "#c4a5ff", mid: "#7c3aed", dark: "#3b0f8a", deep: "#1e0b4b" };
const GREY = { light: "#dcd8e3", mid: "#ada6bb", dark: "#7a7389", deep: "#3f3a49" };

/**
 * How the seal is made:
 *   wax    glossy pressed wax, the original
 *   flat   a clean flat badge with a scalloped edge
 *   ink    a rubber-stamp impression in purple ink, no fill
 *   coin   a near-black medallion with a thin purple ring (Sigil's, the default)
 */
export type SealLook = "wax" | "flat" | "ink" | "coin";

/** A badge edge: a circle with even scallops. */
function scallop(r: number, bumps = 22) {
  const n = bumps * 2;
  return smooth(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const rr = i % 2 ? r - 4.5 : r;
      return [100 + Math.cos(a) * rr, 100 + Math.sin(a) * rr] as const;
    }),
  );
}

function circlePath(r: number) {
  return `M${100 - r},100 a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0Z`;
}

/**
 * A seal, unique per launch. Intact while bids are sealed, cracked during the
 * reveal, broken open once the launch is live, grey if it failed. `bold`
 * drops the fine detail for logo and favicon sizes.
 */
export function WaxSeal({
  seed,
  letter,
  state = "intact",
  bold = false,
  ring,
  emblem,
  // The black medallion is Sigil's seal; the other looks stay available.
  look = "coin",
}: {
  seed: string;
  /** The ticker: used in the ring lettering. */
  letter: string;
  state?: SealState;
  bold?: boolean;
  /** What's pressed into the middle. Defaults to a sigil generated from the seed. */
  emblem?: Emblem;
  /** Text around the face. Defaults to SIGIL ✦ SEALED ✦ $SYMBOL. */
  ring?: string;
  look?: SealLook;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dull = state === "dull";
  const c = dull ? GREY : PURPLE;
  const outer = look === "wax" ? puddle(seed, 80) : look === "flat" ? scallop(80) : circlePath(78);
  const face = look === "wax" ? die(seed, bold ? 60 : 57) : circlePath(bold ? 62 : 60);
  const cr = crack(seed);
  const ringText = ring ?? `SIGIL ✦ SEALED ✦ $${letter.replace(/^\$/, "").toUpperCase().slice(0, 10)} ✦`;
  const ringR = 44;
  const u = (k: string) => `${k}${id}`;
  const e = emblemPaths(emblem ?? { kind: "sigil", seed }, bold ? 46 : 31, bold);

  // Colours per look: the ring text, the mark, and what shows through a crack.
  const coinBase = dull ? "#27272a" : "#0b0b0f";
  const tone = {
    wax: { text: c.deep, mark: bold ? "#f3ecff" : c.light, crack: c.deep },
    flat: { text: "#ffffff", mark: "#ffffff", crack: "#ffffff" },
    ink: { text: c.mid, mark: c.mid, crack: "#ffffff" },
    coin: { text: dull ? "#a1a1aa" : "#a78bfa", mark: dull ? "#d4d4d8" : "#c4b5fd", crack: dull ? "#a1a1aa" : "#c4b5fd" },
  }[look];

  const markPass = (key: string, dx: number, dy: number, color: string, opacity: number) => (
    <g key={key} transform={`translate(${dx},${dy})`} opacity={opacity}>
      {e.strokes.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={e.width} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {e.fills.map((d, i) => (
        <path key={`f${i}`} d={d} fill={color} />
      ))}
    </g>
  );

  // Wrapped in a group so a page can spin the lettering around the face (see .hero-visual).
  const ringLettering = (opacity: number, dx = 0, dy = 0, color = tone.text) => (
    <g className="seal-ring">
      <text fontFamily="Inter Variable, ui-sans-serif, sans-serif" fontSize="8.6" fontWeight="700" letterSpacing="1.4" fill={color} fillOpacity={opacity} transform={dx || dy ? `translate(${dx},${dy})` : undefined}>
        <textPath href={`#${u("ring")}`} textLength={(2 * Math.PI * ringR - 4).toFixed(1)} lengthAdjust="spacing">
          {ringText}
        </textPath>
      </text>
    </g>
  );

  let body: React.ReactNode;
  if (look === "wax") {
    body = (
      <g>
        <path d={outer} fill={`url(#${u("wax")})`} />
        <path d={outer} fill={`url(#${u("grain")})`} opacity={bold ? 0 : 0.5} style={{ mixBlendMode: "overlay" }} />
        <path d={outer} fill="none" stroke={c.deep} strokeOpacity="0.35" strokeWidth="1.5" />
        <path d={face} fill={`url(#${u("face")})`} />
        <path d={face} fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2" transform="translate(-1.4,-1.4)" />
        <path d={face} fill="none" stroke={c.deep} strokeOpacity="0.6" strokeWidth="2.4" transform="translate(1.6,1.8)" />
        {bold ? null : (
          <>
            {/* bead ring; coordinates rounded so server and browser render identical markup */}
            {Array.from({ length: 36 }, (_, i) => {
              const a = (i / 36) * Math.PI * 2;
              return <circle key={i} cx={(100 + Math.cos(a) * 52).toFixed(2)} cy={(100 + Math.sin(a) * 52).toFixed(2)} r="1.25" fill={c.deep} fillOpacity="0.55" />;
            })}
            {ringLettering(0.62)}
            {ringLettering(0.22, -0.6, -0.6, "#fff")}
          </>
        )}
        {/* embossed: shadow below right, light above left, then the mark itself */}
        {markPass("shadow", 1.6, 2, c.deep, bold ? 0.75 : 0.6)}
        {markPass("light", -1, -1, "#fff", bold ? 0.85 : 0.4)}
        {markPass("mark", 0, 0, tone.mark, 1)}
        <path d={outer} fill={`url(#${u("sheen")})`} />
        <path d="M42,70 Q52,44 80,32" fill="none" stroke="#fff" strokeOpacity={dull ? 0.25 : 0.55} strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="88" cy="28" r="2" fill="#fff" fillOpacity={dull ? 0.25 : 0.6} />
      </g>
    );
  } else if (look === "flat") {
    body = (
      <g>
        <path d={outer} fill={dull ? c.mid : c.mid} />
        <path d={face} fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth={bold ? 3 : 1.6} />
        {bold ? null : ringLettering(0.85)}
        {markPass("mark", 0, 0, tone.mark, 1)}
      </g>
    );
  } else if (look === "ink") {
    body = (
      // A rubber stamp never inks evenly: the rough filter frays the edges.
      <g filter={bold ? undefined : `url(#${u("rough")})`} opacity={dull ? 0.7 : 0.92}>
        <path d={outer} fill={c.mid} fillOpacity="0.05" stroke={c.mid} strokeWidth={bold ? 9 : 4} />
        <path d={face} fill="none" stroke={c.mid} strokeWidth={bold ? 0 : 1.6} />
        {bold ? null : ringLettering(1)}
        {markPass("mark", 0, 0, tone.mark, 1)}
      </g>
    );
  } else {
    body = (
      <g>
        <path d={outer} fill={`url(#${u("coin")})`} />
        <path d={circlePath(73)} fill="none" stroke={dull ? "#71717a" : c.mid} strokeWidth={bold ? 4 : 2} />
        <path d={face} fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1.2" />
        {bold ? null : ringLettering(0.9)}
        {markPass("mark", 0, 0, tone.mark, 1)}
        {/* a faint highlight across the top, like light on a polished edge */}
        <path d="M40,74 Q60,32 112,26" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    );
  }

  const shadow =
    look === "ink" ? null : (
      <filter id={u("shadow")} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow
          dx="0"
          dy={look === "flat" ? 3 : 6}
          stdDeviation={look === "flat" ? 3 : 6}
          floodColor={look === "coin" ? "#000" : c.deep}
          floodOpacity={look === "flat" ? 0.18 : look === "coin" ? 0.35 : 0.32}
        />
      </filter>
    );

  return (
    <svg viewBox="0 0 200 200" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }} role="img" aria-label={`Seal, ${state}`}>
      <defs>
        <path id={u("ring")} d={`M100,${100 - ringR} a${ringR},${ringR} 0 1,1 -0.01,0`} fill="none" />
        <radialGradient id={u("wax")} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor={c.light} />
          <stop offset="0.45" stopColor={c.mid} />
          <stop offset="0.85" stopColor={c.dark} />
          <stop offset="1" stopColor={c.deep} />
        </radialGradient>
        <radialGradient id={u("face")} cx="42%" cy="38%" r="70%">
          <stop offset="0" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </radialGradient>
        <radialGradient id={u("coin")} cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor={dull ? "#3f3f46" : "#24232c"} />
          <stop offset="1" stopColor={coinBase} />
        </radialGradient>
        <radialGradient id={u("sheen")} cx="30%" cy="24%" r="45%">
          <stop offset="0" stopColor="#fff" stopOpacity={dull ? 0.18 : 0.32} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* wax grain: fine noise, used as a pattern fill so it stays inside the puddle */}
        <filter id={u("noise")} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 0" />
        </filter>
        <pattern id={u("grain")} width="200" height="200" patternUnits="userSpaceOnUse">
          <rect width="200" height="200" filter={`url(#${u("noise")})`} />
        </pattern>
        <filter id={u("rough")} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="3" result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" />
        </filter>
        <clipPath id={u("l")}>
          <path d={`${cr.main} L-20,200 L-20,0 Z`} />
        </clipPath>
        <clipPath id={u("r")}>
          <path d={`${cr.main} L220,200 L220,0 Z`} />
        </clipPath>
        <clipPath id={u("puddle")}>
          <path d={outer} />
        </clipPath>
        {shadow}
      </defs>

      <g filter={shadow ? `url(#${u("shadow")})` : undefined}>
        {state === "open" ? (
          <>
            <g transform="translate(-15,7) rotate(-10 100 100)">
              <g clipPath={`url(#${u("l")})`}>{body}</g>
              {look === "wax" ? (
                <g clipPath={`url(#${u("puddle")})`}>
                  <path d={cr.main} fill="none" stroke={c.light} strokeOpacity="0.9" strokeWidth="2" clipPath={`url(#${u("l")})`} />
                </g>
              ) : null}
            </g>
            <g transform="translate(15,7) rotate(10 100 100)">
              <g clipPath={`url(#${u("r")})`}>{body}</g>
              {look === "wax" ? (
                <g clipPath={`url(#${u("puddle")})`}>
                  <path d={cr.main} fill="none" stroke={c.deep} strokeOpacity="0.8" strokeWidth="2.4" clipPath={`url(#${u("r")})`} />
                </g>
              ) : null}
            </g>
            {look === "wax" || look === "coin"
              ? [
                  [97, 150, 3.2],
                  [104, 172, 2.2],
                  [94, 186, 1.6],
                ].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={look === "coin" ? coinBase : c.mid} stroke={c.deep} strokeOpacity="0.4" strokeWidth="0.6" />)
              : null}
          </>
        ) : (
          body
        )}
      </g>

      {state === "cracked" ? (
        <g fill="none" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${u("puddle")})`}>
          <path d={cr.main} stroke={tone.crack} strokeWidth={look === "wax" ? 4.2 : 3.4} strokeOpacity="0.9" />
          {look === "wax" ? <path d={cr.main} stroke="#fff" strokeWidth="1.2" strokeOpacity="0.55" transform="translate(-1.6,-0.6)" /> : null}
          {cr.branches.map((b, i) => (
            <path key={i} d={b} stroke={tone.crack} strokeWidth="1.6" strokeOpacity="0.75" />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
