/**
 * Node overlap detection.
 *
 * MCP agents author geometry blind: they compute rects arithmetically and
 * never see the result, so two nodes landing on top of each other is a
 * routine authoring slip that nothing in the schema catches — a document
 * with overlapping nodes is perfectly valid, just wrong on screen.
 *
 * This is a *diagnostic*, never a rejection. Overlap is sometimes deliberate
 * (a badge sitting on a card, a deliberate stack), so the save must always
 * succeed and the caller decides what to do about the report.
 */

import type { Rect } from "./types.js";

/** One overlapping pair. `a` sorts before `b`, so a pair has one identity. */
export interface NodeOverlap {
  a: string;
  b: string;
  rectA: Rect;
  rectB: Rect;
  /** Area of the intersection, in world units. */
  area: number;
  /**
   * `area` over the area of the *smaller* node — how buried the more affected
   * of the two is. 1 means one node is completely covered by the other.
   */
  fraction: number;
}

export interface NodeOverlapReport {
  /** Overlaps in descending area order, capped at `limit`. */
  overlaps: NodeOverlap[];
  /** How many overlapping pairs exist in total, ignoring `limit`. */
  total: number;
  truncated: boolean;
}

export interface FindNodeOverlapsOptions {
  /** Maximum pairs to return. Default 20. */
  limit?: number;
}

const DEFAULT_LIMIT = 20;

/** Positive-area intersection only: nodes laid edge to edge do not overlap. */
function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (w <= 0) return 0;
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (h <= 0) return 0;
  return w * h;
}

/**
 * Finds every pair of nodes whose rects intersect with positive area.
 *
 * Sorted-sweep on x rather than the naive double loop: the 1000-node cap
 * would otherwise mean half a million comparisons on every save of a large
 * document, and a canvas is authored left to right, so the sweep window
 * stays small in practice.
 */
export function findNodeOverlaps(
  nodes: readonly { id: string; rect: Rect }[],
  options: FindNodeOverlapsOptions = {},
): NodeOverlapReport {
  const limit = Math.max(0, options.limit ?? DEFAULT_LIMIT);
  const ordered = [...nodes].sort((left, right) => left.rect.x - right.rect.x);
  const overlaps: NodeOverlap[] = [];
  let total = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    const first = ordered[i];
    if (!first) continue;
    const right = first.rect.x + first.rect.w;
    for (let j = i + 1; j < ordered.length; j += 1) {
      const second = ordered[j];
      if (!second) continue;
      // Sorted by x: once a candidate starts at or past this node's right
      // edge, so does every candidate after it.
      if (second.rect.x >= right) break;
      const area = intersectionArea(first.rect, second.rect);
      if (area <= 0) continue;
      total += 1;
      const [a, b] =
        first.id < second.id ? [first, second] : ([second, first] as [typeof first, typeof first]);
      overlaps.push({
        a: a.id,
        b: b.id,
        rectA: a.rect,
        rectB: b.rect,
        area,
        fraction: area / Math.min(first.rect.w * first.rect.h, second.rect.w * second.rect.h),
      });
    }
  }

  overlaps.sort((left, right) => right.area - left.area || (left.a < right.a ? -1 : 1));
  return { overlaps: overlaps.slice(0, limit), total, truncated: total > limit };
}
