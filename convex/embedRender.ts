import { CanvasFileSchema, resolveCanvasPage } from "@visual-canvas/canvas";
import { resolveTheme } from "@visual-canvas/runtime/render/themes/index.js";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { deleteObject, presignObject } from "./lib/objectStore";
import {
  callSnapshotWorker,
  resolveSnapshotSources,
  SNAPSHOT_READINESS_TIMEOUT_MS,
  type SnapshotWorkerResult,
  snapshotThemePayload,
  stageSnapshotEntry,
} from "./lib/snapshotRender";

type EmbedTarget =
  | { type: "canvas" }
  | { type: "node"; nodeId: string }
  | { type: "group"; groupId: string }
  | { type: "stage"; stageId: string }
  | { type: "region"; x: number; y: number; width: number; height: number };

type PublicEmbedContext = {
  canvasId: Id<"canvases">;
  kind: "canvas" | "html" | "image" | "pdf";
  title: string;
  publicSlug: string;
  versionId: Id<"canvasVersions">;
  version: number;
  docStorageId?: Id<"_storage">;
  cssStorageId?: Id<"_storage">;
  entryStorageId?: Id<"_storage">;
  files: Array<{ relPath: string; storageId: Id<"_storage">; size: number }>;
  assets: Array<{ relPath: string; objectKey: string; size: number }>;
  themeId?: "clean-saas" | "minimal-docs" | "dark-terminal" | "startup-pitch";
  canvasBrand?: Parameters<typeof resolveTheme>[2];
  workspaceBrand?: Parameters<typeof resolveTheme>[1];
};

async function render(
  ctx: ActionCtx,
  context: PublicEmbedContext,
  spec: {
    pageId?: string;
    target: EmbedTarget;
    clip: "frame" | "content";
    scale: 1 | 2;
    padding: number;
  },
  objectKey: string,
): Promise<SnapshotWorkerResult> {
  if (context.kind !== "canvas" && context.kind !== "html") {
    throw new Error("unsupported_canvas_kind");
  }
  const sources = await resolveSnapshotSources(ctx, context);
  let entrypoint: string;
  let temporaryEntryStorageId: Id<"_storage"> | undefined;
  try {
    if (context.kind === "canvas") {
      if (!context.docStorageId) throw new Error("published CanvasDoc is unavailable");
      const docBlob = await ctx.storage.get(context.docStorageId);
      if (!docBlob) throw new Error("published CanvasDoc storage object is unavailable");
      const file = CanvasFileSchema.parse(JSON.parse(await docBlob.text()));
      const page = resolveCanvasPage(file, spec.pageId);
      if (spec.pageId && page.id !== spec.pageId) throw new Error("page_not_found");
      const target = spec.target;
      if (target.type === "node") {
        const node = page.doc.nodes.find((candidate) => candidate.id === target.nodeId);
        if (!node) throw new Error("node_not_found");
        if (spec.clip === "content" && node.kind === "native") {
          throw new Error("content_clip_unavailable");
        }
      } else if (
        target.type === "group" &&
        !page.doc.groups.some((group) => group.id === target.groupId)
      ) {
        throw new Error("group_not_found");
      } else if (
        target.type === "stage" &&
        !page.doc.stages.some((stage) => stage.id === target.stageId)
      ) {
        throw new Error("stage_not_found");
      }
      entrypoint = "/src/__embed.html";
      const staged = await stageSnapshotEntry(ctx, {
        doc: page.doc,
        cssStorageId: context.cssStorageId,
        target,
        relPath: entrypoint,
      });
      temporaryEntryStorageId = staged.storageId;
      sources.push(staged.source);
    } else {
      if (spec.pageId || spec.target.type !== "canvas") {
        throw new Error("unsupported_snapshot_target");
      }
      const html = context.files.find((file) => file.relPath.endsWith(".html"));
      if (html) {
        entrypoint = html.relPath;
      } else if (context.entryStorageId) {
        const getUrl = await ctx.storage.getUrl(context.entryStorageId);
        if (!getUrl) throw new Error("published HTML entrypoint is unavailable");
        entrypoint = "/src/index.html";
        sources.push({ relPath: entrypoint, getUrl });
      } else {
        throw new Error("published HTML entrypoint is unavailable");
      }
    }
    const theme = resolveTheme(
      context.themeId ?? "clean-saas",
      context.workspaceBrand,
      context.canvasBrand,
    );
    const result = await callSnapshotWorker({
      sources,
      entrypoint,
      target: spec.target,
      clip: spec.clip,
      padding: spec.padding,
      scale: spec.scale,
      readinessTimeoutMs: SNAPSHOT_READINESS_TIMEOUT_MS,
      upload: { putUrl: await presignObject(objectKey, "PUT", 900), method: "PUT" },
      ...snapshotThemePayload(theme),
    });
    if (result.readiness.status !== "ready") {
      throw new Error(`iframe_not_ready: ${result.readiness.warnings.join("; ")}`);
    }
    return result;
  } finally {
    if (temporaryEntryStorageId) {
      await ctx.storage.delete(temporaryEntryStorageId).catch(() => undefined);
    }
  }
}

export const run = internalAction({
  args: {
    embedId: v.id("canvasEmbeds"),
    generation: v.number(),
    attemptObjectKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const active = await ctx.runMutation(internal.embeds.markUpdating, args);
    if (!active) return null;
    const job = await ctx.runQuery(internal.embeds.getRenderJob, args);
    if (!job?.context) return null;
    const startedAt = Date.now();
    try {
      const result = await render(
        ctx,
        job.context as PublicEmbedContext,
        {
          pageId: job.pageId,
          target: job.target as EmbedTarget,
          clip: job.clip,
          scale: job.scale,
          padding: job.padding,
        },
        args.attemptObjectKey,
      );
      const accepted = await ctx.runMutation(internal.embeds.finishRender, {
        ...args,
        contentHash: result.contentHash,
        size: result.size,
        width: result.width,
        height: result.height,
        downscaled: result.downscaled,
        renderDurationMs: Date.now() - startedAt,
      });
      if (!accepted) {
        await deleteObject(args.attemptObjectKey).catch(() => undefined);
      }
      return null;
    } catch (error) {
      await deleteObject(args.attemptObjectKey).catch(() => undefined);
      throw error;
    }
  },
});
