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

import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// `users` is deliberately NOT taken from `authTables`: this app had one
// first, keyed by `googleSub`, and every workspace, canvas and MCP token
// points at those ids. ../auth.ts's `createOrUpdateUser` owns all writes to
// it, so Convex Auth never inserts a row of its own — it links its
// `authAccounts` row to the row that was already there. The optional fields
// below are the auth table's own; they are declared so a future library
// write can't fail schema validation, and the `email`/`phone` indexes are
// the names the library looks up by.
const { users: _authUsers, ...authSupportTables } = authTables;

export default defineSchema({
  ...authSupportTables,

  users: defineTable({
    googleSub: v.string(),
    email: v.string(),
    name: v.string(),
    pictureUrl: v.optional(v.string()),
    lastSeenAt: v.number(),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
  })
    .index("by_googleSub", ["googleSub"])
    // Named `email`, not `by_email`: Convex rejects two indexes over the
    // same field, and `email`/`phone` are the names the auth library looks
    // up by. Nothing in this repo queried the old `by_email` index.
    .index("email", ["email"])
    .index("phone", ["phone"]),

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
    // Running total of live storage blobs this canvas has ever caused to be
    // stored (artifacts + canvasFiles writes), minus what sweepCacheTtl has
    // actually deleted. Backs the quota in canvases.ts — see that file's
    // comment above CANVAS_STORAGE_QUOTA_BYTES for why this must be a
    // monotonic counter rather than a point-in-time table scan. Optional so
    // pre-existing rows (undefined ⇒ treated as 0) don't need a migration.
    storageBytesUsed: v.optional(v.number()),
    createdBy: v.id("users"),
    // Soft-delete tombstone, mirroring workspaces.archivedAt. Archived
    // canvases stay out of listings and searches but keep their blobs and
    // version history, so an accidental delete is recoverable; a hard purge
    // deletes the row outright.
    archivedAt: v.optional(v.number()),
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
    // Needed to enumerate a canvas's nodes without walking its versions —
    // deleting a canvas has to remove them, and the search index can filter
    // by canvasId but cannot enumerate by it.
    .index("by_canvas", ["canvasId"])
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
    role: v.union(v.literal("primary"), v.literal("supporting")),
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
