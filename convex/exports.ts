/**
 * Browser exports: the Download action on a node and the header Export menu.
 *
 * The picture comes from the same render worker and the same target-aware
 * entry page `canvas_snapshot` and public embeds use — the browser never
 * rasterises anything itself, so an export looks like the server-rendered
 * share card rather than like whatever the viewer's zoom level happened to
 * be. It renders the *draft* the signed-in editor is looking at, and caches
 * per draft revision so an unchanged canvas is not re-rendered on every
 * click (adr/platform/browser-export-via-snapshot-worker).
 */

import type { CanvasSnapshotTarget } from "@visual-canvas/canvas/snapshot-entry.js";
import type { CanvasFile } from "@visual-canvas/canvas/types.js";
import { CanvasFileSchema, resolveCanvasPage } from "@visual-canvas/canvas/types.js";
import { resolveTheme } from "@visual-canvas/runtime/render/themes/index.js";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireIotaIdentity } from "./lib/auth";
import { sha256Hex } from "./lib/hash";
import {
  callSnapshotWorker,
  resolveSnapshotSources,
  SNAPSHOT_READINESS_TIMEOUT_MS,
  snapshotThemePayload,
  snapshotWarnings,
  snapshotWorkerOrigin,
  stageSnapshotEntry,
} from "./lib/snapshotRender";

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
const MIME_TYPES = { png: "image/png", pdf: "application/pdf" } as const;

const ExportResultValidator = v.object({
  status: v.union(v.literal("ok"), v.literal("partial")),
  url: v.string(),
  filename: v.string(),
  mimeType: v.union(v.literal("image/png"), v.literal("application/pdf")),
  warnings: v.array(v.string()),
  cached: v.boolean(),
});
export type ExportResult = {
  status: "ok" | "partial";
  url: string;
  filename: string;
  mimeType: "image/png" | "application/pdf";
  warnings: string[];
  cached: boolean;
};

/** Everything the action needs about the draft, read in one transaction. */
export const contextMine = internalQuery({
  args: { canvasId: v.id("canvases"), subject: v.string() },
  handler: async (ctx, args) => {
    const [authUserId, sessionId] = args.subject.split("|");
    const userId = authUserId && sessionId ? ctx.db.normalizeId("users", authUserId) : null;
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user) throw new Error("Signed-in user record not found");
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas || canvas.archivedAt !== undefined) throw new Error("Canvas not found");
    if (canvas.kind !== "canvas") throw new Error("Only canvas-kind canvases can be exported");
    if (!canvas.draftDocStorageId) throw new Error("Canvas has no CanvasFile");
    const workspace = await ctx.db.get(canvas.workspaceId);
    if (!workspace) throw new Error(`Canvas ${canvas._id} points at a missing workspace`);
    const [files, bindings] = await Promise.all([
      ctx.db
        .query("canvasFiles")
        .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
        .take(500),
      ctx.db
        .query("canvasAssetBindings")
        .withIndex("by_canvas_path", (q) => q.eq("canvasId", canvas._id))
        .take(500),
    ]);
    const assets: Array<{ relPath: string; objectKey: string }> = [];
    for (const binding of bindings) {
      const assetVersion = await ctx.db.get(binding.assetVersionId);
      if (assetVersion)
        assets.push({ relPath: binding.logicalPath, objectKey: assetVersion.objectKey });
    }
    return {
      slug: canvas.slug,
      draftRevision: canvas.draftRevision,
      docStorageId: canvas.draftDocStorageId,
      cssStorageId: canvas.draftCssStorageId,
      files: files
        .filter((file) => file.relPath !== "/src/__canvas.html")
        .map((file) => ({ relPath: file.relPath, storageId: file.storageId })),
      assets,
      theme: resolveTheme(canvas.themeId ?? "clean-saas", workspace.brand, canvas.brand),
    };
  },
});

