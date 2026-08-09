import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireIotaIdentity } from "./lib/auth";
import { slugify } from "./lib/slug";
import { randomPublicSlug } from "./lib/tokenFormat";

const ArtifactTypeValidator = v.union(
  v.literal("pdf"),
  v.literal("image"),
  v.literal("svg"),
  v.literal("source"),
);

async function nextVersionNumber(ctx: MutationCtx, canvasId: Id<"canvases">): Promise<number> {
  const last = await ctx.db
    .query("canvasVersions")
    .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvasId))
    .order("desc")
    .first();
  return (last?.version ?? 0) + 1;
}

// PLAN.md section 9/12.4: "an agent in a loop can produce hundreds of
// full-page PNGs" — a soft per-canvas cap. Tracked as a running counter on
// `canvases.storageBytesUsed`, NOT recomputed from `artifacts`/`canvasFiles`
// at check time: version history (PLAN.md section 1 — re-rendering a
// relPath creates a new version and never destroys the superseded blob)
// means a canvas's real storage footprint keeps growing even when the
// *current* artifact rows don't change count, so a scan of "current rows
// only" silently undercounts and lets exactly the "hundreds of re-renders
// to the same output_path" scenario this cap exists for bypass it entirely.
// The counter only grows on writes below and only shrinks when a blob is
// actually deleted (sweepCacheTtl) — it tracks live storage, not a
// recomputation of current pointers. `canvasVersions` doc/css blobs
// (put_canvas_doc) and canvas thumbnails are deliberately excluded: one
// blob per call for docs, and thumbnails are capped at one small blob per
// canvas by construction (recordRender always deletes the superseded one) —
// neither is the unbounded-loop growth vector this cap targets.
const CANVAS_STORAGE_QUOTA_BYTES = 250 * 1024 * 1024;

/**
 * Checks `incomingBytes` against the canvas's running storage total and, if
 * it fits, reserves it by patching the counter — in one mutation so the
 * check and the reservation can't drift apart. Throws a clear,
 * MCP-tool-surfaced error (caught by ../mcp/tools.ts's `runTool`) when it
 * would push the canvas over its soft cap.
 */
