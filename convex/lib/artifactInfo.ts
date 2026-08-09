/**
 * Extension -> {type, mime} inference, mirrored from
 * packages/runtime/src/render/artifact-store/index.ts's EXTENSION_INFO.
 * PLAN.md section 5 slates a shared, filesystem-free extraction of this
 * into packages/runtime; duplicated here in the meantime rather than
 * importing a module that also pulls in node:fs (artifact-store's other
 * exports assume a real filesystem, which Convex functions don't have).
 */

export type ArtifactType = "pdf" | "image" | "svg" | "source";

const EXTENSION_INFO: Record<string, { type: ArtifactType; mime: string }> = {
  ".pdf": { type: "pdf", mime: "application/pdf" },
  ".svg": { type: "svg", mime: "image/svg+xml" },
  ".png": { type: "image", mime: "image/png" },
  ".jpg": { type: "image", mime: "image/jpeg" },
  ".jpeg": { type: "image", mime: "image/jpeg" },
  ".gif": { type: "image", mime: "image/gif" },
  ".webp": { type: "image", mime: "image/webp" },
  ".html": { type: "source", mime: "text/html" },
  ".htm": { type: "source", mime: "text/html" },
  ".zip": { type: "source", mime: "application/zip" },
  ".json": { type: "source", mime: "application/json" },
};

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
