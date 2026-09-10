import { Migrations } from "@convex-dev/migrations";
import { canvasPoster } from "@visual-canvas/canvas/poster.js";
import { CanvasFileSchema } from "@visual-canvas/canvas/types.js";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { promoteWorkspaceAsset } from "./canvases";
import {
  ASSET_MAX_BYTES,
  type ASSET_MIME_TYPES,
  type AssetKind,
  validateAssetBytes,
} from "./lib/assetSecurity";
import { deleteObject, headObject, putObject } from "./lib/objectStore";
import { slugify } from "./lib/slug";
import schema, { CanvasPosterValidator } from "./schema";

const migrations = new Migrations(components.migrations, { schema });

const LEGACY_ASSET_MIME_BY_EXTENSION: Readonly<Record<string, keyof typeof ASSET_MIME_TYPES>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  json: "application/json",
};

function legacyAssetMime(relPath: string): keyof typeof ASSET_MIME_TYPES | null {
  if (!relPath.startsWith("/assets/")) return null;
  const extension = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase();
  return LEGACY_ASSET_MIME_BY_EXTENSION[extension] ?? null;
}

export const listLegacyCanvasFiles = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("canvasFiles")),
  handler: async (ctx, args) =>
    ctx.db.query("canvasFiles").order("asc").paginate(args.paginationOpts),
});

export const getLegacyPreparation = internalQuery({
  args: { canvasFileId: v.id("canvasFiles") },
  returns: v.union(v.null(), schema.doc("legacyCanvasAssetPreparations")),
  handler: async (ctx, args) =>
    ctx.db
      .query("legacyCanvasAssetPreparations")
      .withIndex("by_canvasFileId", (q) => q.eq("canvasFileId", args.canvasFileId))
      .unique(),
});

