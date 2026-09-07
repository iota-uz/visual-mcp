import type { Point, Rect } from "../types.js";
import { clear, contains, crosses, distance, EPS, same, simplify } from "./geometry.js";
import { required } from "./invariant.js";
export type RoutingDiagnostic =
  | "no_clear_route"
  | "routing_budget_exceeded"
  | "constraint_conflict"
  | "label_no_space"
  | "endpoint_blocked";
export interface RouteResult {
  points: Point[];
  diagnostic?: RoutingDiagnostic;
}
const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const unique = (n: number[]) => [...new Set(n)].sort((a, b) => a - b);
export interface SearchOptions {
  sourceNormal?: Point;
  targetNormal?: Point;
  cost?: (a: Point, b: Point) => number;
}
function directions(p: Point[], o: SearchOptions): boolean {
  if (p.length < 2) return true;
  const a = required(p[0]),
    b = required(p[1]),
    c = required(p.at(-2)),
    d = required(p.at(-1));
  return (
    (!o.sourceNormal || (b.x - a.x) * o.sourceNormal.x + (b.y - a.y) * o.sourceNormal.y >= -EPS) &&
    (!o.targetNormal || (c.x - d.x) * o.targetNormal.x + (c.y - d.y) * o.targetNormal.y >= -EPS)
  );
}
class Heap {
  data: {
    id: number;
    g: number;
    f: number;
  }[] = [];
  push(item: { id: number; g: number; f: number }) {
    const a = this.data;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (required(a[p]).f <= item.f) break;
      a[i] = required(a[p]);
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.data,
      first = required(a[0]),
      last = required(a.pop());
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && required(a[c + 1]).f < required(a[c]).f) c++;
        if (required(a[c]).f >= last.f) break;
        a[i] = required(a[c]);
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
}
/** Fast clear candidates first, then bounded direction-aware A* on obstacle corridors. */
export function orthogonal(
  source: Point,
  target: Point,
  obstacles: Rect[],
  options: SearchOptions = {},
): RouteResult {
  if (obstacles.some((r) => contains(r, source) || contains(r, target)))
    return { points: [source, target], diagnostic: "endpoint_blocked" };
  if (same(source, target)) return { points: [source] };
  if (
    (source.x === target.x || source.y === target.y) &&
    directions([source, target], options) &&
    clear([source, target], obstacles) &&
    !options.cost?.(source, target)
  )
    return { points: [source, target] };
  const xs = unique([
    source.x,
    target.x,
    (source.x + target.x) / 2,
    ...obstacles.flatMap((r) => [r.x, r.x + r.w]),
  ]);
  const ys = unique([
    source.y,
    target.y,
    (source.y + target.y) / 2,
    ...obstacles.flatMap((r) => [r.y, r.y + r.h]),
  ]);
  const candidates = [
    [source, { x: target.x, y: source.y }, target],
    [source, { x: source.x, y: target.y }, target],
    ...xs.map((x) => [source, { x, y: source.y }, { x, y: target.y }, target]),
    ...ys.map((y) => [source, { x: source.x, y }, { x: target.x, y }, target]),
  ].map(simplify);
  let best: Point[] | undefined,
    score = Infinity;
  for (const p of candidates) {
    if (!directions(p, options) || !clear(p, obstacles)) continue;
    const cost = p
      .slice(1)
      .reduce(
        (sum, q, i) =>
          sum + manhattan(required(p[i]), q) + (options.cost?.(required(p[i]), q) ?? 0),
        Math.max(0, p.length - 2) * 18,
      );
    if (cost < score) {
      best = p;
      score = cost;
    }
  }
  if (best) return { points: best };
  const size = xs.length * ys.length;
  if (size > 40000) return { points: [source, target], diagnostic: "routing_budget_exceeded" };
  const point = (id: number) => ({
    x: required(xs[id % xs.length]),
    y: required(ys[Math.floor(id / xs.length)]),
  });
  const index = (p: Point) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  const start = index(source),
    goal = index(target),
    queue = new Heap(),
    scores = new Map<number, number>(),
    parents = new Map<number, number>();
  // State includes incoming orientation, so bend costs do not break optimality.
  const startState = start * 3;
  scores.set(startState, 0);
  queue.push({ id: startState, g: 0, f: manhattan(source, target) });
  let visits = 0;
  while (queue.data.length) {
    const current = queue.pop();
    if (current.g !== scores.get(current.id)) continue;
    const id = Math.floor(current.id / 3),
      orientation = current.id % 3,
      a = point(id);
    if (id === goal) {
      const p: Point[] = [];
      let cursor: number | undefined = current.id;
      while (cursor !== undefined) {
        p.push(point(Math.floor(cursor / 3)));
        cursor = parents.get(cursor);
      }
      return { points: simplify(p.reverse()) };
    }
    if (++visits > 80000)
      return { points: [source, target], diagnostic: "routing_budget_exceeded" };
    const x = id % xs.length,
      y = Math.floor(id / xs.length);
    for (const next of [
      x > 0 ? id - 1 : -1,
      x + 1 < xs.length ? id + 1 : -1,
      y > 0 ? id - xs.length : -1,
      y + 1 < ys.length ? id + xs.length : -1,
    ]) {
      if (next < 0) continue;
      const b = point(next),
        axis = a.y === b.y ? 1 : 2;
      if (obstacles.some((r) => crosses(a, b, r))) continue;
      if (id === start && !directions([a, b], { sourceNormal: options.sourceNormal })) continue;
      if (next === goal && !directions([a, b], { targetNormal: options.targetNormal })) continue;
      const state = next * 3 + axis,
        g =
          current.g +
          distance(a, b) +
          (orientation && orientation !== axis ? 18 : 0) +
          (options.cost?.(a, b) ?? 0);
      if (g >= (scores.get(state) ?? Infinity)) continue;
      scores.set(state, g);
      parents.set(state, current.id);
      queue.push({ id: state, g, f: g + manhattan(b, target) });
    }
  }
  return { points: [source, target], diagnostic: "no_clear_route" };
}
