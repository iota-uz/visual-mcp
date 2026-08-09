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

async function listWorkspaces(ctx: QueryCtx) {
  const rows = await ctx.db.query("workspaces").take(200);
  return rows
    .filter((w) => w.archivedAt === undefined)
    .map((w) => ({
      workspace_id: w._id,
      slug: w.slug,
      name: w.name,
      description: w.description,
    }));
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
