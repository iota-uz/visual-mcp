import type { PositionedCanvas, PositionedNode } from "./layout.js";
import type { AnchorSide, CanvasEdge, ConnectorAnchor, Point } from "./types.js";

export interface EdgePath {
  edge: CanvasEdge;
  route: CanvasEdge["route"]["type"];
  d: string;
  points: Point[];
  labelPoint: Point;
  junctionPoint?: Point;
  mergePoint?: Point;
}
export class RouterError extends Error {}

const ORTHOGONAL_CLEARANCE = 24;
const ORTHOGONAL_OBSTACLE_PADDING = 12;
const ORTHOGONAL_BEND_RADIUS = 10;
const PARALLEL_TRACK_GAP = 18;
const MAX_OCCUPIED_SEGMENTS = 800;
const ROUTE_EPSILON = 0.001;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ResolvedEndpoint {
  point: Point;
  node: PositionedNode;
  anchor: ConnectorAnchor;
}

interface Segment {
  from: Point;
  to: Point;
}

export function anchorPoint(node: PositionedNode, anchor: ConnectorAnchor): Point {
  switch (anchor.side as AnchorSide) {
    case "top":
      return { x: node.x + node.w * anchor.offset, y: node.y };
    case "right":
      return { x: node.x + node.w, y: node.y + node.h * anchor.offset };
    case "bottom":
      return { x: node.x + node.w * anchor.offset, y: node.y + node.h };
    case "left":
      return { x: node.x, y: node.y + node.h * anchor.offset };
  }
}

