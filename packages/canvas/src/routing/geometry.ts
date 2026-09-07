import type { Point, Rect } from "../types.js";
import { required } from "./invariant.js";
export const EPS = 1e-6;
export const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < EPS;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const b = out.at(-1),
      a = out.at(-2);
    if (b && same(b, p)) continue;
    if (
      a &&
      b &&
      Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < EPS &&
      (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0
    )
      out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}
export function contains(r: Rect, p: Point): boolean {
  return p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;
}
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
/** Open-interior segment/rectangle intersection; travelling along a boundary is legal. */
export function crosses(a: Point, b: Point, r: Rect): boolean {
  let lo = 0,
    hi = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, r.x + EPS, r.x + r.w - EPS],
    [a.y, b.y - a.y, r.y + EPS, r.y + r.h - EPS],
  ]) {
    if (Math.abs(required(delta)) < EPS) {
      if (required(start) <= required(min) || required(start) >= required(max)) return false;
    } else {
      const t1 = (required(min) - required(start)) / required(delta),
        t2 = (required(max) - required(start)) / required(delta);
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    }
  }
  return lo < hi;
}
export function clear(points: Point[], obstacles: Rect[]): boolean {
  return points.every(
    (p, i) => i === 0 || !obstacles.some((r) => crosses(required(points[i - 1]), p, r)),
  );
}
export function bounds(points: Point[], padding = 0): Rect {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs) - padding,
    y = Math.min(...ys) - padding;
  return { x, y, w: Math.max(...xs) - x + padding, h: Math.max(...ys) - y + padding };
}
export function pointAt(points: Point[], position: number): Point {
  const lengths = points.slice(1).map((p, i) => distance(required(points[i]), p));
  let remaining = lengths.reduce((a, b) => a + b, 0) * position;
  for (let i = 0; i < lengths.length; i++) {
    const length = required(lengths[i]);
    if (remaining <= length || i === lengths.length - 1) {
      const a = required(points[i]),
        b = required(points[i + 1]),
        t = length ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}
export function cubic(a: Point, b: Point, c: Point, d: Point): Point[] {
  // Adaptive subdivision bounds the sampling error for labels and collision checks.
  const out = [a];
  const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  function split(a: Point, b: Point, c: Point, d: Point, depth: number) {
    const excess = distance(a, b) + distance(b, c) + distance(c, d) - distance(a, d);
    if (excess < 0.05 || depth === 12) {
      out.push(d);
      return;
    }
    const ab = mid(a, b),
      bc = mid(b, c),
      cd = mid(c, d),
      abc = mid(ab, bc),
      bcd = mid(bc, cd),
      center = mid(abc, bcd);
    split(a, ab, abc, center, depth + 1);
    split(center, bcd, cd, d, depth + 1);
  }
  split(a, b, c, d, 0);
  return out;
}
export function rounded(
  points: Point[],
  radius = 10,
  pins: Point[] = [],
): {
  d: string;
  samples: Point[];
} {
  const p = simplify(points),
    samples: Point[] = [];
  if (!p.length) return { d: "", samples };
  const commands = [`M ${required(p[0]).x} ${required(p[0]).y}`];
  samples.push(required(p[0]));
  for (let i = 1; i < p.length - 1; i++) {
    const a = required(p[i - 1]),
      b = required(p[i]),
      c = required(p[i + 1]),
      ab = distance(a, b),
      bc = distance(b, c);
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const r =
      Math.abs(turn) < EPS || pins.some((p) => same(p, b)) ? 0 : Math.min(radius, ab / 2, bc / 2);
    const before = { x: b.x - ((b.x - a.x) / ab) * r, y: b.y - ((b.y - a.y) / ab) * r };
    const after = { x: b.x + ((c.x - b.x) / bc) * r, y: b.y + ((c.y - b.y) / bc) * r };
    commands.push(`L ${before.x} ${before.y}`);
    samples.push(before);
    if (r) {
      commands.push(`Q ${b.x} ${b.y} ${after.x} ${after.y}`);
      for (let j = 1; j <= 8; j++) {
        const t = j / 8,
          u = 1 - t;
        samples.push({
          x: u * u * before.x + 2 * u * t * b.x + t * t * after.x,
          y: u * u * before.y + 2 * u * t * b.y + t * t * after.y,
        });
      }
    }
  }
  const last = required(p.at(-1));
  commands.push(`L ${last.x} ${last.y}`);
  samples.push(last);
  return { d: commands.join(" "), samples: simplify(samples) };
}
/** Both annotation and graph arrows use this tip-aligned shape. */
export const ARROW_SHAPE = "M 0 1 L 10 5 L 0 9 z";
