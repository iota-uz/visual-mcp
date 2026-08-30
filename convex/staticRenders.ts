import { vOnCompleteArgs } from "@convex-dev/workpool";
import {
  compileThemeToCssVariables,
  compileThemeToTailwindV4,
  resolveTheme,
} from "@visual-canvas/runtime/render/themes/index.js";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { presignObject } from "./lib/objectStore";
import { renderWorkpool } from "./lib/renderWorkpool";
import { recomputeCanvasStaticRenderState } from "./lib/staticRenderState";

const RecipeContextValidator = v.union(
  v.null(),
  v.object({
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    createdBy: v.id("users"),
    entrypoint: v.string(),
    route: v.optional(v.string()),
    outputPath: v.string(),
    format: v.union(v.literal("png"), v.literal("svg"), v.literal("pdf"), v.literal("html")),
    primary: v.boolean(),
    viewport: v.optional(
      v.object({
        width: v.number(),
        height: v.number(),
        deviceScaleFactor: v.optional(v.number()),
      }),
    ),
    pdf: v.optional(v.any()),
    files: v.array(v.object({ relPath: v.string(), storageId: v.id("_storage") })),
    assets: v.array(v.object({ relPath: v.string(), objectKey: v.string() })),
    themeId: v.optional(v.string()),
    workspaceBrand: v.optional(v.any()),
    canvasBrand: v.optional(v.any()),
  }),
);

export const getContext = internalQuery({
  args: { recipeId: v.id("canvasRenderRecipes"), generation: v.number() },
  returns: RecipeContextValidator,
  handler: async (ctx, args) => {
    const recipe = await ctx.db.get(args.recipeId);
    if (!recipe || recipe.desiredGeneration !== args.generation) return null;
    const canvas = await ctx.db.get(recipe.canvasId);
    const version = await ctx.db.get(recipe.versionId);
    if (
      !canvas ||
      !version ||
      canvas.visibility !== "public" ||
      canvas.publishedVersionId !== version._id ||
      canvas.archivedAt !== undefined
    )
      return null;
    const [files, bindings, workspace] = await Promise.all([
      ctx.db
        .query("canvasVersionFiles")
        .withIndex("by_version_relPath", (q) => q.eq("versionId", version._id))
        .take(500),
      ctx.db
        .query("canvasVersionAssets")
        .withIndex("by_version_path", (q) => q.eq("versionId", version._id))
        .take(500),
      ctx.db.get(canvas.workspaceId),
    ]);
    const assets = [];
    for (const binding of bindings) {
      const asset = await ctx.db.get(binding.assetVersionId);
      if (asset) assets.push({ relPath: binding.logicalPath, objectKey: asset.objectKey });
    }
    return {
      canvasId: canvas._id,
      versionId: version._id,
      createdBy: canvas.createdBy,
      entrypoint: recipe.entrypoint,
      route: recipe.route,
      outputPath: recipe.outputPath,
      format: recipe.format,
      primary: recipe.primary,
      viewport: recipe.viewport,
      pdf: recipe.pdf,
      files: files.map((file) => ({ relPath: file.relPath, storageId: file.storageId })),
      assets,
      themeId: canvas.themeId,
      workspaceBrand: workspace?.brand,
      canvasBrand: canvas.brand,
    };
  },
});

export const markUpdating = internalMutation({
  args: { recipeId: v.id("canvasRenderRecipes"), generation: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const recipe = await ctx.db.get(args.recipeId);
    if (!recipe || recipe.desiredGeneration !== args.generation) return false;
    await ctx.db.patch(recipe._id, { status: "updating", updatedAt: Date.now() });
    await recomputeCanvasStaticRenderState(ctx, recipe.canvasId);
    return true;
  },
});

export const finish = internalMutation({
  args: {
    recipeId: v.id("canvasRenderRecipes"),
    generation: v.number(),
    storageId: v.id("_storage"),
    thumbnailStorageId: v.optional(v.id("_storage")),
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const recipe = await ctx.db.get(args.recipeId);
    if (!recipe || recipe.desiredGeneration !== args.generation) return false;
    await ctx.db.patch(recipe._id, {
      status: "ready",
      completedGeneration: args.generation,
      workId: undefined,
      errorText: undefined,
      updatedAt: Date.now(),
    });
    await recomputeCanvasStaticRenderState(ctx, recipe.canvasId);
    return true;
  },
});

function storageIdFromUpload(value: unknown): Id<"_storage"> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("storageId" in value) ||
    typeof value.storageId !== "string"
  ) {
    throw new Error("worker upload response did not contain storageId");
  }
  return value.storageId as Id<"_storage">;
}

