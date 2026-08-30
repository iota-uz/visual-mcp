import { vOnCompleteArgs } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { findCanvasByRef } from "./lib/canvasRefs";
import { embedRateLimiter } from "./lib/embedRateLimit";
import { renderWorkpool } from "./lib/renderWorkpool";
import { recomputeCanvasStaticRenderState } from "./lib/staticRenderState";
import { ThemeIdValidator, ThemeOverrideValidator } from "./lib/theme";

export const EmbedTargetValidator = v.union(
  v.object({ type: v.literal("canvas") }),
  v.object({ type: v.literal("node"), nodeId: v.string() }),
  v.object({ type: v.literal("group"), groupId: v.string() }),
  v.object({ type: v.literal("stage"), stageId: v.string() }),
  v.object({
    type: v.literal("region"),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  }),
);

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
    status: v.union(
      v.literal("ready"),
      v.literal("queued"),
      v.literal("updating"),
      v.literal("stale"),
      v.literal("error"),
    ),
    errorText: v.optional(v.string()),
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
      !row?.objectKey ||
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
      status: row.status,
      errorText: row.errorText,
    };
  },
});

export const requestPreparation = internalMutation({
  args: {
    publicSlug: v.string(),
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    cacheKey: v.string(),
    pageId: v.optional(v.string()),
    target: EmbedTargetValidator,
    clip: v.union(v.literal("frame"), v.literal("content")),
    scale: v.union(v.literal(1), v.literal(2)),
    padding: v.number(),
    enforceRateLimit: v.boolean(),
  },
  returns: v.object({
    status: v.union(
      v.literal("ready"),
      v.literal("queued"),
      v.literal("updating"),
      v.literal("stale"),
      v.literal("error"),
      v.literal("rate_limited"),
    ),
    retryAfter: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
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
    if (
      existing?.status === "ready" &&
      existing.completedGeneration === existing.desiredGeneration
    ) {
      return { status: "ready" as const };
    }
    if (
      existing?.workId &&
      (existing.status === "queued" ||
        existing.status === "updating" ||
        existing.status === "stale")
    ) {
      return { status: existing.status };
    }
    if (args.enforceRateLimit) {
      const limited = await embedRateLimiter.limit(ctx, "coldEmbedRender", {
        key: args.publicSlug,
      });
      if (!limited.ok) {
        return { status: "rate_limited" as const, retryAfter: limited.retryAfter };
      }
    }

    const generation = existing?.desiredGeneration ?? 1;
    const attemptObjectKey = `embeds/${args.canvasId}/v${version.version}/${args.cacheKey}/g${generation}-${now}.png`;
    const embedId = existing
      ? existing._id
      : await ctx.db.insert("canvasEmbeds", {
          canvasId: args.canvasId,
          versionId: args.versionId,
          cacheKey: args.cacheKey,
          pageId: args.pageId,
          target: args.target,
          clip: args.clip,
          scale: args.scale,
          padding: args.padding,
          status: "queued",
          desiredGeneration: generation,
          attemptObjectKey,
          createdAt: now,
          updatedAt: now,
        });
    if (existing) {
      await ctx.db.patch(existing._id, {
        pageId: args.pageId,
        target: args.target,
        clip: args.clip,
        scale: args.scale,
        padding: args.padding,
        status: existing.objectKey ? "stale" : "queued",
        attemptObjectKey,
        errorText: undefined,
        updatedAt: now,
      });
    }
    const workId = await renderWorkpool.enqueueAction(
      ctx,
      internal.embedRender.run,
      { embedId, generation, attemptObjectKey },
      {
        onComplete: internal.embeds.renderCompleted,
        context: { embedId, generation, attemptObjectKey },
      },
    );
    await ctx.db.patch(embedId, {
      workId,
      status: existing?.objectKey ? "stale" : "queued",
      updatedAt: now,
    });
    await recomputeCanvasStaticRenderState(ctx, args.canvasId);
    return { status: existing?.objectKey ? ("stale" as const) : ("queued" as const) };
  },
});

export const markUpdating = internalMutation({
  args: {
    embedId: v.id("canvasEmbeds"),
    generation: v.number(),
    attemptObjectKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.embedId);
    if (
      !row ||
      row.desiredGeneration !== args.generation ||
      row.attemptObjectKey !== args.attemptObjectKey
    ) {
      return false;
    }
    await ctx.db.patch(row._id, {
      status: "updating",
      renderStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recomputeCanvasStaticRenderState(ctx, row.canvasId);
    return true;
  },
});

export const getRenderJob = internalQuery({
  args: { embedId: v.id("canvasEmbeds"), generation: v.number(), attemptObjectKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      context: PublicEmbedContextValidator,
      pageId: v.optional(v.string()),
      target: EmbedTargetValidator,
      clip: v.union(v.literal("frame"), v.literal("content")),
      scale: v.union(v.literal(1), v.literal(2)),
      padding: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.embedId);
    if (
      !row ||
      row.desiredGeneration !== args.generation ||
      row.attemptObjectKey !== args.attemptObjectKey
    ) {
      return null;
    }
    const canvas = await ctx.db.get(row.canvasId);
    const version = await ctx.db.get(row.versionId);
    if (!canvas || !version) return null;
    const context = await contextForCanvas(ctx, canvas, version.version);
    if (!context) return null;
    return {
      context,
      pageId: row.pageId,
      target: row.target,
      clip: row.clip,
      scale: row.scale,
      padding: row.padding,
    };
  },
});

export const finishRender = internalMutation({
  args: {
    embedId: v.id("canvasEmbeds"),
    generation: v.number(),
    attemptObjectKey: v.string(),
    contentHash: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    downscaled: v.boolean(),
    renderDurationMs: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.embedId);
    if (
      !row ||
      row.desiredGeneration !== args.generation ||
      row.attemptObjectKey !== args.attemptObjectKey
    )
      return false;
    await ctx.db.patch(row._id, {
      status: "ready",
      objectKey: args.attemptObjectKey,
      contentHash: args.contentHash,
      size: args.size,
      width: args.width,
      height: args.height,
      downscaled: args.downscaled,
      renderDurationMs: args.renderDurationMs,
      completedGeneration: args.generation,
      attemptObjectKey: undefined,
      workId: undefined,
      errorText: undefined,
      updatedAt: Date.now(),
    });
    await recomputeCanvasStaticRenderState(ctx, row.canvasId);
    return true;
  },
});

