import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { findCanvasByRef } from "./lib/canvasRefs";
import { embedRateLimiter } from "./lib/embedRateLimit";
import { ThemeIdValidator, ThemeOverrideValidator } from "./lib/theme";

const PublicEmbedContextValidator = v.union(
  v.null(),
  v.object({
    canvasId: v.id("canvases"),
    kind: v.union(v.literal("canvas"), v.literal("html"), v.literal("image"), v.literal("pdf")),
    title: v.string(),
    publicSlug: v.string(),
    versionId: v.id("canvasVersions"),
    version: v.number(),
    latestPublishedVersion: v.number(),
    draftRevision: v.number(),
    unpublishedChanges: v.boolean(),
    docStorageId: v.optional(v.id("_storage")),
    cssStorageId: v.optional(v.id("_storage")),
    entryStorageId: v.optional(v.id("_storage")),
    files: v.array(
      v.object({ relPath: v.string(), storageId: v.id("_storage"), size: v.number() }),
    ),
    assets: v.array(v.object({ relPath: v.string(), objectKey: v.string(), size: v.number() })),
    themeId: v.optional(ThemeIdValidator),
    canvasBrand: v.optional(ThemeOverrideValidator),
    workspaceBrand: v.optional(ThemeOverrideValidator),
  }),
);

async function contextForCanvas(
  ctx: Parameters<typeof findCanvasByRef>[0],
  canvas: NonNullable<Awaited<ReturnType<typeof findCanvasByRef>>>,
  requestedVersion?: number,
) {
  if (
    canvas.visibility !== "public" ||
    !canvas.publicSlug ||
    !canvas.publishedVersionId ||
    canvas.archivedAt !== undefined
  ) {
    return null;
  }
  const latest = await ctx.db.get(canvas.publishedVersionId);
  if (!latest) return null;
  const selected =
    requestedVersion === undefined
      ? latest
      : await ctx.db
          .query("canvasVersions")
          .withIndex("by_canvas_version", (q) =>
            q.eq("canvasId", canvas._id).eq("version", requestedVersion),
          )
          .unique();
  if (
    !selected ||
    selected.version > latest.version ||
    (selected._id !== latest._id && selected.publishedAt === undefined)
  ) {
    return null;
  }
  const [files, bindings, workspace] = await Promise.all([
    ctx.db
      .query("canvasVersionFiles")
      .withIndex("by_version_relPath", (q) => q.eq("versionId", selected._id))
      .take(500),
    ctx.db
      .query("canvasVersionAssets")
      .withIndex("by_version_path", (q) => q.eq("versionId", selected._id))
      .take(500),
    ctx.db.get(canvas.workspaceId),
  ]);
  const assets = [];
  for (const binding of bindings) {
    const asset = await ctx.db.get(binding.assetVersionId);
    if (asset) {
      assets.push({ relPath: binding.logicalPath, objectKey: asset.objectKey, size: asset.size });
    }
  }
  return {
    canvasId: canvas._id,
    kind: canvas.kind,
    title: canvas.title,
    publicSlug: canvas.publicSlug,
    versionId: selected._id,
    version: selected.version,
    latestPublishedVersion: latest.version,
    draftRevision: canvas.draftRevision,
    unpublishedChanges: canvas.draftEditCount > 0,
    docStorageId: selected.docStorageId,
    cssStorageId: selected.cssStorageId,
    entryStorageId: selected.entryStorageId,
    files: files.map((file) => ({
      relPath: file.relPath,
      storageId: file.storageId,
      size: file.size,
    })),
    assets,
    themeId: canvas.themeId,
    canvasBrand: canvas.brand,
    workspaceBrand: workspace?.brand,
  };
}

export const resolvePublicContext = internalQuery({
  args: { publicSlug: v.string(), version: v.optional(v.number()) },
  returns: PublicEmbedContextValidator,
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvases")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.publicSlug))
      .unique();
    return canvas ? contextForCanvas(ctx, canvas, args.version) : null;
  },
});

export const resolveContextByRef = internalQuery({
  args: { ref: v.string(), version: v.optional(v.number()) },
  returns: PublicEmbedContextValidator,
  handler: async (ctx, args) => {
    const canvas = await findCanvasByRef(ctx, args.ref);
    return canvas ? contextForCanvas(ctx, canvas, args.version) : null;
  },
});

const ReadyEmbedValidator = v.union(
  v.null(),
  v.object({
    objectKey: v.string(),
    contentHash: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    downscaled: v.boolean(),
    renderDurationMs: v.number(),
  }),
);

