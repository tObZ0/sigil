/*
 * What's pressed into the middle of a wax seal. Not a letter: a mark.
 *
 * Every launch gets a sigil generated from its token address: its symmetry,
 * petal shape, inner figure and dots all come from the address, so no two
 * launches share a seal and nobody can fake one by picking a letter. Sigil's
 * own seal uses a fixed mark.
 *
 * Coordinates are rounded to one decimal so server and browser render the
 * same markup (their Math.cos can differ in the last digits).
 */

export type MarkName = "keyhole" | "eye" | "rings";
export type Emblem = { kind: "sigil"; seed: string } | { kind: "mark"; name: MarkName };

/** Stroked lines and filled shapes, drawn three times over for the emboss. */
export type EmblemPaths = { strokes: string[]; fills: string[]; width: number };

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

const f = (n: number) => n.toFixed(1);
const at = (r: number, a: number): [number, number] => [100 + Math.cos(a) * r, 100 + Math.sin(a) * r];

function circle(cx: number, cy: number, r: number) {
  return `M${f(cx - r)},${f(cy)} a${f(r)},${f(r)} 0 1,0 ${f(r * 2)},0 a${f(r)},${f(r)} 0 1,0 ${f(-r * 2)},0Z`;
}

/** A sigil from a seed. `r` is the radius it fills; `simple` drops fine detail for small sizes. */
export function sigil(seed: string, r: number, simple: boolean): EmblemPaths {
  const rand = rng(`${seed}:sigil`);
  const k = 5 + Math.floor(rand() * 4); // 5 to 8-fold
  const petal = Math.floor(rand() * 3); // lens, spoke, or arc
  const star = rand() < 0.5;
  const phase = rand() * Math.PI * 2;
  const inner = r * (0.26 + rand() * 0.08);
  const reach = r * (0.88 + rand() * 0.1);
  const strokes: string[] = [];
  const fills: string[] = [];
  const step = (Math.PI * 2) / k;

  for (let i = 0; i < k; i++) {
    const a = phase + i * step;
    if (petal === 0) {
      // A lens from the inner figure out to the edge.
      const w = step * (0.22 + rand() * 0.02);
      const [x1, y1] = at(inner * 1.05, a);
      const [x2, y2] = at(reach, a);
      const [c1x, c1y] = at((inner + reach) * 0.55, a - w);
      const [c2x, c2y] = at((inner + reach) * 0.55, a + w);
      strokes.push(`M${f(x1)},${f(y1)} Q${f(c1x)},${f(c1y)} ${f(x2)},${f(y2)} Q${f(c2x)},${f(c2y)} ${f(x1)},${f(y1)}`);
    } else if (petal === 1) {
      // A spoke ending in a dot.
      const [x1, y1] = at(inner * 1.1, a);
      const [x2, y2] = at(reach * 0.8, a);
      const [dx, dy] = at(reach * 0.92, a);
      strokes.push(`M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}`);
      fills.push(circle(dx, dy, simple ? 4.5 : 3.2));
    } else {
      // Arcs bowing outward between neighbours, like a flower's outline.
      const [x1, y1] = at(reach * 0.62, a);
      const [x2, y2] = at(reach * 0.62, a + step);
      const [cx, cy] = at(reach * 1.08, a + step / 2);
      strokes.push(`M${f(x1)},${f(y1)} Q${f(cx)},${f(cy)} ${f(x2)},${f(y2)}`);
      const [lx, ly] = at(inner * 1.1, a);
      strokes.push(`M${f(lx)},${f(ly)} L${f(x1)},${f(y1)}`);
    }
    if (!simple && petal !== 1) {
      const [dx, dy] = at(reach * (petal === 0 ? 0.74 : 0.86), a + step / 2);
      fills.push(circle(dx, dy, 1.9));
    }
  }

  // The inner figure: a k-gon, or a k-pointed star.
  const pts: string[] = [];
  const n = star ? k * 2 : k;
  for (let i = 0; i < n; i++) {
    const rr = star && i % 2 ? inner * 0.48 : inner;
    const [x, y] = at(rr, phase + (i * Math.PI * 2) / n);
    pts.push(`${i ? "L" : "M"}${f(x)},${f(y)}`);
  }
  strokes.push(pts.join(" ") + "Z");
  fills.push(circle(100, 100, simple ? 4 : 2.8));
  return { strokes, fills, width: simple ? 5 : 2.6 };
}

/** Sigil's fixed marks, sized to fit a radius of about `r`. */
export function mark(name: MarkName, r: number, simple: boolean): EmblemPaths {
  const s = r / 34;
  const w = simple ? 5 : 3;
  switch (name) {
    case "keyhole": {
      // Privacy, literally: what's behind it is locked.
      const top = 100 - 14 * s;
      return {
        strokes: [],
        fills: [
          `${circle(100, top, 13 * s)} M${f(100 - 6.5 * s)},${f(top + 6 * s)} L${f(100 - 12 * s)},${f(100 + 26 * s)} L${f(100 + 12 * s)},${f(100 + 26 * s)} L${f(100 + 6.5 * s)},${f(top + 6 * s)}Z`,
        ],
        width: w,
      };
    }
    case "eye": {
      // A closed eye: nobody sees the bids.
      const y = 100 - 4 * s;
      const strokes = [`M${f(100 - 30 * s)},${f(y)} Q100,${f(y + 26 * s)} ${f(100 + 30 * s)},${f(y)}`];
      for (const t of [-0.62, -0.31, 0, 0.31, 0.62]) {
        const x = 100 + t * 28 * s;
        const yy = y + (1 - t * t) * 12.5 * s;
        strokes.push(`M${f(x)},${f(yy)} L${f(x + t * 7 * s)},${f(yy + 9 * s)}`);
      }
      return { strokes, fills: [], width: w };
    }
    case "rings":
      // Two links passed hand to hand: the relay.
      return { strokes: [circle(100 - 10 * s, 100, 18 * s), circle(100 + 10 * s, 100, 18 * s)], fills: [], width: w };
  }
}

export function emblemPaths(e: Emblem, r: number, simple: boolean): EmblemPaths {
  return e.kind === "sigil" ? sigil(e.seed, r, simple) : mark(e.name, r, simple);
}
