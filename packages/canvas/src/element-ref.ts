import { VC_ID_PATTERN } from "./vc-id.js";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ElementRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElementRefError";
  }
}

export interface ParsedElementRef {
  canvasRef: string;
  workspaceSlug: string;
  canvasSlug: string;
  nodeId: string;
  /** Inner `data-vc-id` on the node's HTML, when the ref names a control. */
  el?: string;
}

export interface ElementSelection {
  node: CanvasNode;
  context: {
    lane: Lane | null;
    stage: Stage | null;
    incoming_edges: CanvasEdge[];
    outgoing_edges: CanvasEdge[];
  };
}

function assertSlug(value: string, label: string): void {
  if (!SLUG_PATTERN.test(value)) {
    throw new ElementRefError(`${label} must be a lowercase ASCII slug.`);
  }
}

/** Formats the canonical locator for a node, or a control inside it. */
export function formatElementRef(canvasRef: string, nodeId: string, el?: string): string {
  const parts = canvasRef.split("/");
  if (parts.length !== 2) {
    throw new ElementRefError('canvasRef must be "workspace-slug/canvas-slug".');
  }
  const [workspaceSlug, canvasSlug] = parts as [string, string];
  assertSlug(workspaceSlug, "workspace slug");
  assertSlug(canvasSlug, "canvas slug");
  if (!nodeId) throw new ElementRefError("node id must be non-empty.");
  const base = `canvas://${workspaceSlug}/${canvasSlug}?node=${encodeURIComponent(nodeId)}`;
  if (el === undefined || el === "") return base;
  if (!VC_ID_PATTERN.test(el)) {
    throw new ElementRefError("el must be a lowercase data-vc-id slug.");
  }
  return `${base}&el=${encodeURIComponent(el)}`;
}

/** Strictly parses an element ref instead of guessing at malformed locators. */
export function parseElementRef(value: unknown): ParsedElementRef {
  if (typeof value !== "string" || value.length === 0) {
    throw new ElementRefError("ref_id must be a non-empty string.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ElementRefError(
      "invalid_ref_id: expected canvas://workspace/canvas?node=<id>[&el=<id>].",
    );
  }
  const keys = [...url.searchParams.keys()];
  if (
    url.protocol !== "canvas:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname.split("/").filter(Boolean).length !== 1 ||
    keys[0] !== "node" ||
    url.searchParams.getAll("node").length !== 1 ||
    (keys.length === 2 && (keys[1] !== "el" || url.searchParams.getAll("el").length !== 1)) ||
    keys.length > 2
  ) {
    throw new ElementRefError(
      "invalid_ref_id: expected canvas://workspace/canvas?node=<id>[&el=<id>].",
    );
  }

  const workspaceSlug = url.hostname;
  const canvasSlug = url.pathname.slice(1);
  const nodeId = url.searchParams.get("node") ?? "";
  const el = url.searchParams.get("el") ?? undefined;
  assertSlug(workspaceSlug, "workspace slug");
  assertSlug(canvasSlug, "canvas slug");
  if (!nodeId) throw new ElementRefError("invalid_ref_id: node id must be non-empty.");

  const parsed = {
    canvasRef: `${workspaceSlug}/${canvasSlug}`,
    workspaceSlug,
    canvasSlug,
    nodeId,
    ...(el ? { el } : {}),
  };
  if (formatElementRef(parsed.canvasRef, parsed.nodeId, parsed.el) !== value) {
    throw new ElementRefError("invalid_ref_id: ref_id must use the canonical encoded form.");
  }
  return parsed;
}

/** Resolves the exact semantic node plus the graph context an agent needs to edit it. */
export function resolveElementSelection(doc: CanvasDoc, nodeId: string): ElementSelection | null {
  const node = doc.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  return {
    node,
    context: {
      lane: node.laneId ? (doc.lanes.find((lane) => lane.id === node.laneId) ?? null) : null,
      stage: node.stageId ? (doc.stages.find((stage) => stage.id === node.stageId) ?? null) : null,
      incoming_edges: doc.edges.filter((edge) => edge.target.nodeId === node.id),
      outgoing_edges: doc.edges.filter((edge) => edge.source.nodeId === node.id),
    },
  };
}

import type { CanvasDoc, CanvasEdge, CanvasNode, Lane, Stage } from "./types.js";