export const getReady = internalQuery({
  args: {
    publicSlug: v.string(),
    versionId: v.id("canvasVersions"),
    cacheKey: v.string(),
  },
  returns: ReadyEmbedValidator,
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvases")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.publicSlug))
      .unique();
    if (
      canvas?.visibility !== "public" ||
      !canvas.publishedVersionId ||
      canvas.archivedAt !== undefined
    ) {
      return null;
    }
    const version = await ctx.db.get(args.versionId);
    const latest = await ctx.db.get(canvas.publishedVersionId);
    if (
      !version ||
      version.canvasId !== canvas._id ||
      !latest ||
      version.version > latest.version ||
      (version._id !== latest._id && version.publishedAt === undefined)
    ) {
      return null;
    }
    const row = await ctx.db
      .query("canvasEmbeds")
      .withIndex("by_version_cacheKey", (q) =>
        q.eq("versionId", args.versionId).eq("cacheKey", args.cacheKey),
      )
      .unique();
    if (
      row?.status !== "ready" ||
      !row.objectKey ||
      !row.contentHash ||
      row.size === undefined ||
      row.width === undefined ||
      row.height === undefined
    ) {
      return null;
    }
    return {
      objectKey: row.objectKey,
      contentHash: row.contentHash,
      size: row.size,
      width: row.width,
      height: row.height,
      downscaled: row.downscaled ?? false,
      renderDurationMs: row.renderDurationMs ?? 0,
    };
  },
});

export const claimColdRender = internalMutation({
  args: {
    publicSlug: v.string(),
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    cacheKey: v.string(),
    objectKey: v.string(),
    now: v.number(),
    force: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(v.literal("claimed"), v.literal("pending"), v.literal("rate_limited")),
    retryAfter: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    const version = await ctx.db.get(args.versionId);
    const latest = canvas?.publishedVersionId ? await ctx.db.get(canvas.publishedVersionId) : null;
    if (
      !canvas ||
      canvas.publicSlug !== args.publicSlug ||
      canvas.visibility !== "public" ||
      canvas.archivedAt !== undefined ||
      !version ||
      version.canvasId !== canvas._id ||
      !latest ||
      version.version > latest.version ||
      (version._id !== latest._id && version.publishedAt === undefined)
    ) {
      throw new Error("embed_not_found");
    }
    const existing = await ctx.db
      .query("canvasEmbeds")
      .withIndex("by_version_cacheKey", (q) =>
        q.eq("versionId", args.versionId).eq("cacheKey", args.cacheKey),
      )
      .unique();
    if (!args.force && existing?.status === "ready") return { status: "pending" as const };
    if (
      !args.force &&
      existing?.status === "pending" &&
      existing.renderStartedAt > args.now - 30_000
    ) {
      return { status: "pending" as const };
    }
    const limited = await embedRateLimiter.limit(ctx, "coldEmbedRender", {
      key: args.publicSlug,
    });
    if (!limited.ok) {
      return { status: "rate_limited" as const, retryAfter: limited.retryAfter };
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "pending",
        objectKey: args.objectKey,
        contentHash: undefined,
        size: undefined,
        width: undefined,
        height: undefined,
        downscaled: undefined,
        renderStartedAt: args.now,
        renderDurationMs: undefined,
      });
    } else {
      await ctx.db.insert("canvasEmbeds", {
        canvasId: args.canvasId,
        versionId: args.versionId,
        cacheKey: args.cacheKey,
        status: "pending",
        objectKey: args.objectKey,
        renderStartedAt: args.now,
        createdAt: args.now,
      });
    }
    return { status: "claimed" as const };
  },
});

export const finishColdRender = internalMutation({
  args: {
    versionId: v.id("canvasVersions"),
    cacheKey: v.string(),
    objectKey: v.string(),
    contentHash: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    downscaled: v.boolean(),
    renderDurationMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvasEmbeds")
      .withIndex("by_version_cacheKey", (q) =>
        q.eq("versionId", args.versionId).eq("cacheKey", args.cacheKey),
      )
      .unique();
    if (!row || row.objectKey !== args.objectKey) return null;
    await ctx.db.patch(row._id, {
      status: "ready",
      contentHash: args.contentHash,
      size: args.size,
      width: args.width,
      height: args.height,
      downscaled: args.downscaled,
      renderDurationMs: args.renderDurationMs,
    });
    return null;
  },
});

export const abandonColdRender = internalMutation({
  args: { versionId: v.id("canvasVersions"), cacheKey: v.string(), objectKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvasEmbeds")
      .withIndex("by_version_cacheKey", (q) =>
        q.eq("versionId", args.versionId).eq("cacheKey", args.cacheKey),
      )
      .unique();
    if (row?.status === "pending" && row.objectKey === args.objectKey) await ctx.db.delete(row._id);
    return null;
  },
});
