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
import { requireIotaIdentity, requireUserId } from "./lib/auth";
import { purgeWorkspace } from "./lib/purge";
import { slugify } from "./lib/slug";

async function latestVideoPoster(ctx: QueryCtx, projectId: Id<"videoProjects">) {
  const jobs = await ctx.db
    .query("videoJobs")
    .withIndex("by_projectId_and_state", (q) =>
      q.eq("projectId", projectId).eq("state", "succeeded"),
    )
    .take(16);
  const renders = jobs
    .filter((job) => job.kind === "render" && job.result)
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const job of renders) {
    try {
      const parsed = JSON.parse(job.result ?? "") as {
        poster?: { assetId?: string; revisionId?: string };
      };
      if (parsed.poster?.assetId && parsed.poster.revisionId) {
        return { assetId: parsed.poster.assetId, revisionId: parsed.poster.revisionId };
      }
    } catch {}
  }
  return null;
}

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
const RECENT_PER_WORKSPACE = 3;

/*
 * Each row carries what the home page's card actually shows: how many
 * canvases and videos are in it, and a strip of the few touched most
 * recently — mixed, because those collections are peers.
 */
async function listWorkspaces(ctx: QueryCtx) {
  const rows = (await ctx.db.query("workspaces").take(200)).filter(
    (w) => w.archivedAt === undefined,
  );

  return Promise.all(
    rows.map(async (w) => {
      const canvases = (
        await ctx.db
          .query("canvases")
          .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", w._id))
          .order("desc")
          .take(200)
      ).filter((c) => c.archivedAt === undefined);

      const videos = await ctx.db
        .query("videoProjects")
        .withIndex("by_workspaceId_and_updatedAt", (q) => q.eq("workspaceId", w._id))
        .order("desc")
        .take(200);

      const recent: Array<
        | {
            type: "canvas";
            canvas_id: Id<"canvases">;
            title: string;
            kind: string;
            thumbnail_url: string | null;
            poster: (typeof canvases)[number]["poster"];
            static_render_status: string;
          }
        | {
            type: "video";
            projectId: Id<"videoProjects">;
            title: string;
            workspaceId: Id<"workspaces">;
            poster: { assetId: string; revisionId: string } | null;
          }
      > = [];
      let canvasIndex = 0;
      let videoIndex = 0;
      while (
        recent.length < RECENT_PER_WORKSPACE &&
        (canvasIndex < canvases.length || videoIndex < videos.length)
      ) {
        const canvas = canvases[canvasIndex];
        const video = videos[videoIndex];
        const takeCanvas =
          video === undefined || (canvas !== undefined && canvas.updatedAt >= video.updatedAt);
        if (takeCanvas && canvas) {
          recent.push({
            type: "canvas",
            canvas_id: canvas._id,
            title: canvas.title,
            kind: canvas.kind,
            thumbnail_url: canvas.thumbnailId ? await ctx.storage.getUrl(canvas.thumbnailId) : null,
            poster: canvas.poster ?? null,
            static_render_status: canvas.staticRenderStatus ?? "ready",
          });
          canvasIndex += 1;
        } else if (video) {
          recent.push({
            type: "video",
            projectId: video._id,
            title: video.title,
            workspaceId: w._id,
            poster: await latestVideoPoster(ctx, video._id),
          });
          videoIndex += 1;
        } else {
          break;
        }
      }

      return {
        workspace_id: w._id,
        slug: w.slug,
        name: w.name,
        description: w.description,
        canvas_count: canvases.length,
        video_count: videos.length,
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

export const getThemeBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!workspace || workspace.archivedAt !== undefined) return null;
    return { themeId: "clean-saas" as const, brand: workspace.brand };
  },
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
    const userId = await requireUserId(ctx, identity);
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

/* --- Curator surface: rename, archive, delete ------------------------- */

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
      videos_deleted: totals.videosDeleted,
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
