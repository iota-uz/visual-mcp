/**
 * Data model per PLAN.md section 4. Pure `defineSchema`/`defineTable` — no
 * dependency on `./_generated/*`, so this typechecks and can be reviewed
 * before `npx convex dev` has ever run against a real deployment (unlike
 * http.ts's queries/mutations, which need the codegen'd `mutation`/`query`
 * wrappers from `_generated/server`).
 *
 * The 1 MiB Convex document limit is why `canvasVersions` only holds
 * storage ids for the full `CanvasDoc` JSON / compiled CSS / other-kind
 * entrypoint — never the bytes themselves (section 4's "Adapting to
 * Convex's 1 MiB document limit").
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    googleSub: v.string(),
    email: v.string(),
    name: v.string(),
    pictureUrl: v.optional(v.string()),
    lastSeenAt: v.number(),
  })
    .index("by_googleSub", ["googleSub"])
    .index("by_email", ["email"]),

  // Static bearer tokens (PLAN.md section 7) — never store the plaintext,
  // only its sha256 hash plus an 8-char display prefix for the tokens UI.
  mcpTokens: defineTable({
    userId: v.id("users"),
    name: v.string(),
    prefix: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"]),

  workspaces: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.id("users"),
    archivedAt: v.optional(v.number()),
  }).index("by_slug", ["slug"]),

  canvases: defineTable({
    workspaceId: v.id("workspaces"),
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.union(v.literal("canvas"), v.literal("html"), v.literal("image"), v.literal("pdf")),
    visibility: v.union(v.literal("private"), v.literal("public")),
    // 128-bit base62, minted on publish and rotatable (PLAN.md section 4) —
    // unpublishing clears it, which is what makes revocation real.
    publicSlug: v.optional(v.string()),
    theme: v.optional(v.string()),
    currentVersionId: v.optional(v.id("canvasVersions")),
    thumbnailId: v.optional(v.id("_storage")),
    createdBy: v.id("users"),
    // Bumped on every new version — backs by_workspace_updated so the
    // gallery can sort by recency (PLAN.md section 4's index name implies
    // this; not itself an explicit field in the plan's abbreviated table).
    updatedAt: v.number(),
  })
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .index("by_workspace_slug", ["workspaceId", "slug"])
    .index("by_publicSlug", ["publicSlug"]),

  canvasVersions: defineTable({
    canvasId: v.id("canvases"),
    version: v.number(),
    note: v.optional(v.string()),
    createdBy: v.id("users"),
    docStorageId: v.optional(v.id("_storage")),
    cssStorageId: v.optional(v.id("_storage")),
    entryStorageId: v.optional(v.id("_storage")),
  }).index("by_canvas_version", ["canvasId", "version"]),

  // One small document per canvas node — what makes `#node=` resolution and
  // full-text search index lookups instead of full-document scans (PLAN.md
  // section 4).
  canvasNodes: defineTable({
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    nodeId: v.string(),
    title: v.string(),
    eyebrow: v.optional(v.string()),
    searchText: v.string(),
  })
    .index("by_version", ["versionId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["canvasId"] }),

  // /src, /output, /cache, /assets are prefixes on relPath, not directories
  // (PLAN.md section 4) — /cache renders stay out of `artifacts`, as today.
  canvasFiles: defineTable({
    canvasId: v.id("canvases"),
    relPath: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    contentHash: v.string(),
  }).index("by_canvas_relPath", ["canvasId", "relPath"]),

  artifacts: defineTable({
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    relPath: v.string(),
    // Matches packages/runtime's ArtifactType/ArtifactRole (src/types.ts) —
    // the artifact-store's type inference moves into packages/runtime per
    // PLAN.md section 5, so the vocabulary must stay identical.
    type: v.union(v.literal("pdf"), v.literal("image"), v.literal("svg"), v.literal("source")),
    role: v.union(v.literal("primary"), v.literal("supporting"), v.literal("debug")),
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
  }).index("by_canvas_relPath", ["canvasId", "relPath"]),

  renders: defineTable({
    canvasId: v.id("canvases"),
    entrypoint: v.string(),
    // Matches packages/runtime's RenderFormatSchema (src/types.ts).
    format: v.union(v.literal("png"), v.literal("svg"), v.literal("pdf"), v.literal("html")),
    status: v.union(v.literal("pending"), v.literal("success"), v.literal("error")),
    durationMs: v.optional(v.number()),
    errorText: v.optional(v.string()),
    createdBy: v.id("users"),
  }).index("by_canvas", ["canvasId"]),
});