async function reserveCanvasStorage(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  incomingBytes: number,
): Promise<void> {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) throw new Error(`Unknown canvas: ${canvasId}`);
  const used = canvas.storageBytesUsed ?? 0;
  const next = used + incomingBytes;
  if (next > CANVAS_STORAGE_QUOTA_BYTES) {
    const usedMb = (used / (1024 * 1024)).toFixed(1);
    const capMb = (CANVAS_STORAGE_QUOTA_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Canvas storage quota exceeded: ${usedMb}MB used of ${capMb}MB soft cap. ` +
        "Remove old /output or /cache files, or start a new canvas.",
    );
  }
  await ctx.db.patch(canvasId, { storageBytesUsed: next });
}

/** The inverse of reserveCanvasStorage, for sweepCacheTtl's real deletions. */
async function releaseCanvasStorage(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  bytes: number,
): Promise<void> {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) return;
  const next = Math.max(0, (canvas.storageBytesUsed ?? 0) - bytes);
  await ctx.db.patch(canvasId, { storageBytesUsed: next });
}

/**
 * Records one artifact for a canvas, mirroring
 * packages/runtime/src/render/artifact-store's `registerArtifact` role
 * inference: the first artifact a canvas ever produces becomes "primary";
 * every artifact after that becomes "supporting" unless it explicitly
 * demotes the current primary (not exposed to callers here — render_file
 * and run_code never pass an explicit role, matching the stdio tool's
 * behavior). Re-registering an existing relPath overwrites that row rather
 * than duplicating it — and, unlike the reference implementation's literal
 * "any artifacts already exist" check, re-registering the relPath that is
 * *currently* primary keeps it primary: the hosted product re-renders the
 * same output path across a canvas's whole lifetime (version history is a
 * first-class feature here, unlike the one-shot stdio sessions the
 * reference module was built for), so treating every re-render as "not the
 * first artifact ever" would silently vacate the "exactly one primary
 * artifact" invariant on the second render of any canvas.
 */
async function upsertArtifact(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  versionId: Id<"canvasVersions">,
  entry: {
    relPath: string;
    type: "pdf" | "image" | "svg" | "source";
    mimeType: string;
    size: number;
    storageId: Id<"_storage">;
  },
): Promise<{ relPath: string; role: "primary" | "supporting" }> {
  await reserveCanvasStorage(ctx, canvasId, entry.size);

  const existingRow = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId).eq("relPath", entry.relPath))
    .unique();

  let role: "primary" | "supporting";
  if (existingRow?.role === "primary") {
    role = "primary";
  } else {
    const anyExisting = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId))
      .take(1);
    role = anyExisting.length === 0 ? "primary" : "supporting";
  }

  if (role === "primary") {
    const currentPrimary = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId))
      .filter((q) => q.eq(q.field("role"), "primary"))
      .take(10);
    for (const row of currentPrimary) {
      if (row.relPath !== entry.relPath) {
        await ctx.db.patch(row._id, { role: "supporting" });
      }
    }
  }

  if (existingRow) {
    await ctx.db.patch(existingRow._id, {
      versionId,
      type: entry.type,
      role,
      mimeType: entry.mimeType,
      size: entry.size,
      storageId: entry.storageId,
    });
  } else {
    await ctx.db.insert("artifacts", {
      canvasId,
      versionId,
      relPath: entry.relPath,
      type: entry.type,
      role,
      mimeType: entry.mimeType,
      size: entry.size,
      storageId: entry.storageId,
    });
  }
  return { relPath: entry.relPath, role };
}

function toSummary(c: Doc<"canvases">) {
  return {
    canvas_id: c._id,
    workspace_id: c.workspaceId,
    slug: c.slug,
    title: c.title,
    description: c.description,
    kind: c.kind,
    visibility: c.visibility,
    public_slug: c.publicSlug,
    theme: c.theme,
    updated_at: c.updatedAt,
  };
}

export const create = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    kind: v.union(v.literal("canvas"), v.literal("html"), v.literal("image"), v.literal("pdf")),
    slug: v.optional(v.string()),
    theme: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${args.workspaceId}`);

    const base = slugify(args.slug ?? args.title);
    let slug = base;
    let suffix = 2;
    while (
      await ctx.db
        .query("canvases")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", slug),
        )
        .unique()
    ) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    const now = Date.now();
    const canvasId = await ctx.db.insert("canvases", {
      workspaceId: args.workspaceId,
      slug,
      title: args.title,
      kind: args.kind,
      visibility: "private",
      theme: args.theme,
      createdBy: args.createdBy,
      updatedAt: now,
    });
    return { canvasId, slug };
  },
});

async function listCanvases(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const rows = await ctx.db
    .query("canvases")
    .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .take(200);
  // Signed, time-limited URLs, resolved per row — this is what lights up
  // the gallery grid (PLAN.md section 8: "gallery with live-updating
  // thumbnails"), not just the single-canvas viewer's thumbnail_url.
  return Promise.all(
    rows.map(async (row) => ({
      ...toSummary(row),
      thumbnail_url: row.thumbnailId ? await ctx.storage.getUrl(row.thumbnailId) : null,
    })),
  );
}

async function getCanvas(ctx: QueryCtx, canvasId: Id<"canvases">) {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) return null;
  let docStorageId: Id<"_storage"> | undefined;
  let entryStorageId: Id<"_storage"> | undefined;
  let version: number | undefined;
  if (canvas.currentVersionId) {
    const currentVersion = await ctx.db.get(canvas.currentVersionId);
    docStorageId = currentVersion?.docStorageId;
    entryStorageId = currentVersion?.entryStorageId;
    version = currentVersion?.version;
  }
  // Signed, time-limited URLs — cheap to mint per query, never stored.
  // `doc_url` feeds the SPA's client-side canvas viewer (kind="canvas");
  // `entry_url` is the primary artifact for html/image/pdf kinds.
  const docUrl = docStorageId ? await ctx.storage.getUrl(docStorageId) : null;
  const entryUrl = entryStorageId ? await ctx.storage.getUrl(entryStorageId) : null;
  const thumbnailUrl = canvas.thumbnailId ? await ctx.storage.getUrl(canvas.thumbnailId) : null;
  return {
    ...toSummary(canvas),
    doc_storage_id: docStorageId,
    doc_url: docUrl,
    entry_url: entryUrl,
    thumbnail_url: thumbnailUrl,
    version,
  };
}

