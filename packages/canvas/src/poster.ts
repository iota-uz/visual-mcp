import type { CanvasDoc, CanvasFile, LaneRole } from "./types.js";
import { resolveCanvasPage } from "./types.js";

/**
 * Schematic cover geometry for a canvas, derived from its own document.
 *
 * This is **not** a renderer. The one rasterizer is the Playwright snapshot
 * worker (adr/platform/browser-export-via-snapshot-worker.md): a poster is
 * list-view chrome and nothing else. It is never downloaded, never exported,
 * never embedded, never a share card, and it carries no text and no images —
 * precisely so it cannot be mistaken for a picture of the canvas.
 *
 * It is also not `canvases.thumbnailId`, which is the worker's PNG and the
 * og:image of a public share card
 * (adr/sharing/static-preview-cards-not-embedded-viewers.md). The poster
 * lives in its own field and never writes that one.
 *
 * Only `kind: "canvas"` has a document to derive one from; `html`, `image`
 * and `pdf` are opaque artifacts
 * (adr/product/agent-authored-dual-format-canvas.md).
 */

export const POSTER_FORMAT = 1;

/**
 * Enough rectangles to read a shape, few enough to keep a row small. See the
 * byte budget on `canvases.poster` in convex/schema.ts.
 */
export const POSTER_MAX_RECTS = 32;

/** Aspect ratios outside this letterbox rather than collapse to a hairline. */
const AR_RANGE = [0.25, 4] as const;

/** Per-mille of the cover page's node bounding box; integers 0…1000. */
export interface PosterRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The lane the node sits in, when it sits in one. */
  r?: LaneRole;
  /** Only for nodes that are not native, so a screenshot reads as one. */
  k?: "iframe" | "image";
}

export interface CanvasPoster {
  format: typeof POSTER_FORMAT;
  /** Bounding-box aspect (w/h), two decimals, clamped to [0.25, 4]. */
  ar: number;
  /** Nodes on the cover page *before* the cap, so density can be printed. */
  n: number;
  /** Pages in the file, so a card can say "3 pages" instead of implying one. */
  p: number;
  /** Largest by area first, ties broken by id so the output is stable. */
  rects: PosterRect[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Cover geometry for one page. `p` is 1; `canvasPoster` overwrites it. */
export function canvasPosterForDoc(doc: CanvasDoc): CanvasPoster {
  const nodes = doc.nodes;
  if (nodes.length === 0) {
    return { format: POSTER_FORMAT, ar: 4 / 3, n: 0, p: 1, rects: [] };
  }

  const left = Math.min(...nodes.map((node) => node.rect.x));
  const top = Math.min(...nodes.map((node) => node.rect.y));
  const right = Math.max(...nodes.map((node) => node.rect.x + node.rect.w));
  const bottom = Math.max(...nodes.map((node) => node.rect.y + node.rect.h));
  // Every node can share one x, and a zero-width box divides by zero.
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  const lanes = new Map(doc.lanes.map((lane) => [lane.id, lane.role]));
  const rects = [...nodes]
    // Largest first, not document order: an arbitrary 32 of 500 nodes is a
    // different picture every time the file is re-serialised.
    .sort(
      (a, b) =>
        b.rect.w * b.rect.h - a.rect.w * a.rect.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, POSTER_MAX_RECTS)
    .map((node): PosterRect => {
      const role = node.laneId ? lanes.get(node.laneId) : undefined;
      return {
        x: Math.round(((node.rect.x - left) / width) * 1000),
        y: Math.round(((node.rect.y - top) / height) * 1000),
        w: Math.round((node.rect.w / width) * 1000),
        h: Math.round((node.rect.h / height) * 1000),
        ...(role ? { r: role } : {}),
        ...(node.kind === "iframe" || node.kind === "image" ? { k: node.kind } : {}),
      };
    });

  return {
    format: POSTER_FORMAT,
    ar: Math.round(clamp(width / height, AR_RANGE[0], AR_RANGE[1]) * 100) / 100,
    n: nodes.length,
    p: 1,
    rects,
  };
}

/**
 * Cover geometry for a file: the page `resolveCanvasPage` picks — the one a
 * viewer opens — so the cover is a promise the click keeps.
 */
export function canvasPoster(file: CanvasFile): CanvasPoster {
  const poster = canvasPosterForDoc(resolveCanvasPage(file).doc);
  return { ...poster, p: file.pages.length };
}