export const stageLegacyPreparation = internalMutation({
  args: {
    canvasFileId: v.id("canvasFiles"),
    expectedStorageId: v.id("_storage"),
    expectedContentHash: v.string(),
    objectKey: v.string(),
    contentHash: v.string(),
    mimeType: v.string(),
    size: v.number(),
    kind: v.union(
      v.literal("image"),
      v.literal("svg"),
      v.literal("font"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("data"),
    ),
    originalFilename: v.string(),
    slug: v.string(),
    name: v.string(),
    objectLeaseId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("legacyCanvasAssetPreparations")
      .withIndex("by_canvasFileId", (q) => q.eq("canvasFileId", args.canvasFileId))
      .unique();
    if (existing) return false;
    const file = await ctx.db.get(args.canvasFileId);
    if (
      !file ||
      file.storageId !== args.expectedStorageId ||
      file.contentHash !== args.expectedContentHash ||
      legacyAssetMime(file.relPath) === null
    ) {
      throw new Error(`Legacy canvas file changed while preparing: ${args.canvasFileId}`);
    }
    await ctx.db.insert("legacyCanvasAssetPreparations", {
      canvasFileId: file._id,
      canvasId: file.canvasId,
      relPath: file.relPath,
      objectKey: args.objectKey,
      contentHash: args.contentHash,
      mimeType: args.mimeType,
      size: args.size,
      kind: args.kind,
      originalFilename: args.originalFilename,
      slug: args.slug,
      name: args.name,
      objectLeaseId: args.objectLeaseId,
      preparedAt: Date.now(),
    });
    return true;
  },
});

async function ensureObject(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const existing = await headObject(key);
  if (existing.status === 404) await putObject(key, bytes, mimeType);
  else if (!existing.ok) throw new Error(`Unable to inspect object: HTTP ${existing.status}`);
}

async function discardPreparedObject(
  ctx: ActionCtx,
  objectKey: string,
  leaseId: string,
): Promise<void> {
  const claimId = crypto.randomUUID();
  const claimed: boolean = await ctx.runMutation(internal.assets.claimObjectDeletion, {
    objectKey,
    leaseId,
    claimId,
  });
  if (!claimed) return;
  try {
    await deleteObject(objectKey);
  } finally {
    await ctx.runMutation(internal.assets.finishObjectDeletion, { objectKey, claimId });
  }
}

const preparationErrorValidator = v.object({
  canvasFileId: v.id("canvasFiles"),
  relPath: v.string(),
  error: v.string(),
});

export const prepareLegacyCanvasAssets = internalAction({
  args: {},
  returns: v.object({
    scanned: v.number(),
    candidates: v.number(),
    prepared: v.number(),
    alreadyPrepared: v.number(),
    skipped: v.number(),
    errors: v.array(preparationErrorValidator),
  }),
  handler: async (
    ctx,
  ): Promise<{
    scanned: number;
    candidates: number;
    prepared: number;
    alreadyPrepared: number;
    skipped: number;
    errors: Array<{ canvasFileId: Id<"canvasFiles">; relPath: string; error: string }>;
  }> => {
    let cursor: string | null = null;
    let scanned = 0;
    let candidates = 0;
    let prepared = 0;
    let alreadyPrepared = 0;
    let skipped = 0;
    const errors: Array<{ canvasFileId: Id<"canvasFiles">; relPath: string; error: string }> = [];
    let isDone = false;
    while (!isDone) {
      const page: {
        page: Doc<"canvasFiles">[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.migrations.listLegacyCanvasFiles, {
        paginationOpts: { cursor, numItems: 50 },
      });
      for (const file of page.page) {
        scanned += 1;
        const declaredMime = legacyAssetMime(file.relPath);
        if (!declaredMime) {
          if (file.relPath.startsWith("/assets/")) skipped += 1;
          continue;
        }
        candidates += 1;
        const existing = await ctx.runQuery(internal.migrations.getLegacyPreparation, {
          canvasFileId: file._id,
        });
        if (existing) {
          alreadyPrepared += 1;
          continue;
        }
        let objectKey: string | undefined;
        let objectLeaseId: string | undefined;
        try {
          if (file.size <= 0 || file.size > ASSET_MAX_BYTES) {
            throw new Error(`Asset size must be between 1 and ${ASSET_MAX_BYTES} bytes`);
          }
          const blob = await ctx.storage.get(file.storageId);
          if (!blob) throw new Error("Convex storage blob is missing");
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const validated = await validateAssetBytes(bytes, declaredMime);
          if (validated.contentHash !== file.contentHash) {
            throw new Error("Stored bytes do not match canvasFiles.contentHash");
          }
          objectKey = `blobs/sha256/${validated.contentHash.slice(0, 2)}/${validated.contentHash}`;
          objectLeaseId = crypto.randomUUID();
          await ctx.runMutation(internal.assets.acquireObjectLease, {
            objectKey,
            leaseId: objectLeaseId,
          });
          await ensureObject(objectKey, validated.bytes, validated.mimeType);
          const originalFilename = file.relPath.split("/").pop() || "asset";
          const name = originalFilename.replace(/\.[^.]+$/, "") || originalFilename;
          const inserted: boolean = await ctx.runMutation(
            internal.migrations.stageLegacyPreparation,
            {
              canvasFileId: file._id,
              expectedStorageId: file.storageId,
              expectedContentHash: file.contentHash,
              objectKey,
              contentHash: validated.contentHash,
              mimeType: validated.mimeType,
              size: validated.bytes.byteLength,
              kind: validated.kind,
              originalFilename,
              slug: slugify(name),
              name,
              objectLeaseId,
            },
          );
          if (inserted) prepared += 1;
          else alreadyPrepared += 1;
        } catch (error) {
          if (objectKey && objectLeaseId) {
            await discardPreparedObject(ctx, objectKey, objectLeaseId).catch(() => undefined);
          }
          errors.push({
            canvasFileId: file._id,
            relPath: file.relPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      cursor = page.continueCursor;
      isDone = page.isDone;
    }
    return { scanned, candidates, prepared, alreadyPrepared, skipped, errors };
  },
});

export const promoteLegacyCanvasAssets = migrations.define({
  table: "canvasFiles",
  batchSize: 5,
  migrateOne: async (ctx, file) => {
    if (legacyAssetMime(file.relPath) === null) return;
    const preparation = await ctx.db
      .query("legacyCanvasAssetPreparations")
      .withIndex("by_canvasFileId", (q) => q.eq("canvasFileId", file._id))
      .unique();
    if (!preparation) {
      throw new Error(`Legacy asset was not prepared: ${file._id} ${file.relPath}`);
    }
    const canvas = await ctx.db.get(file.canvasId);
    if (!canvas) throw new Error(`Legacy asset canvas is missing: ${file.canvasId}`);
    const workspace = await ctx.db.get(canvas.workspaceId);
    if (!workspace) throw new Error(`Legacy asset workspace is missing: ${canvas.workspaceId}`);
    const binding = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) =>
        q.eq("canvasId", canvas._id).eq("logicalPath", file.relPath),
      )
      .unique();
    const promoted = await promoteWorkspaceAsset(ctx, {
      canvas,
      workspaceSlug: workspace.slug,
      createdBy: canvas.createdBy,
      path: file.relPath,
      currentBinding: binding ?? undefined,
      objectKey: preparation.objectKey,
      contentHash: preparation.contentHash,
      mimeType: preparation.mimeType,
      size: preparation.size,
      kind: preparation.kind as AssetKind,
      originalFilename: preparation.originalFilename,
      slug: preparation.slug,
      name: preparation.name,
      objectLeaseId: preparation.objectLeaseId,
    });
    if (binding) {
      await ctx.db.patch(binding._id, {
        assetId: promoted.assetId,
        assetVersionId: promoted.assetVersionId,
      });
    } else {
      await ctx.db.insert("canvasAssetBindings", {
        canvasId: canvas._id,
        logicalPath: file.relPath,
        assetId: promoted.assetId,
        assetVersionId: promoted.assetVersionId,
      });
    }
    await ctx.db.delete(file._id);
    await ctx.db.delete(preparation._id);
  },
});

/*
 * Canvas covers, for rows written before `canvases.poster` existed.
 *
 * `migrations.define` cannot do this: `migrateOne` runs in a mutation, and a
 * mutation's `ctx.storage` has no `get()` — only an action can open the
 * document blob. So this mirrors the shape of the legacy-asset preparation
 * above: an action driving a paginated query, patching one row at a time.
 *
 * Idempotent twice over — the filter skips rows that already have a cover,
 * and the write is conditional on the document hash it was computed from, so
 * a save that lands mid-backfill is never clobbered.
 */
export const listCanvasesMissingPoster = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("canvases")),
  handler: async (ctx, args) => ctx.db.query("canvases").order("asc").paginate(args.paginationOpts),
});

export const attachBackfilledPoster = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    expectedDocContentHash: v.optional(v.string()),
    poster: CanvasPosterValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) return false;
    // Someone saved between the read and this write: their poster is newer
    // than the one computed from the blob this action opened.
    if (canvas.poster !== undefined) return false;
    if (canvas.draftDocContentHash !== args.expectedDocContentHash) return false;
    await ctx.db.patch(args.canvasId, { poster: args.poster });
    // The current checkpoint too, so restoring to head keeps the cover.
    if (canvas.currentVersionId) {
      const current = await ctx.db.get(canvas.currentVersionId);
      if (current && current.poster === undefined) {
        await ctx.db.patch(current._id, { poster: args.poster });
      }
    }
    return true;
  },
});