function pointAtPolyline(points: Point[], position: number): Point {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const lengths: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from && to) lengths.push(Math.hypot(to.x - from.x, to.y - from.y));
  }
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * position;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    if (remaining <= length || index === lengths.length - 1) {
      const ratio = length === 0 ? 0 : remaining / length;
      const from = points[index] ?? { x: 0, y: 0 };
      const to = points[index + 1] ?? from;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    remaining -= length;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

function endpoint(canvas: PositionedCanvas, value: CanvasEdge["source"]): ResolvedEndpoint {
  const node = canvas.nodes.find((candidate) => candidate.id === value.nodeId);
  if (!node) throw new RouterError(`unknown node "${value.nodeId}"`);
  const anchor = node.anchors.find((candidate) => candidate.id === value.anchorId);
  if (!anchor)
    throw new RouterError(`unknown anchor "${value.anchorId}" on node "${value.nodeId}"`);
  return { point: anchorPoint(node, anchor), node, anchor };
}

function bezierControl(point: Point, side: AnchorSide, distance: number): Point {
  switch (side) {
    case "top":
      return { x: point.x, y: point.y - distance };
    case "right":
      return { x: point.x + distance, y: point.y };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "left":
      return { x: point.x - distance, y: point.y };
  }
}

function offsetBezierControl(point: Point, side: AnchorSide, offset: number): Point {
  return side === "left" || side === "right"
    ? { x: point.x, y: point.y + offset }
    : { x: point.x + offset, y: point.y };
}

function sideVector(side: AnchorSide): Point {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "right":
      return { x: 1, y: 0 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
  }
}

function moveOutward(point: Point, side: AnchorSide, distance = ORTHOGONAL_CLEARANCE): Point {
  const vector = sideVector(side);
  return {
    x: point.x + vector.x * distance,
    y: point.y + vector.y * distance,
  };
}

function endpointKey(value: CanvasEdge["source"]): string {
  return `${value.nodeId}\u0000${value.anchorId}`;
}

function canonicalPairKey(edge: CanvasEdge): string {
  const source = endpointKey(edge.source);
  const target = endpointKey(edge.target);
  return source < target ? `${source}\u0001${target}` : `${target}\u0001${source}`;
}

function parallelOffsets(clusters: Iterable<CanvasEdge[]>): Map<string, number> {
  const offsets = new Map<string, number>();
  for (const pairCluster of clusters) {
    const cluster = [...pairCluster].sort((a, b) => a.id.localeCompare(b.id));
    cluster.forEach((edge, index) => {
      offsets.set(edge.id, (index - (cluster.length - 1) / 2) * PARALLEL_TRACK_GAP);
    });
  }
  return offsets;
}

const EDGE_KIND_PRIORITY: Record<CanvasEdge["kind"], number> = {
  main: 0,
  secondary: 1,
  sync: 2,
  actor: 3,
  external: 4,
  exception: 5,
};

function clusterOwner(cluster: CanvasEdge[]): string | undefined {
  return [...cluster].sort(
    (a, b) => EDGE_KIND_PRIORITY[a.kind] - EDGE_KIND_PRIORITY[b.kind] || a.id.localeCompare(b.id),
  )[0]?.id;
}

function isAutoOrthogonal(edge: CanvasEdge): boolean {
  return edge.route.type === "orthogonal" && !edge.route.waypoints?.length;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < ROUTE_EPSILON && Math.abs(a.y - b.y) < ROUTE_EPSILON;
}

function simplifyOrthogonalPoints(points: Point[]): Point[] {
  const simplified: Point[] = [];
  for (const point of points) {
    const last = simplified.at(-1);
    if (last && samePoint(last, point)) continue;
    const previous = simplified.at(-2);
    if (
      previous &&
      last &&
      ((Math.abs(previous.x - last.x) < ROUTE_EPSILON &&
        Math.abs(last.x - point.x) < ROUTE_EPSILON) ||
        (Math.abs(previous.y - last.y) < ROUTE_EPSILON &&
          Math.abs(last.y - point.y) < ROUTE_EPSILON)) &&
      (last.x - previous.x) * (point.x - last.x) + (last.y - previous.y) * (point.y - last.y) >= 0
    ) {
      simplified[simplified.length - 1] = point;
    } else {
      simplified.push(point);
    }
  }
  return simplified;
}

function paddedBounds(node: PositionedNode): Bounds {
  return {
    left: node.x - ORTHOGONAL_OBSTACLE_PADDING,
    top: node.y - ORTHOGONAL_OBSTACLE_PADDING,
    right: node.x + node.w + ORTHOGONAL_OBSTACLE_PADDING,
    bottom: node.y + node.h + ORTHOGONAL_OBSTACLE_PADDING,
  };
}

function segmentCrossesBounds(from: Point, to: Point, bounds: Bounds): boolean {
  if (Math.abs(from.y - to.y) < ROUTE_EPSILON) {
    const y = from.y;
    if (y <= bounds.top + ROUTE_EPSILON || y >= bounds.bottom - ROUTE_EPSILON) return false;
    const left = Math.min(from.x, to.x);
    const right = Math.max(from.x, to.x);
    return right > bounds.left + ROUTE_EPSILON && left < bounds.right - ROUTE_EPSILON;
  }
  if (Math.abs(from.x - to.x) < ROUTE_EPSILON) {
    const x = from.x;
    if (x <= bounds.left + ROUTE_EPSILON || x >= bounds.right - ROUTE_EPSILON) return false;
    const top = Math.min(from.y, to.y);
    const bottom = Math.max(from.y, to.y);
    return bottom > bounds.top + ROUTE_EPSILON && top < bounds.bottom - ROUTE_EPSILON;
  }
  return true;
}

function isHorizontal(segment: Segment): boolean {
  return Math.abs(segment.from.y - segment.to.y) < ROUTE_EPSILON;
}

function segmentOverlapLength(a: Segment, b: Segment): number {
  if (isHorizontal(a) !== isHorizontal(b)) return 0;
  if (isHorizontal(a)) {
    if (Math.abs(a.from.y - b.from.y) >= ROUTE_EPSILON) return 0;
    return Math.max(
      0,
      Math.min(Math.max(a.from.x, a.to.x), Math.max(b.from.x, b.to.x)) -
        Math.max(Math.min(a.from.x, a.to.x), Math.min(b.from.x, b.to.x)),
    );
  }
  if (Math.abs(a.from.x - b.from.x) >= ROUTE_EPSILON) return 0;
  return Math.max(
    0,
    Math.min(Math.max(a.from.y, a.to.y), Math.max(b.from.y, b.to.y)) -
      Math.max(Math.min(a.from.y, a.to.y), Math.min(b.from.y, b.to.y)),
  );
}

function segmentsCross(a: Segment, b: Segment): boolean {
  if (isHorizontal(a) === isHorizontal(b)) return false;
  const horizontal = isHorizontal(a) ? a : b;
  const vertical = isHorizontal(a) ? b : a;
  const x = vertical.from.x;
  const y = horizontal.from.y;
  return (
    x > Math.min(horizontal.from.x, horizontal.to.x) + ROUTE_EPSILON &&
    x < Math.max(horizontal.from.x, horizontal.to.x) - ROUTE_EPSILON &&
    y > Math.min(vertical.from.y, vertical.to.y) + ROUTE_EPSILON &&
    y < Math.max(vertical.from.y, vertical.to.y) - ROUTE_EPSILON
  );
}

function middleSegments(points: Point[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 1; index < points.length - 2; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from && to && !samePoint(from, to)) segments.push({ from, to });
  }
  return segments;
}

