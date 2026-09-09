import type { Point } from "./types.js";

export type CommentLocal = Point;

function unit(n: number): number {
  if (!Number.isFinite(n)) return n > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, n));
}

/** Clamp a node-local comment spot into 0–1. */
export function clampLocal(local: CommentLocal): CommentLocal {
  return { x: unit(local.x), y: unit(local.y) };
}

export function localFromWorld(
  node: { x: number; y: number; w: number; h: number },
  world: Point,
): CommentLocal {
  if (!(node.w > 0) || !(node.h > 0)) return { x: 0, y: 0 };
  return clampLocal({
    x: (world.x - node.x) / node.w,
    y: (world.y - node.y) / node.h,
  });
}

/**
 * Where a comment pin sits in world space. A node with `local` is the click
 * inside the frame; a node without it is the legacy top-right; a missing
 * node is gone; otherwise the page point.
 */
export function worldFromCommentAnchor(
  node: { x: number; y: number; w: number; h: number } | undefined,
  anchor: { nodeId?: string; point?: Point; local?: CommentLocal },
): Point | null {
  if (anchor.nodeId) {
    if (!node) return null;
    if (anchor.local) {
      const local = clampLocal(anchor.local);
      return { x: node.x + local.x * node.w, y: node.y + local.y * node.h };
    }
    return { x: node.x + node.w, y: node.y };
  }
  return anchor.point ?? null;
}
