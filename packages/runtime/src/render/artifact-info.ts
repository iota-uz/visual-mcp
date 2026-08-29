/**
 * Extension -> {type, mime} inference (PLAN.md Part 2 section 12).
 *
 * Deliberately filesystem-free — pure string logic over a `relPath` — so
 * it can be imported both by the render worker (real files on disk) and by
 * Convex functions (storage keys, no filesystem at all). This used to be
 * duplicated: once here, once independently in `convex/lib/artifactInfo.ts`
 * because the rest of this package's old artifact-store module pulled in
 * `node:fs`. That module is gone (superseded by Convex's `artifacts`
 * table); this is now the single implementation, and `convex/lib/
 * artifactInfo.ts` re-exports from it.
 */

import type { ArtifactType } from "../types.js";

const EXTENSION_INFO: Record<string, { type: ArtifactType; mime: string }> = {
  ".pdf": { type: "pdf", mime: "application/pdf" },
  ".svg": { type: "svg", mime: "image/svg+xml" },
  ".png": { type: "image", mime: "image/png" },
  ".jpg": { type: "image", mime: "image/jpeg" },
  ".jpeg": { type: "image", mime: "image/jpeg" },
  ".gif": { type: "image", mime: "image/gif" },
  ".webp": { type: "image", mime: "image/webp" },
  ".avif": { type: "image", mime: "image/avif" },
  ".mp4": { type: "source", mime: "video/mp4" },
  ".webm": { type: "source", mime: "video/webm" },
  ".woff2": { type: "source", mime: "font/woff2" },
  ".woff": { type: "source", mime: "font/woff" },
  ".ttf": { type: "source", mime: "font/ttf" },
  ".otf": { type: "source", mime: "font/otf" },
  ".html": { type: "source", mime: "text/html" },
  ".htm": { type: "source", mime: "text/html" },
  ".zip": { type: "source", mime: "application/zip" },
  ".json": { type: "source", mime: "application/json" },
};

/** Infers artifact type/MIME from a path's extension, defaulting to opaque binary. */
export function inferArtifactInfo(relPath: string): { type: ArtifactType; mime: string } {
  const dot = relPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : relPath.slice(dot).toLowerCase();
  return EXTENSION_INFO[ext] ?? { type: "source", mime: "application/octet-stream" };
}

/** Text-ish MIME types get inlined as UTF-8 text; everything else as base64. */
export function isTextMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") || mimeType === "image/svg+xml" || mimeType === "application/json"
  );
}