function routeScore(
  points: Point[],
  obstacles: Bounds[],
  canvas: PositionedCanvas,
  occupied: Segment[],
): number {
  let score = Math.max(0, points.length - 2) * 18;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) continue;
    score += Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    for (const obstacle of obstacles) {
      if (segmentCrossesBounds(from, to, obstacle)) score += 1_000_000;
    }
  }
  for (const segment of middleSegments(points)) {
    for (const used of occupied) {
      const overlap = segmentOverlapLength(segment, used);
      if (overlap > ROUTE_EPSILON) score += 4_000 + overlap * 8;
      else if (segmentsCross(segment, used)) score += 140;
    }
  }
  for (const point of points) {
    if (point.x < 0 || point.y < 0 || point.x > canvas.width || point.y > canvas.height) {
      score += 10_000_000;
    }
  }
  return score;
}

function uniqueNumbers(values: number[]): number[] {
  return values.filter(
    (value, index) =>
      values.findIndex((candidate) => Math.abs(candidate - value) < ROUTE_EPSILON) === index,
  );
}

function orthogonalMiddleCandidates(
  source: Point,
  target: Point,
  sourceSide: AnchorSide,
  targetSide: AnchorSide,
  obstacles: Bounds[],
): Point[][] {
  const sourceVertical = sourceSide === "top" || sourceSide === "bottom";
  const targetVertical = targetSide === "top" || targetSide === "bottom";
  const xCorridors = uniqueNumbers([
    (source.x + target.x) / 2,
    ...obstacles.flatMap((obstacle) => [obstacle.left, obstacle.right]),
  ]);
  const yCorridors = uniqueNumbers([
    (source.y + target.y) / 2,
    ...obstacles.flatMap((obstacle) => [obstacle.top, obstacle.bottom]),
  ]);
  const candidates: Point[][] = [];

  if (sourceVertical && targetVertical) {
    for (const y of yCorridors) {
      candidates.push([source, { x: source.x, y }, { x: target.x, y }, target]);
    }
  } else if (!sourceVertical && !targetVertical) {
    for (const x of xCorridors) {
      candidates.push([source, { x, y: source.y }, { x, y: target.y }, target]);
    }
  } else if (sourceVertical) {
    candidates.push([source, { x: source.x, y: target.y }, target]);
  } else {
    candidates.push([source, { x: target.x, y: source.y }, target]);
  }

  candidates.push(
    [source, { x: target.x, y: source.y }, target],
    [source, { x: source.x, y: target.y }, target],
  );
  for (const x of xCorridors) {
    candidates.push([source, { x, y: source.y }, { x, y: target.y }, target]);
  }
  for (const y of yCorridors) {
    candidates.push([source, { x: source.x, y }, { x: target.x, y }, target]);
  }
  return candidates.map(simplifyOrthogonalPoints);
}

function parallelTrackCandidate(
  source: Point,
  target: Point,
  sourceSide: AnchorSide,
  targetSide: AnchorSide,
  offset: number,
): Point[] | undefined {
  if (Math.abs(offset) < ROUTE_EPSILON) return undefined;
  const sourceVertical = sourceSide === "top" || sourceSide === "bottom";
  const targetVertical = targetSide === "top" || targetSide === "bottom";
  if (!sourceVertical && !targetVertical) {
    const y = (source.y + target.y) / 2 + offset;
    return simplifyOrthogonalPoints([source, { x: source.x, y }, { x: target.x, y }, target]);
  }
  if (sourceVertical && targetVertical) {
    const x = (source.x + target.x) / 2 + offset;
    return simplifyOrthogonalPoints([source, { x, y: source.y }, { x, y: target.y }, target]);
  }
  const y = target.y + offset;
  return simplifyOrthogonalPoints([source, { x: source.x, y }, { x: target.x, y }, target]);
}