async function publishCanvas(
  ctx: MutationCtx,
  args: {
    canvasId: Id<"canvases">;
    visibility: "private" | "public";
    newPublicSlug?: string;
  },
) {
  const canvas = await ctx.db.get(args.canvasId);
  if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

  if (args.visibility === "private") {
    await ctx.db.patch(args.canvasId, { visibility: "private", publicSlug: undefined });
    return { visibility: "private" as const, publicSlug: undefined };
  }

  const publicSlug = canvas.publicSlug ?? args.newPublicSlug;
  if (!publicSlug) {
    throw new Error("newPublicSlug is required the first time a canvas is published");
  }
  await ctx.db.patch(args.canvasId, { visibility: "public", publicSlug });
  return { visibility: "public" as const, publicSlug };
}

export const list = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => listCanvases(ctx, args.workspaceId),
});

export const get = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => getCanvas(ctx, args.canvasId),
});

export const publish = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    visibility: v.union(v.literal("private"), v.literal("public")),
    // A fresh 128-bit-random slug, generated by the caller (httpAction —
    // mutations should not mint their own randomness); ignored if the
    // canvas already has one.
    newPublicSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => publishCanvas(ctx, args),
});

// --- Public, SPA-facing (PLAN.md Part 1 section 1's `/w/:wsSlug`, `/c/:canvasId`) ---
// Reads are org-wide (decision #4: private = visible to all @iota.uz, and
// there's no ACL layer to further restrict who among them can see what) —
// these do not filter by `visibility`, unlike the anonymous `/s/:slug` path
// (PLAN.md Part 1 section 8), which is the only place `visibility` actually
// gates access.

export const listForWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    return listCanvases(ctx, args.workspaceId);
  },
});

export const getMine = query({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    return getCanvas(ctx, args.canvasId);
  },
});

export const publishMine = mutation({
  args: {
    canvasId: v.id("canvases"),
    visibility: v.union(v.literal("private"), v.literal("public")),
  },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    // Minted here (not passed in by the client) so a signed-in user cannot
    // choose their own public slug.
    return publishCanvas(ctx, { ...args, newPublicSlug: randomPublicSlug() });
  },
});

// Replaces the old published slug with a fresh one in a single atomic patch
// (no unpublish -> publish round trip, which would leave a window where the
// canvas resolves as private). The old slug stops resolving the instant this
// commits, since `resolvePublicArtifact` looks up by exact `publicSlug`.
export const rotateMySlug = mutation({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);
    if (canvas.visibility !== "public") {
      throw new Error("Canvas must be public before its share link can be rotated");
    }
    const publicSlug = randomPublicSlug();
    await ctx.db.patch(args.canvasId, { publicSlug });
    return { publicSlug };
  },
});

// Read-only version history for the Canvas page (PLAN.md section 9 C2) —
// every render/put_canvas_doc creates a new canvasVersions row and old ones
// are never destroyed (decision #1), so this is a plain reverse-chronological
// list. No restore/rollback here — that's separate, unshipped scope.
export const listVersionsMine = query({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) return [];

    const versions = await ctx.db
      .query("canvasVersions")
      .withIndex("by_canvas_version", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .take(50);

    return Promise.all(
      versions.map(async (v) => {
        const author = await ctx.db.get(v.createdBy);
        return {
          versionId: v._id,
          version: v.version,
          note: v.note,
          createdAt: v._creationTime,
          createdByEmail: author?.email ?? null,
          isCurrent: canvas.currentVersionId === v._id,
        };
      }),
    );
  },
});

