import type { PositionedCanvas, PositionedNode } from "./layout.js";
import type { AnchorSide, CanvasEdge, ConnectorAnchor, Point } from "./types.js";

export interface EdgePath {
  edge: CanvasEdge;
  route: CanvasEdge["route"]["type"];
  d: string;
  labelPoint: Point;
}
export class RouterError extends Error {}

const ORTHOGONAL_CLEARANCE = 24;
const ORTHOGONAL_OBSTACLE_PADDING = 12;
const ORTHOGONAL_BEND_RADIUS = 10;
const ROUTE_EPSILON = 0.001;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
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

function endpoint(canvas: PositionedCanvas, value: CanvasEdge["source"]): Point {
  const node = canvas.nodes.find((candidate) => candidate.id === value.nodeId);
  if (!node) throw new RouterError(`unknown node "${value.nodeId}"`);
  const anchor = node.anchors.find((candidate) => candidate.id === value.anchorId);
  if (!anchor)
    throw new RouterError(`unknown anchor "${value.anchorId}" on node "${value.nodeId}"`);
  return anchorPoint(node, anchor);
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

function moveOutward(point: Point, side: AnchorSide): Point {
  const vector = sideVector(side);
  return {
    x: point.x + vector.x * ORTHOGONAL_CLEARANCE,
    y: point.y + vector.y * ORTHOGONAL_CLEARANCE,
  };
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
          Math.abs(last.y - point.y) < ROUTE_EPSILON))
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

function routeScore(points: Point[], obstacles: Bounds[], canvas: PositionedCanvas): number {
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

function smartOrthogonalPoints(
  canvas: PositionedCanvas,
  source: Point,
  target: Point,
  sourceSide: AnchorSide,
  targetSide: AnchorSide,
): Point[] {
  const sourceExit = moveOutward(source, sourceSide);
  const targetEntry = moveOutward(target, targetSide);
  const obstacles = canvas.nodes.map(paddedBounds);
  const candidates = orthogonalMiddleCandidates(
    sourceExit,
    targetEntry,
    sourceSide,
    targetSide,
    obstacles,
  );
  const best = candidates.reduce((currentBest, candidate) =>
    routeScore(candidate, obstacles, canvas) < routeScore(currentBest, obstacles, canvas)
      ? candidate
      : currentBest,
  );
  return simplifyOrthogonalPoints([source, ...best, target]);
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
  return canvas.doc.edges.map((edge) => {
    const source = endpoint(canvas, edge.source);
    const target = endpoint(canvas, edge.target);
    const position = edge.label?.position ?? 0.5;
    const offset = edge.label?.offset ?? { x: 0, y: 0 };
    let points: Point[] = [source, ...(edge.route.waypoints ?? []), target];
    let d: string;
    if (edge.route.type === "bezier" && points.length === 2) {
      const sourceAnchor = canvas.nodes
        .find((node) => node.id === edge.source.nodeId)
        ?.anchors.find((anchor) => anchor.id === edge.source.anchorId);
      const targetAnchor = canvas.nodes
        .find((node) => node.id === edge.target.nodeId)
        ?.anchors.find((anchor) => anchor.id === edge.target.anchorId);
      if (!sourceAnchor || !targetAnchor) {
        throw new RouterError(`cannot route bezier edge "${edge.id}" with unresolved anchors`);
      }
      const verticalPair =
        (sourceAnchor.side === "top" || sourceAnchor.side === "bottom") &&
        (targetAnchor.side === "top" || targetAnchor.side === "bottom");
      const horizontalPair =
        (sourceAnchor.side === "left" || sourceAnchor.side === "right") &&
        (targetAnchor.side === "left" || targetAnchor.side === "right");
      const distance = verticalPair
        ? Math.max(1, Math.abs(target.y - source.y) / 2)
        : horizontalPair
          ? Math.max(1, Math.abs(target.x - source.x) / 2)
          : Math.max(40, Math.hypot(target.x - source.x, target.y - source.y) / 2);
      const first = bezierControl(source, sourceAnchor.side, distance);
      const second = bezierControl(target, targetAnchor.side, distance);
      d = `M ${source.x} ${source.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${target.x} ${target.y}`;
    } else {
      if (edge.route.type === "orthogonal" && points.length === 2) {
        const sourceAnchor = canvas.nodes
          .find((node) => node.id === edge.source.nodeId)
          ?.anchors.find((anchor) => anchor.id === edge.source.anchorId);
        const targetAnchor = canvas.nodes
          .find((node) => node.id === edge.target.nodeId)
          ?.anchors.find((anchor) => anchor.id === edge.target.anchorId);
        if (!sourceAnchor || !targetAnchor) {
          throw new RouterError(
            `cannot route orthogonal edge "${edge.id}" with unresolved anchors`,
          );
        }
        points = smartOrthogonalPoints(
          canvas,
          source,
          target,
          sourceAnchor.side,
          targetAnchor.side,
        );
      }
      d =
        edge.route.type === "orthogonal" && !edge.route.waypoints?.length
          ? roundedOrthogonalPath(points)
          : points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    }
    const labelBase = pointAtPolyline(points, position);
    return {
      edge,
      route: edge.route.type,
      d,
      labelPoint: { x: labelBase.x + offset.x, y: labelBase.y + offset.y },
    };
  });
}
