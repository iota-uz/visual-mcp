/**
 * Deletion — the capability v1 had nowhere at all.
 *
 * v1 could create workspaces, canvases, files and artifacts and could never
 * remove any of them. The storage-quota error even advised "Remove old
 * /output or /cache files" when no tool could remove anything, and the
 * `workspaces.archivedAt` field existed in the schema with no writer.
 *
 * The subtle part is purge *scope*. A canvas's bytes live in four places,
 * and only two of them are counted against the quota:
 *
 *   artifacts.storageId        counted   (render/exec outputs)
 *   canvasFiles.storageId      counted   (source files)
 *   canvasVersions.doc/css/entryStorageId   NOT counted
 *   canvases.thumbnailId       NOT counted
 *
 * Deleting only the two counted tables — the obvious implementation — leaves
 * the entire version history's blobs orphaned forever, invisible to the
 * quota counter and never swept (the /cache cron only matches `/cache/`
 * artifact rows). So purge walks all four.
 *
 * Blobs are also *shared* between tables: `recordRender` stores one blob and
 * references it from both the artifact row and the version's
 * `entryStorageId`. Deleting per-row would double-delete, so every id is
 * collected into a Set first and deleted exactly once.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export interface PurgeTotals {
  /** Bytes removed from the canvas's quota counter (artifacts + canvasFiles). */
  bytesReclaimed: number;
  /** Every distinct storage blob actually deleted, including uncounted ones. */
  blobsDeleted: number;
}

/** ctx.storage.delete throws on an id that is already gone; a purge should not. */
async function deleteBlobs(ctx: MutationCtx, ids: Set<Id<"_storage">>): Promise<number> {
  let deleted = 0;
  for (const id of ids) {
    try {
      await ctx.storage.delete(id);
      deleted += 1;
    } catch {
      // Already collected, or never existed. Nothing to recover from.
    }
  }
  return deleted;
}

/**
 * Hard-deletes everything belonging to one canvas: artifacts, source files,
 * every version (and its doc/css/entry blobs), the search-index node rows,
 * the render log, the thumbnail, and finally the canvas row itself.
 */
export async function purgeCanvas(ctx: MutationCtx, canvas: Doc<"canvases">): Promise<PurgeTotals> {
  const blobs = new Set<Id<"_storage">>();
  let bytesReclaimed = 0;

  const artifacts = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of artifacts) {
    blobs.add(row.storageId);
    bytesReclaimed += row.size;
    await ctx.db.delete(row._id);
  }

  const files = await ctx.db
    .query("canvasFiles")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of files) {
    blobs.add(row.storageId);
    bytesReclaimed += row.size;
    await ctx.db.delete(row._id);
  }

  // The blobs the quota never counted, and which nothing else would ever
  // collect — this is the leak a naive delete leaves behind.
  const versions = await ctx.db
    .query("canvasVersions")
    .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of versions) {
    if (row.docStorageId) blobs.add(row.docStorageId);
    if (row.cssStorageId) blobs.add(row.cssStorageId);
    if (row.entryStorageId) blobs.add(row.entryStorageId);
    await ctx.db.delete(row._id);
  }

  const snapshots = await ctx.db
    .query("canvasVersionFiles")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of snapshots) {
    blobs.add(row.storageId);
    await ctx.db.delete(row._id);
  }

  const nodes = await ctx.db
    .query("canvasNodes")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of nodes) await ctx.db.delete(row._id);

  const canvasSnapshots = await ctx.db
    .query("canvasSnapshots")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of canvasSnapshots) {
    blobs.add(row.storageId);
    await ctx.db.delete(row._id);
  }

  const renders = await ctx.db
    .query("renders")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of renders) await ctx.db.delete(row._id);

  // Replies first: they are the rows that would still name a comment id
  // nothing owns any more.
  const commentReplies = await ctx.db
    .query("canvasCommentReplies")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of commentReplies) await ctx.db.delete(row._id);

  const comments = await ctx.db
    .query("canvasComments")
    .withIndex("by_canvas_created", (q) => q.eq("canvasId", canvas._id))
    .collect();
  for (const row of comments) await ctx.db.delete(row._id);

  const capabilities = await ctx.db
    .query("iframeCapabilities")
    .filter((q) => q.eq(q.field("canvasId"), canvas._id))
    .collect();
  for (const row of capabilities) await ctx.db.delete(row._id);

  if (canvas.thumbnailId) blobs.add(canvas.thumbnailId);

  const blobsDeleted = await deleteBlobs(ctx, blobs);
  await ctx.db.delete(canvas._id);

  return { bytesReclaimed, blobsDeleted };
}

/** Hard-deletes a workspace and every canvas inside it. */
export async function purgeWorkspace(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
): Promise<PurgeTotals & { canvasesDeleted: number }> {
  const canvases = await ctx.db
    .query("canvases")
    .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspace._id))
    .collect();

  let bytesReclaimed = 0;
  let blobsDeleted = 0;
  for (const canvas of canvases) {
    const totals = await purgeCanvas(ctx, canvas);
    bytesReclaimed += totals.bytesReclaimed;
    blobsDeleted += totals.blobsDeleted;
  }

  await ctx.db.delete(workspace._id);
  return { bytesReclaimed, blobsDeleted, canvasesDeleted: canvases.length };
}

/**
 * Deletes one source file. The blob is only removed if no canvas version
 * still points at it — `recordRender` shares a single blob between an
 * artifact row and a version's `entryStorageId`, so an unconditional delete
 * here would punch a hole in version history.
 */
export async function purgeCanvasFile(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  relPath: string,
): Promise<PurgeTotals | null> {
  const row = await ctx.db
    .query("canvasFiles")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId).eq("relPath", relPath))
    .unique();
  if (!row) return null;

  await ctx.db.delete(row._id);
  const stillReferenced = await isBlobReferenced(ctx, canvasId, row.storageId);
  const blobsDeleted = stillReferenced ? 0 : await deleteBlobs(ctx, new Set([row.storageId]));
  return { bytesReclaimed: row.size, blobsDeleted };
}

/** Deletes one rendered artifact, with the same shared-blob guard. */
export async function purgeArtifact(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  relPath: string,
): Promise<PurgeTotals | null> {
  const row = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId).eq("relPath", relPath))
    .unique();
  if (!row) return null;

  await ctx.db.delete(row._id);
  const stillReferenced = await isBlobReferenced(ctx, canvasId, row.storageId);
  const blobsDeleted = stillReferenced ? 0 : await deleteBlobs(ctx, new Set([row.storageId]));
  return { bytesReclaimed: row.size, blobsDeleted };
}

/** True when any surviving version, artifact or file row still points at this blob. */
export async function isBlobReferenced(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const versions = await ctx.db
    .query("canvasVersions")
    .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvasId))
    .collect();
  for (const v of versions) {
    if (v.docStorageId === storageId || v.cssStorageId === storageId) return true;
    if (v.entryStorageId === storageId) return true;
  }

  const artifacts = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId))
    .collect();
  if (artifacts.some((a) => a.storageId === storageId)) return true;

  const canvasSnapshots = await ctx.db
    .query("canvasSnapshots")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
    .collect();
  if (canvasSnapshots.some((snapshot) => snapshot.storageId === storageId)) return true;

  const snapshots = await ctx.db
    .query("canvasVersionFiles")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
    .collect();
  if (snapshots.some((file) => file.storageId === storageId)) return true;

  const files = await ctx.db
    .query("canvasFiles")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId))
    .collect();
  return files.some((f) => f.storageId === storageId);
}