// Cross-workspace search over canvas-kind node titles/eyebrows/inspector
// copy (PLAN.md section 4/9), backed by canvasNodes.search_text. Org-wide
// like the rest of the signed-in read surface (decision #4) — no canvasId
// filter, so a query can find the right canvas as well as the right node
// inside it. Only ever holds current-version rows (putDoc deletes the
// previous version's), so there's no per-node duplicate-across-history noise.
export const searchNodes = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const trimmed = args.query.trim();
    if (!trimmed) return [];

    const rows = await ctx.db
      .query("canvasNodes")
      .withSearchIndex("search_text", (q) => q.search("searchText", trimmed))
      .take(20);

    const results = await Promise.all(
      rows.map(async (row) => {
        const canvas = await ctx.db.get(row.canvasId);
        if (!canvas) return null;
        return {
          canvasId: row.canvasId,
          canvasTitle: canvas.title,
          workspaceId: canvas.workspaceId,
          nodeId: row.nodeId,
          nodeTitle: row.title,
          nodeEyebrow: row.eyebrow,
        };
      }),
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

export const putDoc = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    docStorageId: v.id("_storage"),
    note: v.optional(v.string()),
    createdBy: v.id("users"),
    nodes: v.array(
      v.object({
        nodeId: v.string(),
        title: v.string(),
        eyebrow: v.optional(v.string()),
        searchText: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const last = await ctx.db
      .query("canvasVersions")
      .withIndex("by_canvas_version", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .first();
    const version = (last?.version ?? 0) + 1;

    // canvasNodes exists only to back the search index and `?node=` lookups
    // against the *current* doc, unlike canvasVersions/artifacts (whose
    // history is deliberately kept forever). Deleting the previous version's
    // rows here keeps it that way — otherwise every put_canvas_doc leaves
    // its old nodes behind, and search would return one stale duplicate per
    // past edit for every node that survived unchanged.
    if (last) {
      const staleNodes = await ctx.db
        .query("canvasNodes")
        .withIndex("by_version", (q) => q.eq("versionId", last._id))
        .collect();
      for (const node of staleNodes) {
        await ctx.db.delete(node._id);
      }
    }

    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      note: args.note,
      createdBy: args.createdBy,
      docStorageId: args.docStorageId,
    });

    for (const node of args.nodes) {
      await ctx.db.insert("canvasNodes", { canvasId: args.canvasId, versionId, ...node });
    }

    await ctx.db.patch(args.canvasId, { currentVersionId: versionId, updatedAt: Date.now() });
    return { versionId, version };
  },
});

export const upsertFile = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    relPath: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    await reserveCanvasStorage(ctx, args.canvasId, args.size);

    const existing = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) =>
        q.eq("canvasId", args.canvasId).eq("relPath", args.relPath),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        size: args.size,
        contentHash: args.contentHash,
      });
    } else {
      await ctx.db.insert("canvasFiles", {
        canvasId: args.canvasId,
        relPath: args.relPath,
        storageId: args.storageId,
        size: args.size,
        contentHash: args.contentHash,
      });
    }
    await ctx.db.patch(args.canvasId, { updatedAt: Date.now() });
  },
});

export const listArtifactsForCanvas = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    return rows.map((a) => ({ path: a.relPath, type: a.type, role: a.role }));
  },
});

export const getArtifact = internalQuery({
  args: { canvasId: v.id("canvases"), relPath: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) =>
        q.eq("canvasId", args.canvasId).eq("relPath", args.relPath),
      )
      .unique();
    if (!row) return null;
    return {
      path: row.relPath,
      type: row.type,
      role: row.role,
      mimeType: row.mimeType,
      size: row.size,
      storageId: row.storageId,
    };
  },
});

// Backs the anonymous `/s/:slug[/*]` httpAction (PLAN.md Part 1 section 8) —
// the only place `visibility` actually gates access (every other read in
// this file is org-wide per decision #4). Returns null for both an unknown
// slug and a since-unpublished one — `publish`/`publishCanvas` clears
// `publicSlug` on unpublish, so those two cases already collapse to "no row
// matches the index" without any extra check here, which is what keeps this
// from leaking "it exists but is private" to an anonymous caller.
export const resolvePublicArtifact = internalQuery({
  args: { publicSlug: v.string(), relPath: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvases")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.publicSlug))
      .unique();
    if (canvas?.visibility !== "public") return null;

    let row: Doc<"artifacts"> | null;
    if (args.relPath) {
      row = await ctx.db
        .query("artifacts")
        .withIndex("by_canvas_relPath", (q) =>
          q.eq("canvasId", canvas._id).eq("relPath", args.relPath as string),
        )
        .unique();
    } else {
      const primaryRows = await ctx.db
        .query("artifacts")
        .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
        .filter((q) => q.eq(q.field("role"), "primary"))
        .take(1);
      row = primaryRows[0] ?? null;
    }
    if (!row) return null;

    return {
      relPath: row.relPath,
      type: row.type,
      mimeType: row.mimeType,
      size: row.size,
      storageId: row.storageId,
    };
  },
});

export const listFilesForCanvas = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    return rows.map((f) => ({ relPath: f.relPath, storageId: f.storageId }));
  },
});

/**
 * Records a render_file result: a new canvasVersions row (entryStorageId —
 * "kind=canvas" uses docStorageId instead, per PLAN.md section 4) plus the
 * produced artifact, atomically. "Claude re-rendering creates a new
 * version, never destroys the old one" (PLAN.md section 1) applies to every
 * canvas kind, not just kind="canvas".
 */
