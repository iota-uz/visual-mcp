/**
 * Reusable canvas components.
 *
 * An agent that has drawn a good login flow once has, until now, had to draw
 * it again on the next canvas — nothing carried a group of nodes and the
 * edges between them from one document to another. A component is that
 * bundle: nodes, their internal edges, and geometry expressed relative to a
 * local origin so it can be dropped anywhere.
 *
 * Deliberately not a Figma master/instance system. Insertion produces an
 * independent copy; editing the component later does not reach back into
 * documents that already used it. That is the whole reason this can stay a
 * few pure functions instead of a live reference graph.
 */

import { z } from "zod";
import {
  type CanvasDoc,
  CanvasEdgeSchema,
  CanvasNodeSchema,
  type CanvasEdge,
  type CanvasNode,
  type Point,
} from "./types.js";

export const CanvasComponentBodySchema = z
  .object({
    nodes: z.array(CanvasNodeSchema).min(1).max(200),
    edges: z.array(CanvasEdgeSchema).max(400).default([]),
  })
  .superRefine((body, ctx) => {
    const ids = new Set<string>();
    body.nodes.forEach((node, index) => {
      if (ids.has(node.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "id"],
          message: `duplicate node id "${node.id}"`,
        });
      ids.add(node.id);
      // A component travels between documents, so it may not depend on the
      // lanes and stages of the page it came from.
      if (node.laneId || node.stageId)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index],
          message: "component nodes may not reference a lane or stage",
        });
    });
    body.edges.forEach((edge, index) => {
      for (const [key, endpoint] of [
        ["source", edge.source],
        ["target", edge.target],
      ] as const) {
        if (!ids.has(endpoint.nodeId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges", index, key, "nodeId"],
            message: `edge endpoint "${endpoint.nodeId}" is not part of this component`,
          });
      }
    });
  });
export type CanvasComponentBody = z.infer<typeof CanvasComponentBodySchema>;

/**
 * Pulls a set of nodes and the edges strictly between them out of a page.
 *
 * Geometry is rebased on the set's own top-left corner, so a component
 * carries an internal arrangement rather than the coordinates it happened to
 * occupy. Edges with one end outside the set are dropped: they describe the
 * page, not the component.
 */
export function extractComponent(doc: CanvasDoc, nodeIds: readonly string[]): CanvasComponentBody {
  const wanted = new Set(nodeIds);
  for (const id of wanted) {
    if (!doc.nodes.some((node) => node.id === id)) throw new Error(`unknown node "${id}"`);
  }
  const nodes = doc.nodes.filter((node) => wanted.has(node.id));
  if (nodes.length === 0) throw new Error("a component needs at least one node");
  const originX = Math.min(...nodes.map((node) => node.rect.x));
  const originY = Math.min(...nodes.map((node) => node.rect.y));
  return CanvasComponentBodySchema.parse({
    nodes: nodes.map((node) => {
      const { laneId, stageId, ...rest } = node;
      return {
        ...rest,
        rect: { ...node.rect, x: node.rect.x - originX, y: node.rect.y - originY },
      };
    }),
    edges: doc.edges.filter(
      (edge) => wanted.has(edge.source.nodeId) && wanted.has(edge.target.nodeId),
    ),
  });
}

export interface InsertComponentOptions {
  /** Where the component's local origin lands in the target world. */
  at: Point;
  /** Optional page context for the copies; both must already exist. */
  laneId?: string;
  stageId?: string;
  /** Creates a group over the inserted nodes when set. */
  groupLabel?: string;
  /** Prefix for generated ids; defaults to the component's own name. */
  idPrefix?: string;
}

export interface InsertComponentResult {
  doc: CanvasDoc;
  /** Original component id → id created in the target document. */
  nodeIds: Record<string, string>;
  edgeIds: Record<string, string>;
  groupId?: string;
}

/** First id in the `prefix-base`, `prefix-base-2`, … series that is free. */
function freeId(prefix: string, base: string, taken: Set<string>): string {
  const root = prefix ? `${prefix}-${base}` : base;
  if (!taken.has(root)) {
    taken.add(root);
    return root;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${root}-${suffix}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    return candidate;
  }
}

/**
 * Copies a component into a document at a point.
 *
 * Every entity id is remapped and every internal edge re-bound to the copies,
 * so two insertions of the same component are independent from the moment
 * they land — which is exactly what makes "no master/instance" safe.
 */
export function insertComponent(
  doc: CanvasDoc,
  body: CanvasComponentBody,
  options: InsertComponentOptions,
): InsertComponentResult {
  const prefix = (options.idPrefix ?? "").trim();
  const takenNodes = new Set(doc.nodes.map((node) => node.id));
  const takenEdges = new Set(doc.edges.map((edge) => edge.id));
  const takenGroups = new Set(doc.groups.map((group) => group.id));

  const nodeIds: Record<string, string> = {};
  const nodes: CanvasNode[] = body.nodes.map((node) => {
    const id = freeId(prefix, node.id, takenNodes);
    nodeIds[node.id] = id;
    return {
      ...node,
      id,
      ...(options.laneId ? { laneId: options.laneId } : {}),
      ...(options.stageId ? { stageId: options.stageId } : {}),
      rect: { ...node.rect, x: node.rect.x + options.at.x, y: node.rect.y + options.at.y },
    } as CanvasNode;
  });

  const edgeIds: Record<string, string> = {};
  const edges: CanvasEdge[] = body.edges.map((edge) => {
    const id = freeId(prefix, edge.id, takenEdges);
    edgeIds[edge.id] = id;
    return {
      ...edge,
      id,
      source: { ...edge.source, nodeId: nodeIds[edge.source.nodeId] as string },
      target: { ...edge.target, nodeId: nodeIds[edge.target.nodeId] as string },
    };
  });

  const groupId = options.groupLabel ? freeId(prefix, "group", takenGroups) : undefined;
  return {
    doc: {
      ...doc,
      nodes: [...doc.nodes, ...nodes] as CanvasDoc["nodes"],
      edges: [...doc.edges, ...edges],
      groups: groupId
        ? [
            ...doc.groups,
            { id: groupId, label: options.groupLabel as string, nodeIds: Object.values(nodeIds) },
          ]
        : doc.groups,
    },
    nodeIds,
    edgeIds,
    ...(groupId ? { groupId } : {}),
  };
}

/** Bounding size of a component, for previews and placement hints. */
export function componentSize(body: CanvasComponentBody): { width: number; height: number } {
  return {
    width: Math.max(...body.nodes.map((node) => node.rect.x + node.rect.w)),
    height: Math.max(...body.nodes.map((node) => node.rect.y + node.rect.h)),
  };
}
