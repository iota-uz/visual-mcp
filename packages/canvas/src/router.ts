import type { PositionedCanvas, PositionedNode } from "./layout.js";
import {
  bounds,
  clear,
  crosses,
  cubic,
  distance,
  intersects,
  pointAt,
  rounded,
  same,
  simplify,
} from "./routing/geometry.js";
import { required } from "./routing/invariant.js";
import { type EdgeLabel, placeLabel } from "./routing/labels.js";
import { orthogonal, type RoutingDiagnostic } from "./routing/orthogonal.js";
import type { AnchorSide, CanvasEdge, ConnectorAnchor, Point, Rect } from "./types.js";

export type { RoutingDiagnostic } from "./routing/orthogonal.js";
export interface EdgePath {
  edge: CanvasEdge;
  route: CanvasEdge["route"]["type"];
  d: string;
  points: Point[];
  labelPoint: Point;
  label?: EdgeLabel;
  bounds: Rect;
  diagnostics: RoutingDiagnostic[];
  junctionPoint?: Point;
  mergePoint?: Point;
}
export class RouterError extends Error {}
const normals: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const move = (p: Point, n: Point, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });
const rect = (n: PositionedNode, p = 0): Rect => ({
  x: n.x - p,
  y: n.y - p,
  w: n.w + 2 * p,
  h: n.h + 2 * p,
});
export function anchorPoint(node: PositionedNode, anchor: ConnectorAnchor): Point {
  const { side, offset } = anchor;
  return {
    x: node.x + (side === "right" ? node.w : side === "left" ? 0 : node.w * offset),
    y: node.y + (side === "bottom" ? node.h : side === "top" ? 0 : node.h * offset),
  };
}
interface Port {
  node: PositionedNode;
  anchor: ConnectorAnchor;
  point: Point;
  normal: Point;
  clearance: number;
}
function ports(canvas: PositionedCanvas, value: CanvasEdge["source"]): Port[] {
  const node = canvas.nodes.find((n) => n.id === value.nodeId);
  if (!node) throw new RouterError(`unknown node "${value.nodeId}"`);
  const named = value.anchorId ? node.anchors.find((a) => a.id === value.anchorId) : undefined;
  if (value.anchorId && !named)
    throw new RouterError(`unknown anchor "${value.anchorId}" on node "${value.nodeId}"`);
  const anchors = named
    ? [named]
    : (value.side ? [value.side] : (Object.keys(normals) as AnchorSide[])).map((side) => ({
        id: side,
        side,
        offset: value.offset ?? 0.5,
      }));
  return anchors.map((anchor) => {
    const point = anchorPoint(node, anchor),
      normal = normals[anchor.side];
    let clearance = 24;
    for (const other of canvas.nodes) {
      if (other.id === node.id) continue;
      let gap = Infinity;
      if (normal.x && point.y >= other.y && point.y <= other.y + other.h)
        gap = normal.x > 0 ? other.x - point.x : point.x - other.x - other.w;
      if (normal.y && point.x >= other.x && point.x <= other.x + other.w)
        gap = normal.y > 0 ? other.y - point.y : point.y - other.y - other.h;
      if (gap > 0) clearance = Math.min(clearance, gap / 3);
    }
    return { node, anchor, point, normal, clearance };
  });
}
const key = (p: Port) => `${p.node.id}:${p.anchor.side}:${p.anchor.offset}`;
const priority: Record<CanvasEdge["kind"], number> = {
  main: 0,
  secondary: 1,
  sync: 2,
  actor: 3,
  external: 4,
  exception: 5,
};
const order = (a: CanvasEdge, b: CanvasEdge) =>
  priority[a.kind] - priority[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function pairScore(a: Port, b: Port): number {
  const dx = b.point.x - a.point.x,
    dy = b.point.y - a.point.y;
  return (
    Math.abs(dx) +
    Math.abs(dy) +
    Math.max(0, -dx * a.normal.x - dy * a.normal.y) * 2 +
    Math.max(0, dx * b.normal.x + dy * b.normal.y) * 2
  );
}
function obstacleRects(canvas: PositionedCanvas, a: Port, b: Port): Rect[] {
  return canvas.nodes.map((n) =>
    rect(
      n,
      n.id === a.node.id || n.id === b.node.id
        ? Math.min(12, a.clearance / 2, b.clearance / 2)
        : 12,
    ),
  );
}
function loop(a: Port, depth = 76, halfWidth = 34): Point[] {
  const n = a.normal,
    t = { x: -n.y, y: n.x },
    s = move(a.point, n, a.clearance),
    far = move(a.point, n, depth);
  return [
    a.point,
    s,
    move(s, t, halfWidth),
    move(far, t, halfWidth),
    move(far, t, -halfWidth),
    move(s, t, -halfWidth),
    s,
    a.point,
  ];
}
function solve(
  canvas: PositionedCanvas,
  edge: CanvasEdge,
  a: Port,
  b: Port,
  cost: (a: Point, b: Point) => number,
  track = 0,
  fanOut = false,
  fanIn = false,
): {
  points: Point[];
  diagnostics: RoutingDiagnostic[];
} {
  const obstacles = obstacleRects(canvas, a, b),
    start = move(a.point, a.normal, a.clearance),
    end = move(b.point, b.normal, b.clearance);
  if (same(a.point, b.point) && a.node.id === b.node.id && !edge.route.waypoints?.length) {
    let points = loop(a, 76 + Math.abs(track));
    if (!clear(points.slice(1, -1), obstacles)) {
      for (const depth of [a.clearance + 16, 48, 96, 144])
        for (const width of [18, 34, 60, 100]) {
          const candidate = loop(a, depth + Math.abs(track), width);
          if (clear(candidate.slice(1, -1), obstacles)) {
            points = candidate;
            return { points, diagnostics: [] };
          }
        }
    }
    return { points, diagnostics: clear(points.slice(1, -1), obstacles) ? [] : ["no_clear_route"] };
  }
  const stops = [start, ...(edge.route.waypoints ?? []), end],
    points: Point[] = [a.point],
    diagnostics: RoutingDiagnostic[] = [];
  if (!track && !edge.route.waypoints?.length && (fanOut || fanIn)) {
    const turn = fanOut
      ? a.normal.x
        ? { x: start.x, y: end.y }
        : { x: end.x, y: start.y }
      : b.normal.x
        ? { x: end.x, y: start.y }
        : { x: start.x, y: end.y };
    const branch = simplify([start, turn, end]);
    if (clear(branch, obstacles))
      return { points: simplify([a.point, ...branch, b.point]), diagnostics };
  }
  if (track && !edge.route.waypoints?.length) {
    const horizontal = a.normal.x !== 0 && b.normal.x !== 0;
    const vertical = a.normal.y !== 0 && b.normal.y !== 0;
    const candidates = horizontal
      ? [
          start,
          { x: start.x, y: (start.y + end.y) / 2 + track },
          { x: end.x, y: (start.y + end.y) / 2 + track },
          end,
        ]
      : vertical
        ? [
            start,
            { x: (start.x + end.x) / 2 + track, y: start.y },
            { x: (start.x + end.x) / 2 + track, y: end.y },
            end,
          ]
        : [];
    if (candidates.length && clear(candidates, obstacles))
      return { points: simplify([a.point, ...candidates, b.point]), diagnostics };
  }
  for (let i = 1; i < stops.length; i++) {
    const result = orthogonal(required(stops[i - 1]), required(stops[i]), obstacles, {
      sourceNormal: i === 1 ? a.normal : undefined,
      targetNormal: i === stops.length - 1 ? b.normal : undefined,
      cost,
    });
    if (result.diagnostic)
      diagnostics.push(edge.route.waypoints?.length ? "constraint_conflict" : result.diagnostic);
    points.push(...result.points);
  }
  points.push(b.point);
  // Endpoint stubs may pass through an overlapping third card. Never claim a
  // successful route merely because the middle section was clear.
  if (
    canvas.nodes.some((n) => n.id !== a.node.id && crosses(a.point, start, rect(n))) ||
    canvas.nodes.some((n) => n.id !== b.node.id && crosses(end, b.point, rect(n)))
  )
    diagnostics.push("endpoint_blocked");
  return { points: simplify(points), diagnostics: [...new Set(diagnostics)] };
}
/** Pure routing, stable priority order; document order only controls returned array order. */
const cache = new WeakMap<
  PositionedCanvas["doc"],
  {
    signature: string;
    paths: EdgePath[];
    incremental: boolean;
    edgeSignature: string;
    nodeStates: Map<
      string,
      {
        signature: string;
        rect: Rect;
      }
    >;
    resolved: Map<
      string,
      {
        a: Port;
        b: Port;
      }
    >;
  }
>();
export function routeEdges(canvas: PositionedCanvas, incremental = false): EdgePath[] {
  const signature = JSON.stringify([
    canvas.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h, n.anchors]),
    canvas.doc.edges,
  ]);
  const previous = cache.get(canvas.doc);
  if (previous?.signature === signature && (incremental || !previous.incremental))
    return previous.paths;
  const edgeSignature = JSON.stringify(canvas.doc.edges),
    nodeStates = new Map(
      canvas.nodes.map((n) => [
        n.id,
        { signature: JSON.stringify([n.x, n.y, n.w, n.h, n.anchors]), rect: rect(n, 12) },
      ]),
    );
  const frozen = new Map<string, EdgePath>();
  if (incremental && previous?.edgeSignature === edgeSignature) {
    const changed = new Set(
      [...nodeStates.keys(), ...previous.nodeStates.keys()].filter(
        (id) => nodeStates.get(id)?.signature !== previous.nodeStates.get(id)?.signature,
      ),
    );
    const obstacles = [...changed].flatMap((id) =>
      [nodeStates.get(id)?.rect, previous.nodeStates.get(id)?.rect].filter((r): r is Rect => !!r),
    );
    for (const path of previous.paths)
      if (
        !changed.has(path.edge.source.nodeId) &&
        !changed.has(path.edge.target.nodeId) &&
        !path.diagnostics.length &&
        !obstacles.some((r) => intersects(path.bounds, r))
      )
        frozen.set(path.edge.id, path);
  }
  const sorted = [...canvas.doc.edges].sort(order),
    occupied: {
      a: Point;
      b: Point;
    }[] = [],
    labelBoxes: Rect[] = [...frozen.values()].flatMap((p) => (p.label ? [p.label.bounds] : [])),
    result = new Map<string, EdgePath>();
  const resolved = new Map<
    string,
    {
      a: Port;
      b: Port;
    }
  >();
  const portCache = new Map<string, Port[]>();
  const getPorts = (v: CanvasEdge["source"]) => {
    const k = JSON.stringify(v);
    let p = portCache.get(k);
    if (!p) {
      p = ports(canvas, v);
      portCache.set(k, p);
    }
    return p;
  };
  const cost = (a: Point, b: Point) => {
    let score = 0;
    for (const s of occupied) {
      if (a.y === b.y && s.a.y === s.b.y && a.y === s.a.y)
        score +=
          Math.max(
            0,
            Math.min(Math.max(a.x, b.x), Math.max(s.a.x, s.b.x)) -
              Math.max(Math.min(a.x, b.x), Math.min(s.a.x, s.b.x)),
          ) * 2;
      else if (a.x === b.x && s.a.x === s.b.x && a.x === s.a.x)
        score +=
          Math.max(
            0,
            Math.min(Math.max(a.y, b.y), Math.max(s.a.y, s.b.y)) -
              Math.max(Math.min(a.y, b.y), Math.min(s.a.y, s.b.y)),
          ) * 2;
      else {
        const h = a.y === b.y ? { a, b } : s,
          v = a.y === b.y ? s : { a, b };
        if (
          h.a.y === h.b.y &&
          v.a.x === v.b.x &&
          v.a.x > Math.min(h.a.x, h.b.x) &&
          v.a.x < Math.max(h.a.x, h.b.x) &&
          h.a.y > Math.min(v.a.y, v.b.y) &&
          h.a.y < Math.max(v.a.y, v.b.y)
        )
          score += 140;
      }
    }
    return score;
  };
  for (const edge of sorted) {
    const prior = frozen.has(edge.id) ? previous?.resolved.get(edge.id) : undefined;
    if (prior) {
      resolved.set(edge.id, prior);
      continue;
    }
    const pairs = getPorts(edge.source)
      .flatMap((a) => getPorts(edge.target).map((b) => ({ a, b, score: pairScore(a, b) })))
      .sort((a, b) => a.score - b.score);
    let choice = required(pairs[0]);
    if (edge.route.type === "orthogonal")
      for (const pair of pairs) {
        choice = pair;
        if (!solve(canvas, edge, pair.a, pair.b, () => 0).diagnostics.length) break;
      }
    resolved.set(edge.id, choice);
  }
  const clusters = new Map<string, CanvasEdge[]>();
  const sources = new Map<string, CanvasEdge[]>(),
    targets = new Map<string, CanvasEdge[]>();
  for (const edge of sorted) {
    const p = required(resolved.get(edge.id));
    const k = [key(p.a), key(p.b)].sort().join("|");
    const list = clusters.get(k) ?? [];
    list.push(edge);
    clusters.set(k, list);
  }
  for (const edge of sorted) {
    const p = required(resolved.get(edge.id));
    for (const [map, port] of [
      [sources, p.a],
      [targets, p.b],
    ] as const) {
      const k = key(port),
        list = map.get(k) ?? [];
      list.push(edge);
      map.set(k, list);
    }
  }
  for (const edge of sorted) {
    const { a, b } = required(resolved.get(edge.id)),
      pair = required(clusters.get([key(a), key(b)].sort().join("|"))),
      track = (pair.indexOf(edge) - (pair.length - 1) / 2) * 18;
    const prior = frozen.get(edge.id);
    if (prior) {
      result.set(edge.id, prior);
      for (let i = 1; i < prior.points.length; i++)
        occupied.push({ a: required(prior.points[i - 1]), b: required(prior.points[i]) });
      continue;
    }
    const sourceCluster = required(sources.get(key(a))),
      targetCluster = required(targets.get(key(b)));
    let points: Point[],
      samples: Point[],
      d: string,
      diagnostics: RoutingDiagnostic[] = [];
    if (edge.route.type === "orthogonal") {
      ({ points, diagnostics } = solve(
        canvas,
        edge,
        a,
        b,
        cost,
        track,
        sourceCluster.length > 1,
        targetCluster.length > 1,
      ));
      let radius = edge.route.radius ?? 10;
      let geometry = rounded(points, radius, edge.route.waypoints);
      const obstacles = canvas.nodes.map((n) => rect(n));
      while (radius > 0 && !clear(geometry.samples, obstacles)) {
        radius = radius < 1 ? 0 : radius / 2;
        geometry = rounded(points, radius, edge.route.waypoints);
      }
      d = geometry.d;
      samples = geometry.samples;
      // Rounding cannot cut into an obstacle even if the polyline clears it.
      if (!clear(samples, obstacles) && !diagnostics.length) diagnostics.push("no_clear_route");
    } else if (
      edge.route.type === "bezier" &&
      !edge.route.waypoints?.length &&
      !same(a.point, b.point)
    ) {
      const extent = Math.max(1, distance(a.point, b.point) / 2),
        c1 = move(a.point, a.normal, extent),
        c2 = move(b.point, b.normal, extent);
      if (a.normal.x) c1.y += track;
      else c1.x += track;
      if (b.normal.x) c2.y += track;
      else c2.x += track;
      samples = cubic(a.point, c1, c2, b.point);
      points = samples;
      d = `M ${a.point.x} ${a.point.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.point.x} ${b.point.y}`;
    } else {
      points =
        same(a.point, b.point) && edge.route.type === "bezier"
          ? loop(a)
          : simplify([a.point, ...(edge.route.waypoints ?? []), b.point]);
      const geometry = rounded(points, 0);
      d = geometry.d;
      samples = geometry.samples;
    }
    if (
      edge.route.type !== "orthogonal" &&
      canvas.nodes.some((n) =>
        samples.some((p, i) => i > 0 && crosses(required(samples[i - 1]), p, rect(n))),
      )
    )
      diagnostics.push("no_clear_route");
    for (let i = 1; i < points.length; i++)
      occupied.push({ a: required(points[i - 1]), b: required(points[i]) });
    const label = placeLabel(
      edge,
      samples,
      canvas.nodes.map((n) => rect(n, 4)),
      labelBoxes,
    );
    if (label) {
      labelBoxes.push(label.bounds);
      if (label.crowded) diagnostics.push("label_no_space");
    }
    const extent = bounds(
      [
        ...samples,
        ...(label
          ? [
              { x: label.bounds.x, y: label.bounds.y },
              { x: label.bounds.x + label.bounds.w, y: label.bounds.y + label.bounds.h },
            ]
          : []),
      ],
      8,
    );
    const junction = (cluster: CanvasEdge[], port: Port) =>
      cluster.length > 1 && required(cluster[0]).id === edge.id
        ? cluster.every((e) => e.route.type === "orthogonal" && !e.route.waypoints?.length)
          ? move(port.point, port.normal, port.clearance)
          : port.point
        : undefined;
    result.set(edge.id, {
      edge,
      route: edge.route.type,
      d,
      points,
      labelPoint: label?.point ?? pointAt(samples, 0.5),
      label,
      bounds: extent,
      diagnostics: [...new Set(diagnostics)],
      junctionPoint: junction(sourceCluster, a),
      mergePoint: junction(targetCluster, b),
    });
  }
  const paths = canvas.doc.edges.map((edge) => required(result.get(edge.id)));
  cache.set(canvas.doc, { signature, paths, incremental, edgeSignature, nodeStates, resolved });
  return paths;
}