export const cached = internalQuery({
  args: { canvasId: v.id("canvases"), cacheKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvasExports")
      .withIndex("by_canvas_cacheKey", (q) =>
        q.eq("canvasId", args.canvasId).eq("cacheKey", args.cacheKey),
      )
      .order("desc")
      .first();
    if (!row || row.createdAt <= args.now - EXPORT_TTL_MS) return null;
    const url = await ctx.storage.getUrl(row.storageId);
    if (!url) return null;
    return { url, filename: row.filename, mimeType: row.mimeType };
  },
});

export const remember = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    draftRevision: v.number(),
    cacheKey: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.union(v.literal("image/png"), v.literal("application/pdf")),
    size: v.number(),
    filename: v.string(),
  },
  returns: v.id("_storage"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("canvasExports")
      .withIndex("by_canvas_cacheKey", (q) =>
        q.eq("canvasId", args.canvasId).eq("cacheKey", args.cacheKey),
      )
      .first();
    if (existing && existing.createdAt > Date.now() - EXPORT_TTL_MS) {
      // Two clicks raced the same render; keep the first blob.
      await ctx.storage.delete(args.storageId).catch(() => undefined);
      return existing.storageId;
    }
    if (existing) {
      await ctx.storage.delete(existing.storageId).catch(() => undefined);
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert("canvasExports", { ...args, createdAt: Date.now() });
    return args.storageId;
  },
});

/** Daily: exports older than the TTL go, blob and row together. */
export const sweep = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), truncated: v.boolean() }),
  handler: async (ctx) => {
    const SWEEP_PAGE = 512;
    const rows = await ctx.db
      .query("canvasExports")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", Date.now() - EXPORT_TTL_MS))
      .take(SWEEP_PAGE);
    for (const row of rows) {
      await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length, truncated: rows.length === SWEEP_PAGE };
  },
});

function fileSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "export"
  );
}

type ExportArgs = {
  canvasId: Id<"canvases">;
  pageId?: string;
  target: "canvas" | "node";
  nodeId?: string;
  clip: "frame" | "content";
  scale: 1 | 2;
  format: "png" | "pdf";
};

