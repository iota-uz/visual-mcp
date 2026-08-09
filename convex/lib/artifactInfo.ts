/**
 * Extension -> {type, mime} inference. Now the single, shared,
 * filesystem-free implementation lives in
 * `packages/runtime/src/render/artifact-info.ts` (extracted from that
 * package's old artifact-store module, which is gone — superseded by the
 * `artifacts` table); this module just re-exports it under the name
 * `convex/mcp/tools.ts` already imports.
 */

export { inferArtifactInfo, isTextMime } from "@visual-canvas/runtime/render/artifact-info.js";
export type { ArtifactType } from "@visual-canvas/runtime/types.js";
