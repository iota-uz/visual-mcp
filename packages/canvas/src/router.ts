import type { PositionedCanvas, PositionedNode, PositionedStage } from "./layout.js";
import type { CanvasEdge, EdgeRoute } from "./types.js";

export interface EdgePoint {
  x: number;
  y: number;
}

export interface EdgePath {
  edge: CanvasEdge;
  route: Exclude<EdgeRoute, "auto">;
  d: string;
  labelPoint: EdgePoint;
}

export class RouterError extends Error {}

function centerY(node: PositionedNode): number {
  return node.y + node.h / 2;
}
function centerX(node: PositionedNode): number {
  return node.x + node.w / 2;
}

/** Cursor-anchored zoom scales node card sizes, not stroke width — see theme.css's `vector-effect: non-scaling-stroke`. */
function horizontalPath(from: PositionedNode, to: PositionedNode): { d: string; label: EdgePoint } {
  const reversed = to.x < from.x;
  const [a, b] = reversed ? [to, from] : [from, to];
  const startX = a.x + a.w;
  const startY = centerY(a);
  const endX = b.x;
  const endY = centerY(b);
  const dx = Math.max(40, (endX - startX) / 2);
  const c1x = startX + dx;
  const c2x = endX - dx;
  const d = reversed
    ? `M ${endX} ${endY} C ${c2x} ${endY}, ${c1x} ${startY}, ${startX} ${startY}`
    : `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`;
  return { d, label: { x: (startX + endX) / 2, y: (startY + endY) / 2 } };
}

function verticalPath(from: PositionedNode, to: PositionedNode): { d: string; label: EdgePoint } {
  const reversed = to.y < from.y;
  const [a, b] = reversed ? [to, from] : [from, to];
  const startY = a.y + a.h;
  const startX = centerX(a);
  const endY = b.y;
  const endX = centerX(b);
  const dy = Math.max(30, (endY - startY) / 2);
  const c1y = startY + dy;
  const c2y = endY - dy;
  const d = reversed
    ? `M ${endX} ${endY} C ${endX} ${c2y}, ${startX} ${c1y}, ${startX} ${startY}`
    : `M ${startX} ${startY} C ${startX} ${c1y}, ${endX} ${c2y}, ${endX} ${endY}`;
  return { d, label: { x: (startX + endX) / 2, y: (startY + endY) / 2 } };
}

/** Two-bend elbow: exit the near horizontal edge, cross at a shared midline, enter the near horizontal edge. */
function orthogonalPath(
  from: PositionedNode,
  to: PositionedNode,
  midX?: number,
): { d: string; label: EdgePoint } {
  const forward = to.x >= from.x;
  const startX = forward ? from.x + from.w : from.x;
  const startY = centerY(from);
  const endX = forward ? to.x : to.x + to.w;
  const endY = centerY(to);
  const mid = midX ?? (startX + endX) / 2;
  const d = `M ${startX} ${startY} L ${mid} ${startY} L ${mid} ${endY} L ${endX} ${endY}`;
  return { d, label: { x: mid, y: (startY + endY) / 2 } };
}

/**
 * Routes a long-span edge through the gutter (padding column) between stage
 * frames nearest the horizontal midpoint, instead of a raw midpoint that may
 * fall inside an intermediate stage's node cards.
 */
function gutterX(from: PositionedNode, to: PositionedNode, stages: PositionedStage[]): number {
  const midpoint = (centerX(from) + centerX(to)) / 2;
  let best = midpoint;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const stage of stages) {
    const boundary = stage.x;
    const dist = Math.abs(boundary - midpoint);
    if (dist < bestDist) {
      best = boundary;
      bestDist = dist;
    }
  }
  return best;
}

function stageIndexOf(stages: PositionedStage[], stageId: string): number {
  return stages.findIndex((s) => s.id === stageId);
}

function chooseAutoRoute(
  from: PositionedNode,
  to: PositionedNode,
  stages: PositionedStage[],
): Exclude<EdgeRoute, "auto"> {
  if (from.lane === to.lane) return "horizontal";
  if (from.stage === to.stage) return "vertical";
  const stageDiff = Math.abs(stageIndexOf(stages, to.stage) - stageIndexOf(stages, from.stage));
  return stageDiff <= 1 ? "orthogonal" : "gutter";
}

export function routeEdges(canvas: PositionedCanvas): EdgePath[] {
  const nodeById = new Map(canvas.nodes.map((n) => [n.id, n]));

  return canvas.doc.edges.map((edge) => {
    const from = nodeById.get(edge.from);
    if (!from) throw new RouterError(`edge references unknown source node "${edge.from}"`);
    const to = nodeById.get(edge.to);
    if (!to) throw new RouterError(`edge references unknown target node "${edge.to}"`);

    const route =
      !edge.route || edge.route === "auto" ? chooseAutoRoute(from, to, canvas.stages) : edge.route;

    switch (route) {
      case "horizontal": {
        const { d, label } = horizontalPath(from, to);
        return { edge, route, d, labelPoint: label };
      }
      case "vertical": {
        const { d, label } = verticalPath(from, to);
        return { edge, route, d, labelPoint: label };
      }
      case "orthogonal": {
        const { d, label } = orthogonalPath(from, to);
        return { edge, route, d, labelPoint: label };
      }
      case "gutter": {
        const mid = gutterX(from, to, canvas.stages);
        const { d, label } = orthogonalPath(from, to, mid);
        return { edge, route, d, labelPoint: label };
      }
      default:
        throw new RouterError(`unreachable: unknown route "${route satisfies never}"`);
    }
  });
}
