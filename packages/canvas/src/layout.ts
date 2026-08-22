import type { CanvasDoc, CanvasFile, CanvasGroup, CanvasNode, Rect } from "./types.js";

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

/**
 * Translates an arbitrary set of nodes by the same delta.
 *
 * This is the marquee gesture's server-side twin: a human drags five
 * selected nodes at once and the whole set has to land in one write, or a
 * concurrent agent edit lands between the fifth node and the first and the
 * arrangement the human made never existed.
 */
export function moveNodes(
  doc: CanvasDoc,
  nodeIds: readonly string[],
  dx: number,
  dy: number,
): CanvasDoc {
  const moving = new Set(nodeIds);
  for (const id of moving) {
    if (!doc.nodes.some((node) => node.id === id)) throw new Error(`unknown node "${id}"`);
  }
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      moving.has(node.id)
        ? { ...node, rect: { ...node.rect, x: node.rect.x + dx, y: node.rect.y + dy } }
        : node,
    ) as CanvasDoc["nodes"],
  };
}

export interface DeleteNodesResult {
  doc: CanvasDoc;
  removedNodeIds: string[];
  /** Edges that referenced a removed node at either end. */
  removedEdgeIds: string[];
  /** Groups left with no members at all. */
  removedGroupIds: string[];
}

/**
 * Removes nodes and everything that only existed because of them.
 *
 * An edge whose endpoint disappears is not a valid document — `CanvasDocSchema`
 * rejects it — so deletion is inherently a graph operation, never a filter
 * over `nodes`. Groups shrink, and a group with no members left is removed
 * rather than kept as an empty container.
 */
export function deleteNodes(doc: CanvasDoc, nodeIds: readonly string[]): DeleteNodesResult {
  const removing = new Set(nodeIds);
  for (const id of removing) {
    if (!doc.nodes.some((node) => node.id === id)) throw new Error(`unknown node "${id}"`);
  }
  const removedEdgeIds: string[] = [];
  const edges = doc.edges.filter((edge) => {
    const orphaned = removing.has(edge.source.nodeId) || removing.has(edge.target.nodeId);
    if (orphaned) removedEdgeIds.push(edge.id);
    return !orphaned;
  });
  const removedGroupIds: string[] = [];
  const groups: CanvasGroup[] = [];
  for (const group of doc.groups) {
    const members = group.nodeIds.filter((id) => !removing.has(id));
    if (members.length === 0) removedGroupIds.push(group.id);
    else groups.push({ ...group, nodeIds: members });
  }
  return {
    doc: {
      ...doc,
      nodes: doc.nodes.filter((node) => !removing.has(node.id)) as CanvasDoc["nodes"],
      edges,
      groups,
    },
    removedNodeIds: doc.nodes.filter((node) => removing.has(node.id)).map((node) => node.id),
    removedEdgeIds,
    removedGroupIds,
  };
}

/** Puts deleted nodes and edges back, for a session-local undo. */
export function restoreNodes(
  doc: CanvasDoc,
  nodes: readonly CanvasNode[],
  edges: readonly CanvasDoc["edges"][number][],
): CanvasDoc {
  const existingNodes = new Set(doc.nodes.map((node) => node.id));
  const existingEdges = new Set(doc.edges.map((edge) => edge.id));
  return {
    ...doc,
    nodes: [
      ...doc.nodes,
      ...nodes.filter((node) => !existingNodes.has(node.id)),
    ] as CanvasDoc["nodes"],
    edges: [...doc.edges, ...edges.filter((edge) => !existingEdges.has(edge.id))],
  };
}

/** Nodes whose rect lies entirely inside `area` — the marquee's contract. */
export function nodesFullyInside(doc: CanvasDoc, area: Rect): string[] {
  const right = area.x + area.w;
  const bottom = area.y + area.h;
  return doc.nodes
    .filter(
      (node) =>
        node.rect.x >= area.x &&
        node.rect.y >= area.y &&
        node.rect.x + node.rect.w <= right &&
        node.rect.y + node.rect.h <= bottom,
    )
    .map((node) => node.id);
}

export interface DeletePageNodesResult extends DeleteNodesResult {
  file: CanvasFile;
  /** Prototype interactions that pointed at a removed node from either end. */
  removedInteractionIds: string[];
  /** True when the prototype's start screen was one of the removed nodes. */
  clearedStart: boolean;
}

/**
 * Deletes nodes from one Page and repairs the canvas-level prototype.
 *
 * `CanvasFileSchema` resolves every prototype target against a real node, so
 * deleting a screen that a hotspot jumps to invalidates the whole file. The
 * prototype is canvas-level while nodes are page-level, which is exactly why
 * this cannot live in the page-scoped `deleteNodes`.
 */
export function deleteNodesFromFile(
  file: CanvasFile,
  pageId: string,
  nodeIds: readonly string[],
): DeletePageNodesResult {
  const page = file.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`unknown page "${pageId}"`);
  const result = deleteNodes(page.doc, nodeIds);
  const removed = new Set(result.removedNodeIds);
  const touches = (target: { pageId: string; nodeId: string }) =>
    target.pageId === pageId && removed.has(target.nodeId);
  const removedInteractionIds: string[] = [];
  const interactions = file.prototype.interactions.filter((interaction) => {
    const orphaned = touches(interaction.source) || touches(interaction.destination);
    if (orphaned) removedInteractionIds.push(interaction.id);
    return !orphaned;
  });
  const clearedStart = Boolean(file.prototype.start && touches(file.prototype.start));
  return {
    ...result,
    file: {
      ...file,
      pages: file.pages.map((candidate) =>
        candidate.id === pageId ? { ...candidate, doc: result.doc } : candidate,
      ),
      prototype: {
        ...file.prototype,
        start: clearedStart ? undefined : file.prototype.start,
        interactions,
      },
    },
    removedInteractionIds,
    clearedStart,
  };
}
