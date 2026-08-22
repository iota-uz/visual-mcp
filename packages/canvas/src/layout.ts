import type { CanvasDoc, CanvasGroup, CanvasNode, Rect } from "./types.js";

export type PositionedLane = CanvasDoc["lanes"][number];
export type PositionedStage = CanvasDoc["stages"][number];
export type PositionedNode = CanvasNode & { x: number; y: number; w: number; h: number };
export type PositionedGroup = CanvasGroup & { x: number; y: number; w: number; h: number };
export interface PositionedCanvas {
  doc: CanvasDoc;
  lanes: PositionedLane[];
  stages: PositionedStage[];
  nodes: PositionedNode[];
  groups: PositionedGroup[];
  width: number;
  height: number;
}

/** CanvasDoc v2 stores authoritative geometry; layout is intentionally deterministic. */
export function layoutCanvas(doc: CanvasDoc): PositionedCanvas {
  const nodes = doc.nodes.map((node) => ({
    ...node,
    rect: { ...node.rect },
    x: node.rect.x,
    y: node.rect.y,
    w: node.rect.w,
    h: node.rect.h,
  })) as PositionedNode[];
  return {
    doc,
    lanes: doc.lanes,
    stages: [...doc.stages].sort((a, b) => a.index - b.index),
    nodes,
    groups: doc.groups.map((group) => groupBounds(group, nodes)),
    width: doc.world.width,
    height: doc.world.height,
  };
}

/** The group frame always follows its children; no second geometry can drift. */
export function groupBounds(
  group: CanvasGroup,
  nodes: readonly Pick<PositionedNode, "id" | "x" | "y" | "w" | "h">[],
): PositionedGroup {
  const members = group.nodeIds.map((id) => nodes.find((node) => node.id === id)).filter(Boolean);
  if (members.length !== group.nodeIds.length)
    throw new Error(`group "${group.id}" has unknown nodes`);
  const positioned = members as Pick<PositionedNode, "x" | "y" | "w" | "h">[];
  const x = Math.min(...positioned.map((node) => node.x));
  const y = Math.min(...positioned.map((node) => node.y));
  const right = Math.max(...positioned.map((node) => node.x + node.w));
  const bottom = Math.max(...positioned.map((node) => node.y + node.h));
  return { ...group, x, y, w: right - x, h: bottom - y };
}

export function moveGroupNodes(doc: CanvasDoc, groupId: string, dx: number, dy: number): CanvasDoc {
  const group = doc.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`unknown group "${groupId}"`);
  const members = new Set(group.nodeIds);
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      members.has(node.id)
        ? { ...node, rect: { ...node.rect, x: node.rect.x + dx, y: node.rect.y + dy } }
        : node,
    ) as CanvasDoc["nodes"],
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