export const recordRender = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    createdBy: v.id("users"),
    relPath: v.string(),
    type: ArtifactTypeValidator,
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    // Only ever set for format="png" renders (apps/worker/src/render.ts).
    // Excluded from the storage quota (like putDoc's blobs) — unlike
    // artifacts/canvasFiles, a thumbnail is never kept for version history,
    // so it can't accumulate: the superseded one is always deleted below,
    // capping this at one small blob per canvas regardless of render count.
    thumbnailStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const version = await nextVersionNumber(ctx, args.canvasId);
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      createdBy: args.createdBy,
      entryStorageId: args.storageId,
    });
    await ctx.db.patch(args.canvasId, { currentVersionId: versionId, updatedAt: Date.now() });

    const artifact = await upsertArtifact(ctx, args.canvasId, versionId, {
      relPath: args.relPath,
      type: args.type,
      mimeType: args.mimeType,
      size: args.size,
      storageId: args.storageId,
    });

    if (args.thumbnailStorageId) {
      // The gallery shows one thumbnail per canvas, for its primary
      // artifact — a thumbnail from re-rendering a supporting/debug output
      // path doesn't belong on the canvas, so it's discarded immediately
      // rather than left as an orphaned blob.
      if (artifact.role === "primary") {
        const current = await ctx.db.get(args.canvasId);
        if (current?.thumbnailId) {
          await ctx.storage.delete(current.thumbnailId);
        }
        await ctx.db.patch(args.canvasId, { thumbnailId: args.thumbnailStorageId });
      } else {
        await ctx.storage.delete(args.thumbnailStorageId);
      }
    }

    return { version, artifact };
  },
});

/**
 * Records run_code's produced /output files as one new version (see
 * recordRender's comment) plus one artifact row per file. No-ops (creates
 * no version) when run_code produced nothing to upload — a pure-compute
 * call shouldn't bump the canvas's version history.
 */
export const recordExecArtifacts = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    createdBy: v.id("users"),
    artifacts: v.array(
      v.object({
        relPath: v.string(),
        type: ArtifactTypeValidator,
        mimeType: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.artifacts.length === 0) {
      return {
        version: null,
        artifacts: [] as { relPath: string; role: "primary" | "supporting" }[],
      };
    }
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const version = await nextVersionNumber(ctx, args.canvasId);
    const first = args.artifacts[0];
    if (!first) throw new Error("unreachable: length checked above");
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      createdBy: args.createdBy,
      entryStorageId: first.storageId,
    });
    await ctx.db.patch(args.canvasId, { currentVersionId: versionId, updatedAt: Date.now() });

    const recorded: { relPath: string; role: "primary" | "supporting" }[] = [];
    for (const entry of args.artifacts) {
      recorded.push(await upsertArtifact(ctx, args.canvasId, versionId, entry));
    }
    return { version, artifacts: recorded };
  },
});

export const logRender = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    entrypoint: v.string(),
    format: v.union(v.literal("png"), v.literal("svg"), v.literal("pdf"), v.literal("html")),
    status: v.union(v.literal("success"), v.literal("error")),
    durationMs: v.optional(v.number()),
    errorText: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("renders", args);
  },
});

// PLAN.md section 4/9/12.4: "/cache renders stay out of `artifacts`, as
// today" describes intent, not current storage — render_file/run_code
// record every output, /cache/ ones included, as a normal `artifacts` row
// (see upsertArtifact above). This sweep is what actually makes /cache/
// paths ephemeral: anything under that prefix older than the TTL is deleted,
// storage blob and all. Scheduled from ./crons.ts. A single-org internal
// tool with no admin panel (decision #8) is small enough that a full
// `artifacts` table scan is the right tradeoff over adding a dedicated
// TTL/prefix index purely to serve one cron.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const sweepCacheTtl = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CACHE_TTL_MS;
    const rows = await ctx.db.query("artifacts").collect();
    let deleted = 0;
    for (const row of rows) {
      if (row.relPath.startsWith("/cache/") && row._creationTime < cutoff) {
        await ctx.storage.delete(row.storageId);
        await ctx.db.delete(row._id);
        await releaseCanvasStorage(ctx, row.canvasId, row.size);
        deleted += 1;
      }
    }
    return { scanned: rows.length, deleted };
  },
});
