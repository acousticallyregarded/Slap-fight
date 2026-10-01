import { Container, FillGradient, Graphics, type FillInput } from 'pixi.js';

/** A path segment: quadratic curve (c = control point) or straight line. */
export type Seg = { to: [number, number]; c?: [number, number] };

/** Draws a closed path. */
export function path(g: Graphics, start: [number, number], segs: Seg[]) {
  g.moveTo(start[0], start[1]);
  for (const s of segs) {
    if (s.c) g.quadraticCurveTo(s.c[0], s.c[1], s.to[0], s.to[1]);
    else g.lineTo(s.to[0], s.to[1]);
  }
  g.closePath();
  return g;
}

/**
 * Builds a left-right symmetric closed path from the right half, which must
 * start and end on the centre line (x = 0) or at the given points.
 */
export function mirrorPath(g: Graphics, start: [number, number], right: Seg[]) {
  const pts: { from: [number, number]; seg: Seg }[] = [];
  let prev = start;
  for (const s of right) {
    pts.push({ from: prev, seg: s });
    prev = s.to;
  }
  // Left side: reverse the right side mirrored in x.
  const left: Seg[] = [];
  const end = right[right.length - 1].to;
  if (end[0] !== 0) left.push({ to: [-end[0], end[1]] });
  for (let i = pts.length - 1; i >= 0; i--) {
    const { from, seg } = pts[i];
    left.push({ to: [-from[0], from[1]], c: seg.c ? [-seg.c[0], seg.c[1]] : undefined });
  }
  return path(g, start, [...right, ...left]);
}

/** Mirrors a set of right-side segments (for drawing a second copy on the left). */
export function mirrorSegs(start: [number, number], segs: Seg[]): { start: [number, number]; segs: Seg[] } {
  return {
    start: [-start[0], start[1]],
    segs: segs.map((s) => ({ to: [-s.to[0], s.to[1]] as [number, number], c: s.c ? ([-s.c[0], s.c[1]] as [number, number]) : undefined })),
  };
}

/** Vertical (default) or horizontal gradient in the shape's local bounds. */
export function grad(stops: [number, string][], dir: 'v' | 'h' | 'd' = 'v') {
  const end = dir === 'v' ? { x: 0, y: 1 } : dir === 'h' ? { x: 1, y: 0 } : { x: 1, y: 1 };
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end,
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
    textureSpace: 'local',
  });
}

export function radial(stops: [number, string][]) {
  return new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
    textureSpace: 'local',
  });
}

/** A tapered limb from (0,0) to (0,len), widths w0 -> w1, rounded ends. */
export function limb(g: Graphics, len: number, w0: number, w1: number, bulge = 0) {
  const h0 = w0 / 2;
  const h1 = w1 / 2;
  g.moveTo(-h0, 0);
  g.quadraticCurveTo(-h0 - bulge, len * 0.45, -h1, len);
  g.quadraticCurveTo(0, len + h1 * 1.1, h1, len);
  g.quadraticCurveTo(h0 + bulge, len * 0.45, h0, 0);
  g.quadraticCurveTo(0, -h0 * 1.1, -h0, 0);
  g.closePath();
  return g;
}

/** 4-point sparkle star. */
export function sparkle(g: Graphics, r: number, color: number | string, alpha = 1) {
  const k = r * 0.22;
  g.moveTo(0, -r);
  g.quadraticCurveTo(k, -k, r, 0);
  g.quadraticCurveTo(k, k, 0, r);
  g.quadraticCurveTo(-k, k, -r, 0);
  g.quadraticCurveTo(-k, -k, 0, -r);
  g.closePath();
  g.fill({ color, alpha });
  return g;
}

/** Comic impact burst. */
export function burst(g: Graphics, points: number, rOuter: number, rInner: number, color: number | string, stroke?: number | string) {
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? rOuter * (0.85 + ((i * 37) % 7) / 25) : rInner;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.poly(pts, true).fill({ color });
  if (stroke !== undefined) g.poly(pts, true).stroke({ width: 5, color: stroke, join: 'round' });
  return g;
}

export const hex = (c: string) => parseInt(c.replace('#', ''), 16);

/** Tapered hair strand from root to a pointed tip, bowed sideways by `bend`. */
export function strand(g: Graphics, root: [number, number], tip: [number, number], width: number, bend = 0) {
  const dx = tip[0] - root[0];
  const dy = tip[1] - root[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = root[0] + dx * 0.5 + nx * bend;
  const my = root[1] + dy * 0.5 + ny * bend;
  const h = width / 2;
  g.moveTo(root[0] - nx * h, root[1] - ny * h);
  g.quadraticCurveTo(mx - nx * h * 0.8, my - ny * h * 0.8, tip[0], tip[1]);
  g.quadraticCurveTo(mx + nx * h * 0.8, my + ny * h * 0.8, root[0] + nx * h, root[1] + ny * h);
  g.closePath();
  return g;
}

/**
 * A cel-shaded part: `shape` draws the silhouette. It is filled with `base`,
 * `shade` draws shadow/highlight bands clipped to the silhouette, and the
 * silhouette gets an ink outline. Returns one container so the part can be
 * moved, hidden or dropped as a unit.
 */
export function celPart(opts: {
  shape: (g: Graphics) => void;
  base: FillInput;
  shade?: (g: Graphics) => void;
  line?: string;
  lineWidth?: number;
  /** Optional open path to ink instead of the whole silhouette. */
  lineShape?: (g: Graphics) => void;
}) {
  const c = new Container();
  const base = new Graphics();
  opts.shape(base);
  base.fill(opts.base);
  c.addChild(base);
  if (opts.shade) {
    const detail = new Graphics();
    opts.shade(detail);
    const mask = new Graphics();
    opts.shape(mask);
    mask.fill({ color: 0xffffff });
    c.addChild(detail, mask);
    detail.mask = mask;
  }
  if (opts.line) {
    const ink = new Graphics();
    (opts.lineShape ?? opts.shape)(ink);
    ink.stroke({ width: opts.lineWidth ?? 2.2, color: opts.line, join: 'round', alpha: 0.9 });
    c.addChild(ink);
  }
  return c;
}
