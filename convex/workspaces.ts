import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { slugify } from "./lib/slug";

export const create = internalMutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
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
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("workspaces").take(200);
    return rows
      .filter((w) => w.archivedAt === undefined)
      .map((w) => ({
        workspace_id: w._id,
        slug: w.slug,
        name: w.name,
        description: w.description,
      }));
  },
});