/** Which pages the worker captures, and what the download is called. */
function planExport(
  file: CanvasFile,
  args: ExportArgs,
  slug: string,
): { pages: CanvasFile["pages"]; target: CanvasSnapshotTarget; filename: string; label: string } {
  if (args.target === "node" && !args.nodeId) throw new Error("nodeId is required for target=node");
  if (args.target === "canvas" && args.nodeId)
    throw new Error("nodeId is only valid for target=node");
  if (args.clip === "content" && args.target !== "node")
    throw new Error("clip=content supports only target=node");
  const suffix = args.scale === 2 && args.format === "png" ? "@2x" : "";
  if (args.target === "canvas" && args.format === "pdf" && !args.pageId) {
    return {
      pages: file.pages,
      target: { type: "canvas" },
      filename: `${slug}-all-pages.pdf`,
      label: "all-pages",
    };
  }
  const page = resolveCanvasPage(file, args.pageId);
  if (args.pageId && page.id !== args.pageId)
    throw new Error(`Unknown canvas page: ${args.pageId}`);
  if (args.target === "node") {
    const nodeId = args.nodeId as string;
    const node = page.doc.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Unknown canvas node: ${nodeId}`);
    if (args.clip === "content" && node.kind === "native")
      throw new Error("clip=content requires an iframe or image node");
    return {
      pages: [page],
      target: { type: "node", nodeId },
      filename: `${slug}-${fileSlug(nodeId)}${suffix}.${args.format}`,
      label: nodeId,
    };
  }
  return {
    pages: [page],
    target: { type: "canvas" },
    filename: `${slug}-${fileSlug(page.id)}${suffix}.${args.format}`,
    label: page.id,
  };
}

/**
 * One export, rendered by the worker and handed back as a storage URL the
 * browser downloads. `status: "partial"` means the file exists but the
 * worker reported something worth showing (an iframe that never signalled
 * ready, an unresolved asset); it is not cached, so the next click retries.
 */
export const requestMine = action({
  args: {
    canvasId: v.id("canvases"),
    pageId: v.optional(v.string()),
    target: v.union(v.literal("canvas"), v.literal("node")),
    nodeId: v.optional(v.string()),
    clip: v.union(v.literal("frame"), v.literal("content")),
    scale: v.union(v.literal(1), v.literal(2)),
    format: v.union(v.literal("png"), v.literal("pdf")),
  },
  returns: ExportResultValidator,
  handler: async (ctx, args): Promise<ExportResult> => {
    const identity = await requireIotaIdentity(ctx);
    const context = await ctx.runQuery(internal.exports.contextMine, {
      canvasId: args.canvasId,
      subject: identity.subject,
    });
    const docBlob = await ctx.storage.get(context.docStorageId);
    if (!docBlob) throw new Error("CanvasDoc storage object is unavailable");
    const file = CanvasFileSchema.parse(JSON.parse(await docBlob.text()));
    const plan = planExport(file, args, context.slug);
    const mimeType = MIME_TYPES[args.format];
    const cacheKey = await sha256Hex(
      JSON.stringify({
        renderer: 1,
        draftRevision: context.draftRevision,
        pageIds: plan.pages.map((page) => page.id),
        target: plan.target,
        clip: args.clip,
        scale: args.scale,
        format: args.format,
        theme: context.theme,
      }),
    );

    // A cached export is served even when the worker is down: the bytes exist.
    const hit = await ctx.runQuery(internal.exports.cached, {
      canvasId: args.canvasId,
      cacheKey,
      now: Date.now(),
    });
    if (hit) return { status: "ok", ...hit, warnings: [], cached: true };

    // Fail before staging anything when there is no worker to stage it for.
    snapshotWorkerOrigin();

    const sources = await resolveSnapshotSources(ctx, context);
    const staged: Id<"_storage">[] = [];
    try {
      const entrypoints: string[] = [];
      for (const [index, page] of plan.pages.entries()) {
        const relPath = `/src/__export-${index}.html`;
        const entry = await stageSnapshotEntry(ctx, {
          doc: page.doc,
          cssStorageId: context.cssStorageId,
          target: plan.target,
          relPath,
        });
        staged.push(entry.storageId);
        sources.push(entry.source);
        entrypoints.push(relPath);
      }
      const entrypoint = entrypoints[0] as string;
      const result = await callSnapshotWorker({
        sources,
        entrypoint,
        entrypoints: args.format === "pdf" ? entrypoints : undefined,
        format: args.format,
        target: plan.target,
        clip: args.clip,
        padding: args.clip === "content" || plan.target.type === "canvas" ? 0 : 24,
        scale: args.scale,
        readinessTimeoutMs: SNAPSHOT_READINESS_TIMEOUT_MS,
        upload: { putUrl: await ctx.storage.generateUploadUrl() },
        ...snapshotThemePayload(context.theme),
      });
      const uploaded = result.uploadBody as { storageId?: unknown } | null;
      if (!uploaded || typeof uploaded.storageId !== "string")
        throw new Error("worker upload did not return a storageId");
      let storageId = uploaded.storageId as Id<"_storage">;
      const warnings = snapshotWarnings(result);
      if (warnings.length === 0) {
        try {
          storageId = await ctx.runMutation(internal.exports.remember, {
            canvasId: args.canvasId,
            draftRevision: context.draftRevision,
            cacheKey,
            storageId,
            mimeType,
            size: result.size,
            filename: plan.filename,
          });
        } catch (error) {
          await ctx.storage.delete(storageId).catch(() => undefined);
          throw error;
        }
      }
      const url = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error("exported file is unavailable");
      return {
        status: warnings.length > 0 ? "partial" : "ok",
        url,
        filename: plan.filename,
        mimeType,
        warnings,
        cached: false,
      };
    } finally {
      for (const storageId of staged) await ctx.storage.delete(storageId).catch(() => undefined);
    }
  },
});