function respectsEndpointDirections(
  points: Point[],
  sourceSide: AnchorSide,
  targetSide: AnchorSide,
): boolean {
  if (points.length < 2) return true;
  const first = points[0];
  const second = points[1];
  const beforeLast = points.at(-2);
  const last = points.at(-1);
  if (!first || !second || !beforeLast || !last) return true;
  const sourceDirection = sideVector(sourceSide);
  const targetDirection = sideVector(targetSide);
  const departure = { x: second.x - first.x, y: second.y - first.y };
  const arrival = { x: last.x - beforeLast.x, y: last.y - beforeLast.y };
  return (
    departure.x * sourceDirection.x + departure.y * sourceDirection.y >= -ROUTE_EPSILON &&
    arrival.x * -targetDirection.x + arrival.y * -targetDirection.y >= -ROUTE_EPSILON
  );
}

function fansAtTrackedEndpoints(
  points: Point[],
  sourceSide: AnchorSide,
  targetSide: AnchorSide,
  sourceTracked: boolean,
  targetTracked: boolean,
  sourceTurn: number,
  targetTurn: number,
): boolean {
  if (points.length < 2) return true;
  const first = points[0];
  const second = points[1];
  const beforeLast = points.at(-2);
  const last = points.at(-1);
  if (!first || !second || !beforeLast || !last) return true;
  const sourceDirection = sideVector(sourceSide);
  const targetDirection = sideVector(targetSide);
  const departure = { x: second.x - first.x, y: second.y - first.y };
  const arrival = { x: last.x - beforeLast.x, y: last.y - beforeLast.y };
  const sourceForward = departure.x * sourceDirection.x + departure.y * sourceDirection.y;
  const targetForward = arrival.x * targetDirection.x + arrival.y * targetDirection.y;
  const sourceTangent = sourceSide === "left" || sourceSide === "right" ? departure.y : departure.x;
  const targetTangent = targetSide === "left" || targetSide === "right" ? arrival.y : arrival.x;
  const sourceTurnsAtTrack =
    Math.abs(sourceForward) < ROUTE_EPSILON && sourceTangent * sourceTurn > ROUTE_EPSILON;
  const targetTurnsAtTrack =
    Math.abs(targetForward) < ROUTE_EPSILON && targetTangent * targetTurn > ROUTE_EPSILON;
  return (!sourceTracked || sourceTurnsAtTrack) && (!targetTracked || targetTurnsAtTrack);
}

function perpendicularDelta(side: AnchorSide, from: Point, to: Point): number {
  return side === "left" || side === "right" ? to.y - from.y : to.x - from.x;
}

function sameEndpointLoop(
  point: Point,
  side: AnchorSide,
  clearance: number,
  offset: number,
): Point[] {
  const normal = sideVector(side);
  const tangent = { x: -normal.y, y: normal.x };
  const stem = clearance;
  const halfWidth = 34 + Math.abs(offset) / 2;
  const depth = clearance + 52 + Math.abs(offset);
  const stemPoint = {
    x: point.x + normal.x * stem,
    y: point.y + normal.y * stem,
  };
  return simplifyOrthogonalPoints([
    point,
    stemPoint,
    {
      x: stemPoint.x + tangent.x * halfWidth,
      y: stemPoint.y + tangent.y * halfWidth,
    },
    {
      x: point.x + normal.x * depth + tangent.x * halfWidth,
      y: point.y + normal.y * depth + tangent.y * halfWidth,
    },
    {
      x: point.x + normal.x * depth - tangent.x * halfWidth,
      y: point.y + normal.y * depth - tangent.y * halfWidth,
    },
    {
      x: stemPoint.x - tangent.x * halfWidth,
      y: stemPoint.y - tangent.y * halfWidth,
    },
    stemPoint,
    point,
  ]);
}

