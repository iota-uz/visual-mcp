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

// The app owns user creation through auth.ts's createOrUpdateUser callback.
// Auth support tables still use this row id for sessions and accounts.
const { users: _authUsers, ...authSupportTables } = authTables;

export default defineSchema({
  ...authSupportTables,

  users: defineTable({
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

  assets: defineTable({
    scope: v.union(v.literal("personal"), v.literal("workspace")),
    ownerUserId: v.optional(v.id("users")),
    workspaceId: v.optional(v.id("workspaces")),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    kind: v.union(
      v.literal("image"),
      v.literal("svg"),
      v.literal("font"),
      v.literal("video"),
      v.literal("data"),
    ),
    searchText: v.string(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_owner_updated", ["ownerUserId", "updatedAt"])
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .index("by_owner_slug", ["ownerUserId", "slug"])
    .index("by_workspace_slug", ["workspaceId", "slug"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["scope", "ownerUserId", "workspaceId", "kind"],
    }),

  assetVersions: defineTable({
    assetId: v.id("assets"),
    revision: v.number(),
    sourceObjectKey: v.string(),
    deliveryObjectKey: v.string(),
    previewObjectKey: v.string(),
    contentHash: v.string(),
    mimeType: v.string(),
    size: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    originalFilename: v.string(),
    sourceType: v.union(v.literal("upload"), v.literal("url"), v.literal("canvas-import")),
    sourceUrl: v.optional(v.string()),
    createdBy: v.id("users"),
  })
    .index("by_asset_revision", ["assetId", "revision"])
    .index("by_content_hash", ["contentHash"]),

  assetUploads: defineTable({
    scope: v.union(v.literal("personal"), v.literal("workspace")),
    ownerUserId: v.optional(v.id("users")),
    workspaceId: v.optional(v.id("workspaces")),
    sourceObjectKey: v.string(),
    filename: v.string(),
    declaredMimeType: v.string(),
    expectedSize: v.optional(v.number()),
    expectedHash: v.optional(v.string()),
    createdBy: v.id("users"),
    expiresAt: v.number(),
  }).index("by_creator", ["createdBy"]),

  canvasAssetBindings: defineTable({
    canvasId: v.id("canvases"),
    logicalPath: v.string(),
    assetId: v.id("assets"),
    assetVersionId: v.id("assetVersions"),
  })
    .index("by_canvas_path", ["canvasId", "logicalPath"])
    .index("by_asset", ["assetId"]),

  canvasVersionAssets: defineTable({
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    logicalPath: v.string(),
    assetId: v.id("assets"),
    assetVersionId: v.id("assetVersions"),
  })
    .index("by_version_path", ["versionId", "logicalPath"])
    .index("by_asset", ["assetId"])
    .index("by_canvas", ["canvasId"]),

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
    // Durable mutable head. `currentVersionId` remains the latest immutable
    // checkpoint; draftRevision is the optimistic concurrency token for
    // autosaves and MCP edits between checkpoints.
    draftRevision: v.number(),
    draftEditCount: v.number(),
    draftUpdatedAt: v.number(),
    draftDocStorageId: v.optional(v.id("_storage")),
    draftDocContentHash: v.optional(v.string()),
    draftCssStorageId: v.optional(v.id("_storage")),
    draftEntryStorageId: v.optional(v.id("_storage")),
    draftIframeEntrypoints: v.array(v.string()),
    currentVersionId: v.optional(v.id("canvasVersions")),
    // Public readers are pinned to the checkpoint selected by Publish and do
    // not observe later draft changes or unrelated checkpoints.
    publishedVersionId: v.optional(v.id("canvasVersions")),
    thumbnailId: v.optional(v.id("_storage")),
    // Running total of live storage blobs this canvas has ever caused to be
    // stored (artifacts + canvasFiles writes), minus what sweepCacheTtl has
    // actually deleted. Backs the quota in canvases.ts — see that file's
    // comment above CANVAS_STORAGE_QUOTA_BYTES for why this must be a
    // monotonic counter rather than a point-in-time table scan.
    storageBytesUsed: v.number(),
    createdBy: v.id("users"),
    // Soft-delete tombstone, mirroring workspaces.archivedAt. Archived
    // canvases stay out of listings and searches but keep their blobs and
    // version history, so an accidental delete is recoverable; a hard purge
    // deletes the row outright.
    archivedAt: v.optional(v.number()),
    // Bumped on durable draft and checkpoint changes — backs
    // by_workspace_updated so the gallery can sort by authoring recency.
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
    docContentHash: v.optional(v.string()),
    cssStorageId: v.optional(v.id("_storage")),
    entryStorageId: v.optional(v.id("_storage")),
    iframeEntrypoints: v.array(v.string()),
  }).index("by_canvas_version", ["canvasId", "version"]),

  // Immutable source manifest for a CanvasDoc version. Current canvasFiles
  // may move on; iframe URLs always resolve through this snapshot.
  canvasVersionFiles: defineTable({
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    relPath: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    contentHash: v.string(),
  })
    .index("by_version_relPath", ["versionId", "relPath"])
    .index("by_canvas", ["canvasId"]),

  // Ephemeral, immutable-version screenshots returned inline by canvas_snapshot.
  // They are deliberately separate from artifacts/renders and expire after 24h.
  canvasSnapshots: defineTable({
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    cacheKey: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.literal("image/png"),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    status: v.union(v.literal("ok"), v.literal("partial")),
    warnings: v.array(v.string()),
    diagnostics: v.object({
      unresolvedRefs: v.array(v.string()),
      unresolvedDetails: v.array(
        v.object({
          ref: v.string(),
          resourceType: v.string(),
          reason: v.string(),
          error: v.optional(v.string()),
        }),
      ),
      readinessStatus: v.union(v.literal("ready"), v.literal("partial")),
      readinessWarnings: v.array(v.string()),
      attempts: v.number(),
    }),
    createdAt: v.number(),
  })
    .index("by_version_cacheKey", ["versionId", "cacheKey"])
    .index("by_canvas", ["canvasId"])
    .index("by_createdAt", ["createdAt"]),

  iframeCapabilities: defineTable({
    token: v.string(),
    canvasId: v.id("canvases"),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // One small document per canvas node — what makes `#node=` resolution and
  // full-text search index lookups instead of full-document scans (PLAN.md
  // section 4).
  canvasNodes: defineTable({
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    pageId: v.string(),
    nodeId: v.string(),
    title: v.string(),
    eyebrow: v.optional(v.string()),
    searchText: v.string(),
  })
    .index("by_version", ["versionId"])
    .index("by_versionId_and_nodeId", ["versionId", "nodeId"])
    // Needed to enumerate a canvas's nodes without walking its versions —
    // deleting a canvas has to remove them, and the search index can filter
    // by canvasId but cannot enumerate by it.
    .index("by_canvas", ["canvasId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["canvasId"] }),

  canvasDraftNodes: defineTable({
    canvasId: v.id("canvases"),
    pageId: v.string(),
    nodeId: v.string(),
    title: v.string(),
    eyebrow: v.optional(v.string()),
    searchText: v.string(),
  })
    .index("by_canvas", ["canvasId"])
    .index("by_canvas_page_node", ["canvasId", "pageId", "nodeId"])
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
    status: v.union(
      v.literal("pending"),
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
    ),
    durationMs: v.optional(v.number()),
    errorText: v.optional(v.string()),
    createdBy: v.id("users"),
  }).index("by_canvas", ["canvasId"]),
});
