import type { CanvasEdge, Point, Rect } from "../types.js";
import { bounds, distance, intersects, pointAt } from "./geometry.js";
import { required } from "./invariant.js";
import { orthogonal } from "./orthogonal.js";
export interface EdgeLabel {
  point: Point;
  bounds: Rect;
  lines: string[];
  leader?: Point[];
  crowded: boolean;
}
/** Fixed world-space typography keeps label layout stable during camera changes. */
export function placeLabel(
  edge: CanvasEdge,
  samples: Point[],
  nodes: Rect[],
  occupied: Rect[],
): EdgeLabel | undefined {
  if (!edge.label) return;
  const lines = edge.label.text.split("\n").flatMap((line) => {
    const chars = Array.from(line),
      out: string[] = [];
    while (chars.length) out.push(chars.splice(0, 30).join(""));
    return out.length ? out : [""];
  });
  const w =
    Math.max(
      ...lines.map((s) =>
        Array.from(s).reduce(
          (sum, c) => sum + (/[\u2e80-\u9fff\u{1f000}-\u{1ffff}]/u.test(c) ? 12 : 7),
          0,
        ),
      ),
    ) + 16;
  const h = lines.length * 16 + 10,
    base = pointAt(samples, edge.label.position ?? 0.5);
  const box = (p: Point): Rect => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
  const free = (p: Point) => !nodes.concat(occupied).some((r) => intersects(box(p), r));
  if (edge.label.offset) {
    const point = { x: base.x + edge.label.offset.x, y: base.y + edge.label.offset.y };
    return { point, bounds: box(point), lines, crowded: !free(point) };
  }
  const candidates: Point[] = [];
  const bases = [
    base,
    ...samples
      .slice(1)
      .map((p, i) => ({
        p: pointAt([required(samples[i]), p], 0.5),
        length: distance(required(samples[i]), p),
      }))
      .sort((a, b) => b.length - a.length)
      .slice(0, 6)
      .map((s) => s.p),
  ];
  for (const p of bases)
    candidates.push(
      { x: p.x, y: p.y - h / 2 - 8 },
      { x: p.x, y: p.y + h / 2 + 8 },
      { x: p.x - w / 2 - 8, y: p.y },
      { x: p.x + w / 2 + 8, y: p.y },
    );
  // Short links have no room for text. A callout uses the free corridor rather
  // than erasing the arrow or hiding its meaning in a mouse-only tooltip.
  const extent = bounds([
    ...samples,
    ...nodes.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
    ]),
  ]);
  for (const r of nodes.filter(
    (r) => Math.abs(r.x - base.x) < r.w + w || Math.abs(r.x + r.w - base.x) < w,
  )) {
    candidates.push({ x: base.x, y: r.y - h / 2 - 12 }, { x: base.x, y: r.y + r.h + h / 2 + 12 });
  }
  candidates.push(
    { x: base.x, y: extent.y - h / 2 - 12 },
    { x: base.x, y: extent.y + extent.h + h / 2 + 12 },
  );
  const point =
    candidates.filter(free).sort((a, b) => distance(a, base) - distance(b, base))[0] ??
    candidates[0] ??
    base;
  let leader =
    distance(point, base) > Math.max(w, h) / 2 + 20
      ? [base, { x: point.x, y: point.y + (point.y < base.y ? h / 2 : -h / 2) }]
      : undefined;
  let blocked = false;
  if (leader) {
    const route = orthogonal(required(leader[0]), required(leader[1]), nodes);
    leader = route.points;
    blocked = !!route.diagnostic;
  }
  return { point, bounds: box(point), lines, leader, crowded: !free(point) || blocked };
}