export const run = internalAction({
  args: { recipeId: v.id("canvasRenderRecipes"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await ctx.runMutation(internal.staticRenders.markUpdating, args))) return null;
    const context = await ctx.runQuery(internal.staticRenders.getContext, args);
    if (!context) return null;
    const rawUrl = process.env.WORKER_URL;
    const token = process.env.WORKER_TOKEN;
    if (!rawUrl || !token) throw new Error("render worker is not configured");
    const origin = rawUrl.includes("://") ? rawUrl : `http://${rawUrl}:8080`;
    const resolvedFiles = await Promise.all(
      context.files.map(async (file) => {
        const getUrl = await ctx.storage.getUrl(file.storageId);
        return getUrl ? { relPath: file.relPath, getUrl } : null;
      }),
    );
    const sources = [
      ...resolvedFiles.filter(
        (source): source is { relPath: string; getUrl: string } => source !== null,
      ),
      ...(await Promise.all(
        context.assets.map(async (asset) => ({
          relPath: asset.relPath,
          getUrl: await presignObject(asset.objectKey, "GET", 3_600),
        })),
      )),
    ];
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const thumbnailUploadUrl =
      context.format === "png" ? await ctx.storage.generateUploadUrl() : undefined;
    const theme = resolveTheme(
      (context.themeId ?? "clean-saas") as Parameters<typeof resolveTheme>[0],
      context.workspaceBrand,
      context.canvasBrand,
    );
    const response = await fetch(`${origin.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sources,
        entrypoint: context.entrypoint,
        route: context.route,
        outputPath: context.outputPath,
        format: context.format,
        viewport: context.viewport,
        pdf: context.pdf,
        upload: { putUrl: uploadUrl },
        thumbnailUpload: thumbnailUploadUrl ? { putUrl: thumbnailUploadUrl } : undefined,
        themeTailwindCss: compileThemeToTailwindV4(theme),
        themeRuntimeCss: compileThemeToCssVariables(theme),
        themeJson: JSON.stringify(theme),
      }),
    });
    const result = (await response.json().catch(() => null)) as {
      relPath: string;
      size: number;
      mimeType: string;
      uploadStatus: number;
      uploadBody: unknown;
      thumbnail?: { uploadStatus: number; uploadBody: unknown };
      readiness?: { status: "ready" | "partial"; warnings: string[] };
    } | null;
    if (!response.ok || !result || result.uploadStatus < 200 || result.uploadStatus >= 300) {
      throw new Error(`background render failed (${response.status})`);
    }
    if (result.readiness?.status === "partial") {
      throw new Error(`background render incomplete: ${result.readiness.warnings.join("; ")}`);
    }
    const storageId = storageIdFromUpload(result.uploadBody);
    const thumbnailStorageId = result.thumbnail
      ? storageIdFromUpload(result.thumbnail.uploadBody)
      : undefined;
    try {
      await ctx.runMutation(internal.canvases.attachCanvasRender, {
        canvasId: context.canvasId,
        versionId: context.versionId,
        relPath: result.relPath,
        type: context.format === "pdf" ? "pdf" : context.format === "png" ? "image" : "source",
        mimeType: result.mimeType,
        size: result.size,
        storageId,
        thumbnailStorageId,
        primary: context.primary,
        recipeId: args.recipeId,
        recipeGeneration: args.generation,
      });
      const accepted = await ctx.runMutation(internal.staticRenders.finish, {
        ...args,
        storageId,
        thumbnailStorageId,
        mimeType: result.mimeType,
        size: result.size,
      });
      if (!accepted) throw new Error("background render was superseded");
    } catch (error) {
      await ctx.storage.delete(storageId).catch(() => undefined);
      if (thumbnailStorageId) await ctx.storage.delete(thumbnailStorageId).catch(() => undefined);
      throw error;
    }
    return null;
  },
});

const CompletionContextValidator = v.object({
  recipeId: v.id("canvasRenderRecipes"),
  generation: v.number(),
});

export const completed = internalMutation({
  args: vOnCompleteArgs(CompletionContextValidator),
  returns: v.null(),
  handler: async (ctx, args) => {
    const recipe = await ctx.db.get(args.context.recipeId);
    if (!recipe) return null;
    if (recipe.desiredGeneration > args.context.generation) {
      const generation = recipe.desiredGeneration;
      const workId = await renderWorkpool.enqueueAction(
        ctx,
        internal.staticRenders.run,
        { recipeId: recipe._id, generation },
        {
          onComplete: internal.staticRenders.completed,
          context: { recipeId: recipe._id, generation },
        },
      );
      await ctx.db.patch(recipe._id, {
        status: "stale",
        workId,
        errorText: undefined,
        updatedAt: Date.now(),
      });
      await recomputeCanvasStaticRenderState(ctx, recipe.canvasId);
      return null;
    }
    if (args.result.kind === "success") return null;
    if (recipe.desiredGeneration !== args.context.generation) return null;
    const error = args.result.kind === "failed" ? args.result.error : "Render canceled";
    await ctx.db.patch(recipe._id, {
      status: "error",
      workId: undefined,
      errorText: error.slice(0, 2_000),
      updatedAt: Date.now(),
    });
    await recomputeCanvasStaticRenderState(ctx, recipe.canvasId);
    return null;
  },
});
