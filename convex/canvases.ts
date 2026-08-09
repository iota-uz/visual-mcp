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
  return rows.map(toSummary);
}

async function getCanvas(ctx: QueryCtx, canvasId: Id<"canvases">) {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) return null;
  let docStorageId: Id<"_storage"> | undefined;
  let version: number | undefined;
  if (canvas.currentVersionId) {
    const currentVersion = await ctx.db.get(canvas.currentVersionId);
    docStorageId = currentVersion?.docStorageId;
    version = currentVersion?.version;
  }
  return { ...toSummary(canvas), doc_storage_id: docStorageId, version };
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