const RenderCompletionContextValidator = v.object({
  embedId: v.id("canvasEmbeds"),
  generation: v.number(),
  attemptObjectKey: v.string(),
});

export const renderCompleted = internalMutation({
  args: vOnCompleteArgs(RenderCompletionContextValidator),
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.context.embedId);
    if (!row) return null;

    // Coalesce any number of publishes that happened while this render was
    // running into exactly one follow-up for the newest desired generation.
    if (row.desiredGeneration > args.context.generation) {
      const generation = row.desiredGeneration;
      const attemptObjectKey = `embeds/${row.canvasId}/coalesced/g${generation}-${Date.now()}-${row._id}.png`;
      const workId = await renderWorkpool.enqueueAction(
        ctx,
        internal.embedRender.run,
        { embedId: row._id, generation, attemptObjectKey },
        {
          onComplete: internal.embeds.renderCompleted,
          context: { embedId: row._id, generation, attemptObjectKey },
        },
      );
      await ctx.db.patch(row._id, {
        status: row.objectKey ? "stale" : "queued",
        attemptObjectKey,
        workId,
        errorText: undefined,
        updatedAt: Date.now(),
      });
      await recomputeCanvasStaticRenderState(ctx, row.canvasId);
      return null;
    }
    if (args.result.kind === "success") return null;
    if (
      row.desiredGeneration !== args.context.generation ||
      row.attemptObjectKey !== args.context.attemptObjectKey
    )
      return null;
    await ctx.db.patch(row._id, {
      status: "error",
      errorText:
        args.result.kind === "failed" ? args.result.error.slice(0, 2_000) : "Render canceled",
      attemptObjectKey: undefined,
      workId: undefined,
      updatedAt: Date.now(),
    });
    await recomputeCanvasStaticRenderState(ctx, row.canvasId);
    return null;
  },
});