export const backfillCanvasPosters = internalAction({
  args: {},
  returns: v.object({
    scanned: v.number(),
    candidates: v.number(),
    updated: v.number(),
    raced: v.number(),
    errors: v.array(v.object({ canvasId: v.id("canvases"), error: v.string() })),
  }),
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;
    let scanned = 0;
    let candidates = 0;
    let updated = 0;
    let raced = 0;
    const errors: { canvasId: Id<"canvases">; error: string }[] = [];

    while (!isDone) {
      const page: {
        page: Doc<"canvases">[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.migrations.listCanvasesMissingPoster, {
        paginationOpts: { numItems: 20, cursor },
      });
      for (const canvas of page.page) {
        scanned += 1;
        // Only kind=canvas has a document to derive geometry from
        // (adr/product/agent-authored-dual-format-canvas.md).
        if (canvas.kind !== "canvas") continue;
        if (canvas.poster !== undefined) continue;
        if (!canvas.draftDocStorageId) continue;
        candidates += 1;
        try {
          const blob = await ctx.storage.get(canvas.draftDocStorageId);
          if (!blob) throw new Error("draft document blob is missing");
          const file = CanvasFileSchema.parse(JSON.parse(await blob.text()));
          const applied: boolean = await ctx.runMutation(
            internal.migrations.attachBackfilledPoster,
            {
              canvasId: canvas._id,
              expectedDocContentHash: canvas.draftDocContentHash,
              poster: canvasPoster(file),
            },
          );
          if (applied) updated += 1;
          else raced += 1;
        } catch (error) {
          errors.push({
            canvasId: canvas._id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      cursor = page.continueCursor;
      isDone = page.isDone;
    }
    return { scanned, candidates, updated, raced, errors };
  },
});

export const run = migrations.runner();