function smartOrthogonalPoints(
  canvas: PositionedCanvas,
  source: ResolvedEndpoint,
  target: ResolvedEndpoint,
  sourceClearance: number,
  targetClearance: number,
  trackOffset: number,
  occupied: Segment[],
  sourceFanOut: boolean,
  targetFanIn: boolean,
): Point[] {
  if (
    source.node.id === target.node.id &&
    source.anchor.id === target.anchor.id &&
    samePoint(source.point, target.point)
  ) {
    return sameEndpointLoop(source.point, source.anchor.side, sourceClearance, trackOffset);
  }
  const sourceExit = moveOutward(source.point, source.anchor.side, sourceClearance);
  const targetEntry = moveOutward(target.point, target.anchor.side, targetClearance);
  const obstacles = canvas.nodes
    .filter((node) => node.id !== source.node.id && node.id !== target.node.id)
    .map(paddedBounds);
  const rawCandidates = orthogonalMiddleCandidates(
    sourceExit,
    targetEntry,
    source.anchor.side,
    target.anchor.side,
    obstacles,
  );
  const directionalCandidates = rawCandidates.filter((candidate) =>
    respectsEndpointDirections(candidate, source.anchor.side, target.anchor.side),
  );
  const candidates = directionalCandidates.length ? directionalCandidates : rawCandidates;
  const sourceTurn = perpendicularDelta(source.anchor.side, source.point, target.point);
  const targetTurn = perpendicularDelta(target.anchor.side, source.point, target.point);
  const trackedCandidates = candidates.filter((candidate) =>
    fansAtTrackedEndpoints(
      candidate,
      source.anchor.side,
      target.anchor.side,
      sourceFanOut && Math.abs(sourceTurn) > ROUTE_EPSILON,
      targetFanIn && Math.abs(targetTurn) > ROUTE_EPSILON,
      sourceTurn,
      targetTurn,
    ),
  );
  const parallel = parallelTrackCandidate(
    sourceExit,
    targetEntry,
    source.anchor.side,
    target.anchor.side,
    trackOffset,
  );
  const validParallel =
    parallel && respectsEndpointDirections(parallel, source.anchor.side, target.anchor.side)
      ? parallel
      : undefined;
  const parallelScore = validParallel
    ? routeScore(validParallel, obstacles, canvas, occupied)
    : Number.POSITIVE_INFINITY;
  const best =
    validParallel && parallelScore < 1_000_000
      ? validParallel
      : (trackedCandidates.length ? trackedCandidates : candidates).reduce(
          (currentBest, candidate) =>
            routeScore(candidate, obstacles, canvas, occupied) <
            routeScore(currentBest, obstacles, canvas, occupied)
              ? candidate
              : currentBest,
        );
  return simplifyOrthogonalPoints([source.point, ...best, target.point]);
}

