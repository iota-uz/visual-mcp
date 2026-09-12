import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireIotaIdentity } from "./lib/auth";

const TITLE_LIMIT = 8;
const NODE_LIMIT = 12;

/**
 * Home catalog search. Titles first (workspaces, canvases, videos), then
 * canvas nodes. Node-only grep was the previous whole product.
 */
export const searchMine = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const raw = args.query.trim();
    const needle = raw.toLowerCase();
    if (!needle) {
      return { workspaces: [], canvases: [], videos: [], nodes: [] };
    }

    const workspaces = (await ctx.db.query("workspaces").take(200))
      .filter(
        (workspace) =>
          workspace.archivedAt === undefined &&
          [workspace.name, workspace.slug, workspace.description ?? ""].some((field) =>
            field.toLowerCase().includes(needle),
          ),
      )
      .slice(0, TITLE_LIMIT)
      .map((workspace) => ({
        workspaceId: workspace._id,
        slug: workspace.slug,
        name: workspace.name,
      }));

    const canvases = (await ctx.db.query("canvases").take(400))
      .filter(
        (canvas) =>
          canvas.archivedAt === undefined &&
          [canvas.title, canvas.slug].some((field) => field.toLowerCase().includes(needle)),
      )
      .slice(0, TITLE_LIMIT)
      .map((canvas) => ({
        canvasId: canvas._id,
        title: canvas.title,
        kind: canvas.kind,
        workspaceId: canvas.workspaceId,
      }));

    const videos = (await ctx.db.query("videoProjects").take(200))
      .filter((project) => project.title.toLowerCase().includes(needle))
      .slice(0, TITLE_LIMIT)
      .map((project) => ({
        projectId: project._id,
        title: project.title,
        workspaceId: project.workspaceId,
      }));

    const rows = await ctx.db
      .query("canvasNodes")
      .withSearchIndex("search_text", (q) => q.search("searchText", raw))
      .take(NODE_LIMIT);

    const nodes = (
      await Promise.all(
        rows.map(async (row) => {
          if (row.entity !== "node") return null;
          const canvas = await ctx.db.get(row.canvasId);
          if (!canvas || canvas.currentVersionId !== row.versionId) return null;
          return {
            canvasId: row.canvasId,
            canvasTitle: canvas.title,
            workspaceId: canvas.workspaceId,
            nodeId: row.entityId,
            nodeTitle: row.title,
            nodeEyebrow: row.eyebrow,
          };
        }),
      )
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    return { workspaces, canvases, videos, nodes };
  },
});
