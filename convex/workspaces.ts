import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { getOrCreateUserId, requireIotaIdentity } from "./lib/auth";
import { purgeWorkspace } from "./lib/purge";
import { slugify } from "./lib/slug";

async function createWorkspace(
  ctx: MutationCtx,
  args: { name: string; slug?: string; description?: string; createdBy: Id<"users"> },
) {
  const base = slugify(args.slug ?? args.name);
  let slug = base;
  let suffix = 2;
  while (
    await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()
  ) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  const workspaceId = await ctx.db.insert("workspaces", {
    slug,
    name: args.name,
    description: args.description,
    createdBy: args.createdBy,
  });
  return { workspaceId, slug };
}

/** Thumbnails a workspace lane previews on the home page. */
const RECENT_PER_WORKSPACE = 4;

/*
 * Each row carries what the home page's lane actually shows: how many
 * canvases are in it, and a strip of the few an agent touched most recently.
 *
 * This replaces a per-row `listForWorkspace` subscription in the SPA, which
 * fetched every canvas in every workspace — minting a signed
 * `storage.getUrl()` for each one — and then discarded all of it but
 * `.length`. Twenty workspaces of twenty canvases was four hundred signed
 * URLs to print twenty integers.
 */
async function listWorkspaces(ctx: QueryCtx) {
  const rows = (await ctx.db.query("workspaces").take(200)).filter(
    (w) => w.archivedAt === undefined,
  );

  return Promise.all(
    rows.map(async (w) => {
      // `by_workspace_updated` is ordered, so `take` walks only as far as it
      // needs to; the count still has to see every row, but it reads no
      // storage and mints nothing.
      const canvases = (
        await ctx.db
          .query("canvases")
          .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", w._id))
          .order("desc")
          .take(200)
      ).filter((c) => c.archivedAt === undefined);

      const recent = await Promise.all(
        canvases.slice(0, RECENT_PER_WORKSPACE).map(async (c) => ({
          canvas_id: c._id,
          title: c.title,
          kind: c.kind,
          thumbnail_url: c.thumbnailId ? await ctx.storage.getUrl(c.thumbnailId) : null,
        })),
      );

      return {
        workspace_id: w._id,
        slug: w.slug,
        name: w.name,
        description: w.description,
        canvas_count: canvases.length,
        recent,
      };
    }),
  );
}

export const create = internalMutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => createWorkspace(ctx, args),
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => listWorkspaces(ctx),
});

// --- Public, SPA-facing (PLAN.md Part 1 section 1's `/` and `/w/:wsSlug`) ---
// Reads and writes are org-wide (decision #9) — any signed-in @iota.uz user
// may list or create a workspace; only `createdBy` attribution is scoped.

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    await requireIotaIdentity(ctx);
    return listWorkspaces(ctx);
  },
});

export const createMine = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const userId = await getOrCreateUserId(ctx, identity);
    return createWorkspace(ctx, { ...args, createdBy: userId });
  },
});

// Small helper for the canvas viewer's "back to workspace" link, which only
// has the workspace's Convex id (from the canvas doc), not its slug.
export const getById = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    return { workspace_id: workspace._id, slug: workspace.slug, name: workspace.name };
  },
});

/* --- Curator surface: rename, archive, delete -------------------------
 * v1 had none of these at any layer, which is why the live deployment
 * accumulated six test workspaces with no way to remove them and two both
 * named "OSAGO". Org-wide like every other write (decision #9).
 */

export const renameMine = mutation({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Name must not be empty.");
    // The slug is deliberately immutable — it is how agents address this
    // workspace ("osago/fast-settlement") and it appears in every URL.
    await ctx.db.patch(args.workspaceId, { name });
    return { name };
  },
});

export const archiveMine = mutation({
  args: { workspaceId: v.id("workspaces"), archived: v.boolean() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    await ctx.db.patch(args.workspaceId, {
      archivedAt: args.archived ? Date.now() : undefined,
    });
    return { archived: args.archived };
  },
});

/** Hard delete, including every canvas inside it and all of their blobs. */
export const deleteMine = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    const totals = await purgeWorkspace(ctx, workspace);
    return {
      bytes_reclaimed: totals.bytesReclaimed,
      canvases_deleted: totals.canvasesDeleted,
    };
  },
});

// Resolves `/w/:wsSlug` (PLAN.md Part 1 section 1's route table uses the
// slug, not the Convex id, in the URL).
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!workspace || workspace.archivedAt !== undefined) return null;
    return {
      workspace_id: workspace._id,
      slug: workspace.slug,
      name: workspace.name,
      description: workspace.description,
    };
  },
});
