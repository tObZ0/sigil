import { emblemPaths, type Emblem } from "./emblem";
import { WaxSeal } from "./wax-seal";

/**
 * The Sigil mark: its own sigil, from the same generator every launch's seal
 * uses. Sigil's is the original. One seed for the seal and one for the sigil,
 * so it's the same everywhere.
 */
export const LOGO_SEED = "relay-hero-seal";
export const LOGO_EMBLEM: Emblem = { kind: "sigil", seed: "relay" };

/** The full seal, for large sizes (hero, story). */
export function LogoSeal({ size = 34 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size, display: "inline-block", flexShrink: 0 }} aria-hidden>
      <WaxSeal seed={LOGO_SEED} letter="SIGIL" emblem={LOGO_EMBLEM} bold />
    </span>
  );
}

export type MarkVariant = "medallion" | "sigil" | "app";

/**
 * The mark drawn for small sizes (header, footer, favicon): thick strokes and
 * no fine detail, so it still reads at 16–32px.
 */
export function LogoMark({ variant, size = 32 }: { variant: MarkVariant; size?: number }) {
  const e = emblemPaths(LOGO_EMBLEM, variant === "sigil" ? 46 : variant === "app" ? 54 : 50, true);
  const color = variant === "sigil" ? "#7c3aed" : "#c4b5fd";
  const width = variant === "sigil" ? 9 : 10;
  const mark = (
    <g>
      {e.strokes.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {e.fills.map((d, i) => (
        <path key={`f${i}`} d={d} fill={color} />
      ))}
    </g>
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={variant === "sigil" ? "46 46 108 108" : "0 0 200 200"}
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      {variant === "medallion" ? (
        <>
          <circle cx="100" cy="100" r="96" fill="#0b0b0f" />
          <circle cx="100" cy="100" r="84" fill="none" stroke="#7c3aed" strokeWidth="9" />
        </>
      ) : null}
      {variant === "app" ? <rect x="4" y="4" width="192" height="192" rx="48" fill="#0b0b0f" /> : null}
      {mark}
    </svg>
  );
}
