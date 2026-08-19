import type { CanvasDoc, CanvasNode, Rect } from "./types.js";

export type PositionedLane = CanvasDoc["lanes"][number];
export type PositionedStage = CanvasDoc["stages"][number];
export type PositionedNode = CanvasNode & { x: number; y: number; w: number; h: number };
export interface PositionedCanvas {
  doc: CanvasDoc;
  lanes: PositionedLane[];
  stages: PositionedStage[];
  nodes: PositionedNode[];
  width: number;
  height: number;
}

/** CanvasDoc v2 stores authoritative geometry; layout is intentionally deterministic. */
export function layoutCanvas(doc: CanvasDoc): PositionedCanvas {
  return {
    doc,
    lanes: doc.lanes,
    stages: [...doc.stages].sort((a, b) => a.index - b.index),
    nodes: doc.nodes.map((node) => ({
      ...node,
      x: node.rect.x,
      y: node.rect.y,
      w: node.rect.w,
      h: node.rect.h,
    })) as PositionedNode[],
    width: doc.world.width,
    height: doc.world.height,
  };
}

export function patchNodeRect(doc: CanvasDoc, nodeId: string, rect: Rect): CanvasDoc {
  if (!doc.nodes.some((node) => node.id === nodeId)) throw new Error(`unknown node "${nodeId}"`);
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      node.id === nodeId ? { ...node, rect } : node,
    ) as CanvasDoc["nodes"],
  };
}
