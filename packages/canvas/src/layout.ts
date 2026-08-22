import type {
  CanvasDoc,
  CanvasEdge,
  CanvasFile,
  CanvasGroup,
  CanvasNode,
  PrototypeInteraction,
  PrototypeTarget,
  Rect,
} from "./types.js";

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
  /**
   * Every group the delete changed, as it was *before* — removed and merely
   * shrunk alike. Undo needs the whole group back, not the difference.
   */
  changedGroups: CanvasGroup[];
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
  const changedGroups: CanvasGroup[] = [];
  const groups: CanvasGroup[] = [];
  for (const group of doc.groups) {
    const members = group.nodeIds.filter((id) => !removing.has(id));
    if (members.length !== group.nodeIds.length) changedGroups.push({ ...group });
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
    changedGroups,
  };
}

/**
 * Everything a delete destroyed, kept so undo can put it back.
 *
 * Nodes and edges are the obvious half; the other half is context the nodes
 * were *part of* — group membership, prototype hotspots, the start screen.
 * Restoring only the nodes leaves a canvas that looks recovered but has
 * quietly lost its grouping and its prototype wiring.
 */
export interface NodeRestorePayload {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups?: CanvasGroup[];
  interactions?: PrototypeInteraction[];
  start?: PrototypeTarget;
}

/**
 * Puts deleted nodes, edges and groups back, for a session-local undo.
 *
 * Idempotent by id, and defensive about the world having moved on: the
 * document is shared, so another author may have deleted a group member of
 * their own between the delete and the undo. Memberships are filtered to
 * nodes that actually exist, because a group naming a missing node fails
 * `CanvasDocSchema`.
 */
export function restoreNodes(doc: CanvasDoc, payload: NodeRestorePayload): CanvasDoc {
  const existingNodes = new Set(doc.nodes.map((node) => node.id));
  const existingEdges = new Set(doc.edges.map((edge) => edge.id));
  const nodes = [
    ...doc.nodes,
    ...payload.nodes.filter((node) => !existingNodes.has(node.id)),
  ] as CanvasDoc["nodes"];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [
    ...doc.edges,
    ...payload.edges.filter(
      (edge) =>
        !existingEdges.has(edge.id) && nodeIds.has(edge.source.nodeId) && nodeIds.has(edge.target.nodeId),
    ),
  ];

  const groups = [...doc.groups];
  for (const group of payload.groups ?? []) {
    const members = group.nodeIds.filter((id) => nodeIds.has(id));
    if (members.length === 0) continue;
    const restored = { ...group, nodeIds: members };
    const index = groups.findIndex((candidate) => candidate.id === group.id);
    if (index < 0) groups.push(restored);
    else groups[index] = restored;
  }
  return { ...doc, nodes, edges, groups };
}

/**
 * Doc-level restore plus the canvas-level prototype the deleted nodes were
 * wired into. Interactions and the start screen come back only if both of
 * their endpoints resolve again, so an undo can never reintroduce a dangling
 * hotspot that `CanvasFileSchema` would reject.
 */
export function restoreNodesIntoFile(
  file: CanvasFile,
  pageId: string,
  payload: NodeRestorePayload,
): CanvasFile {
  const page = file.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`unknown page "${pageId}"`);
  const doc = restoreNodes(page.doc, payload);
  const pages = file.pages.map((candidate) =>
    candidate.id === pageId ? { ...candidate, doc } : candidate,
  );
  const resolves = (target: PrototypeTarget) =>
    pages.some(
      (candidate) =>
        candidate.id === target.pageId &&
        candidate.doc.nodes.some((node) => node.id === target.nodeId),
    );

  const taken = new Set(file.prototype.interactions.map((interaction) => interaction.id));
  const interactions = [
    ...file.prototype.interactions,
    ...(payload.interactions ?? []).filter(
      (interaction) =>
        !taken.has(interaction.id) &&
        resolves(interaction.source) &&
        resolves(interaction.destination),
    ),
  ];
  const start =
    file.prototype.start ?? (payload.start && resolves(payload.start) ? payload.start : undefined);
  return { ...file, pages, prototype: { ...file.prototype, start, interactions } };
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
  /** Exactly what `restoreNodesIntoFile` needs to undo this delete. */
  undo: NodeRestorePayload;
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
  const removedInteractions: PrototypeInteraction[] = [];
  const interactions = file.prototype.interactions.filter((interaction) => {
    const orphaned = touches(interaction.source) || touches(interaction.destination);
    if (orphaned) {
      removedInteractionIds.push(interaction.id);
      removedInteractions.push(interaction);
    }
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
    undo: {
      nodes: page.doc.nodes.filter((node) => removed.has(node.id)),
      edges: page.doc.edges.filter((edge) => result.removedEdgeIds.includes(edge.id)),
      groups: result.changedGroups,
      interactions: removedInteractions,
      start: clearedStart ? file.prototype.start : undefined,
    },
  };
}
