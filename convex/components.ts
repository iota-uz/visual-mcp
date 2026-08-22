/**
 * Reusable canvas components (PLAN.md's "author once, reuse everywhere").
 *
 * These are MCP-first: agents save a block of nodes and edges under a
 * `workspace/component` ref and insert copies elsewhere. There is no SPA
 * surface yet, so everything here is internal and called from the tool
 * layer, which owns authentication.
 *
 * Insertion copies rather than links, so a row is a plain immutable body
 * plus metadata; `version` exists to make concurrent updates safe, not to
 * track instances.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/** `workspace-slug/component-slug`, mirroring the canvas ref grammar. */
export function parseComponentRef(ref: string): { workspaceSlug: string; componentSlug: string } {
  const parts = ref.trim().split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(
      `Component ref "${ref}" must be "workspace-slug/component-slug" (e.g. "osago/login-flow").`,
    );
  }
  return { workspaceSlug: parts[0] as string, componentSlug: parts[1] as string };
}

function summarize(component: Doc<"canvasComponents">, workspaceSlug: string) {
  return {
    ref: `${workspaceSlug}/${component.slug}`,
    component_id: component._id as string,
    workspace_slug: workspaceSlug,
    slug: component.slug,
    name: component.name,
    description: component.description,
    tags: component.tags,
    node_count: component.nodeCount,
    edge_count: component.edgeCount,
    size: { width: component.width, height: component.height },
    version: component.version,
    updated_at: component.updatedAt,
  };
}

export const upsert = internalMutation({
  args: {
    workspaceSlug: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    bodyJson: v.string(),
    nodeCount: v.number(),
    edgeCount: v.number(),
    width: v.number(),
    height: v.number(),
    expectedVersion: v.optional(v.number()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug))
      .unique();
    if (!workspace || workspace.archivedAt !== undefined) {
      throw new Error(
        `Unknown workspace "${args.workspaceSlug}". Save a canvas there first; components do not create workspaces.`,
      );
    }
    const existing = await ctx.db
      .query("canvasComponents")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", workspace._id).eq("slug", args.slug),
      )
      .unique();
    if (
      existing &&
      args.expectedVersion !== undefined &&
      existing.version !== args.expectedVersion
    ) {
      throw new Error(
        `version_conflict: expected ${args.expectedVersion}, current ${existing.version}`,
      );
    }
    const searchText = [args.name, args.description ?? "", args.tags.join(" "), args.slug]
      .filter(Boolean)
      .join(" ");
    const fields = {
      workspaceId: workspace._id,
      slug: args.slug,
      name: args.name,
      description: args.description,
      tags: args.tags,
      bodyJson: args.bodyJson,
      nodeCount: args.nodeCount,
      edgeCount: args.edgeCount,
      width: args.width,
      height: args.height,
      searchText,
      createdBy: existing?.createdBy ?? args.createdBy,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, version: existing.version + 1 });
      const updated = await ctx.db.get(existing._id);
      if (!updated) throw new Error("Component vanished mid-write");
      return { created: false, ...summarize(updated, workspace.slug) };
    }
    const componentId = await ctx.db.insert("canvasComponents", { ...fields, version: 1 });
    const created = await ctx.db.get(componentId);
    if (!created) throw new Error("Component vanished mid-write");
    return { created: true, ...summarize(created, workspace.slug) };
  },
});

export const getByRef = internalQuery({
  args: { workspaceSlug: v.string(), slug: v.string(), includeBody: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug))
      .unique();
    if (!workspace) return null;
    const component = await ctx.db
      .query("canvasComponents")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", workspace._id).eq("slug", args.slug),
      )
      .unique();
    if (!component) return null;
    return {
      ...summarize(component, workspace.slug),
      body_json: args.includeBody ? component.bodyJson : undefined,
    };
  },
});

export const find = internalQuery({
  args: {
    query: v.optional(v.string()),
    workspaceSlug: v.optional(v.string()),
    tag: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const workspace = args.workspaceSlug
      ? await ctx.db
          .query("workspaces")
          .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug as string))
          .unique()
      : null;
    if (args.workspaceSlug && !workspace) return [];

    const rows: Doc<"canvasComponents">[] = args.query
      ? await ctx.db
          .query("canvasComponents")
          .withSearchIndex("search_text", (q) => {
            const search = q.search("searchText", args.query as string);
            return workspace ? search.eq("workspaceId", workspace._id) : search;
          })
          .take(limit * 2)
      : workspace
        ? await ctx.db
            .query("canvasComponents")
            .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspace._id))
            .order("desc")
            .take(limit * 2)
        : await ctx.db.query("canvasComponents").order("desc").take(limit * 2);

    const filtered = args.tag
      ? rows.filter((row) => row.tags.includes(args.tag as string))
      : rows;
    const slugs = new Map<Id<"workspaces">, string>();
    const out = [];
    for (const row of filtered.slice(0, limit)) {
      let slug = slugs.get(row.workspaceId);
      if (slug === undefined) {
        slug = (await ctx.db.get(row.workspaceId))?.slug ?? "";
        slugs.set(row.workspaceId, slug);
      }
      out.push(summarize(row, slug));
    }
    return out;
  },
});

export const remove = internalMutation({
  args: { workspaceSlug: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug))
      .unique();
    const component = workspace
      ? await ctx.db
          .query("canvasComponents")
          .withIndex("by_workspace_slug", (q) =>
            q.eq("workspaceId", workspace._id).eq("slug", args.slug),
          )
          .unique()
      : null;
    if (!component) return { deleted: false };
    await ctx.db.delete(component._id);
    return { deleted: true };
  },
});