function roundedOrthogonalPath(points: Point[]): string {
  if (points.length < 3) {
    return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  }
  const commands = [`M ${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    if (!previous || !corner || !next) continue;
    const incomingLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(ORTHOGONAL_BEND_RADIUS, incomingLength / 2, outgoingLength / 2);
    const before = {
      x: corner.x - ((corner.x - previous.x) / incomingLength) * radius,
      y: corner.y - ((corner.y - previous.y) / incomingLength) * radius,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoingLength) * radius,
      y: corner.y + ((next.y - corner.y) / outgoingLength) * radius,
    };
    commands.push(`L ${before.x} ${before.y}`, `Q ${corner.x} ${corner.y} ${after.x} ${after.y}`);
  }
  const last = points.at(-1) ?? { x: 0, y: 0 };
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

export function routeEdges(canvas: PositionedCanvas): EdgePath[] {
  const edges = canvas.doc.edges;
  const resolved = new Map(
    edges.map((edge) => [
      edge.id,
      { source: endpoint(canvas, edge.source), target: endpoint(canvas, edge.target) },
    ]),
  );
  const sourceClusters = new Map<string, CanvasEdge[]>();
  const targetClusters = new Map<string, CanvasEdge[]>();
  const pairClusters = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    const sourceKey = endpointKey(edge.source);
    const sourceCluster = sourceClusters.get(sourceKey) ?? [];
    sourceCluster.push(edge);
    sourceClusters.set(sourceKey, sourceCluster);
    const targetKey = endpointKey(edge.target);
    const targetCluster = targetClusters.get(targetKey) ?? [];
    targetCluster.push(edge);
    targetClusters.set(targetKey, targetCluster);
    const pairKey = canonicalPairKey(edge);
    const pairCluster = pairClusters.get(pairKey) ?? [];
    pairCluster.push(edge);
    pairClusters.set(pairKey, pairCluster);
  }
  const trackOffsets = parallelOffsets(pairClusters.values());
  const occupied: Segment[] = [];

  return edges.map((edge) => {
    const endpoints = resolved.get(edge.id);
    if (!endpoints) throw new RouterError(`cannot resolve edge "${edge.id}"`);
    const { source, target } = endpoints;
    const sourceCluster = sourceClusters.get(endpointKey(edge.source)) ?? [edge];
    const targetCluster = targetClusters.get(endpointKey(edge.target)) ?? [edge];
    const sourceClearance = ORTHOGONAL_CLEARANCE;
    const targetClearance = ORTHOGONAL_CLEARANCE;
    const trackOffset = trackOffsets.get(edge.id) ?? 0;
    const position = edge.label?.position ?? 0.5;
    const offset = edge.label?.offset ?? { x: 0, y: 0 };
    let points: Point[] = [source.point, ...(edge.route.waypoints ?? []), target.point];
    let d: string;
    if (edge.route.type === "bezier" && points.length === 2) {
      if (
        source.node.id === target.node.id &&
        source.anchor.id === target.anchor.id &&
        samePoint(source.point, target.point)
      ) {
        points = sameEndpointLoop(source.point, source.anchor.side, sourceClearance, trackOffset);
        d = roundedOrthogonalPath(points);
      } else {
        const verticalPair =
          (source.anchor.side === "top" || source.anchor.side === "bottom") &&
          (target.anchor.side === "top" || target.anchor.side === "bottom");
        const horizontalPair =
          (source.anchor.side === "left" || source.anchor.side === "right") &&
          (target.anchor.side === "left" || target.anchor.side === "right");
        const distance = verticalPair
          ? Math.max(1, Math.abs(target.point.y - source.point.y) / 2)
          : horizontalPair
            ? Math.max(1, Math.abs(target.point.x - source.point.x) / 2)
            : Math.max(
                40,
                Math.hypot(target.point.x - source.point.x, target.point.y - source.point.y) / 2,
              );
        const first = offsetBezierControl(
          bezierControl(
            source.point,
            source.anchor.side,
            Math.max(distance, sourceClearance) + sourceClearance - ORTHOGONAL_CLEARANCE,
          ),
          source.anchor.side,
          trackOffset,
        );
        const second = offsetBezierControl(
          bezierControl(
            target.point,
            target.anchor.side,
            Math.max(distance, targetClearance) + targetClearance - ORTHOGONAL_CLEARANCE,
          ),
          target.anchor.side,
          trackOffset,
        );
        d = `M ${source.point.x} ${source.point.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${target.point.x} ${target.point.y}`;
      }
    } else {
      if (edge.route.type === "orthogonal" && points.length === 2) {
        points = smartOrthogonalPoints(
          canvas,
          source,
          target,
          sourceClearance,
          targetClearance,
          trackOffset,
          occupied,
          sourceCluster.length > 1,
          targetCluster.length > 1,
        );
      }
      d =
        edge.route.type === "orthogonal" && !edge.route.waypoints?.length
          ? roundedOrthogonalPath(points)
          : points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    }
    if (edge.route.type === "orthogonal" && !edge.route.waypoints?.length) {
      occupied.push(...middleSegments(points));
      if (occupied.length > MAX_OCCUPIED_SEGMENTS) {
        occupied.splice(0, occupied.length - MAX_OCCUPIED_SEGMENTS);
      }
    }
    const labelBase = pointAtPolyline(points, position);
    return {
      edge,
      route: edge.route.type,
      d,
      points,
      labelPoint: { x: labelBase.x + offset.x, y: labelBase.y + offset.y },
      junctionPoint:
        sourceCluster.length > 1 && edge.id === clusterOwner(sourceCluster)
          ? sourceCluster.every(isAutoOrthogonal)
            ? moveOutward(source.point, source.anchor.side, sourceClearance)
            : { ...source.point }
          : undefined,
      mergePoint:
        targetCluster.length > 1 && edge.id === clusterOwner(targetCluster)
          ? targetCluster.every(isAutoOrthogonal)
            ? moveOutward(target.point, target.anchor.side, targetClearance)
            : { ...target.point }
          : undefined,
    };
  });
}
