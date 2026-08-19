import type { PositionedCanvas, PositionedNode } from "./layout.js";
import type { AnchorSide, CanvasEdge, ConnectorAnchor, Point } from "./types.js";

export interface EdgePath {
  edge: CanvasEdge;
  route: CanvasEdge["route"]["type"];
  d: string;
  labelPoint: Point;
}
export class RouterError extends Error {}

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
        const midX = (source.x + target.x) / 2;
        points = [source, { x: midX, y: source.y }, { x: midX, y: target.y }, target];
      }
      d = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
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
