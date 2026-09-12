import { query } from "./_generated/server";
import { requireIotaIdentity } from "./lib/auth";

const READ_CAP = 200;
const ITEM_CAP = 24;

/**
 * Human attention across canvas comments and video loops. Completed
 * comments are the agent's claim waiting on a person; awaiting_human loops
 * are the same job in Video Studio.
 */
export const needsYou = query({
  args: {},
  handler: async (ctx) => {
    await requireIotaIdentity(ctx);

    const comments = (await ctx.db.query("canvasComments").take(READ_CAP))
      .filter((row) => row.status === "completed")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, ITEM_CAP);

    const loops = (await ctx.db.query("videoLoops").take(READ_CAP))
      .filter((row) => row.state === "awaiting_human")
      .slice(0, ITEM_CAP);

    const commentItems = await Promise.all(
      comments.map(async (row) => {
        const canvas = await ctx.db.get(row.canvasId);
        if (!canvas || canvas.archivedAt !== undefined) return null;
        const workspace = await ctx.db.get(canvas.workspaceId);
        if (!workspace || workspace.archivedAt !== undefined) return null;
        const page = row.pageId ? `&page=${encodeURIComponent(row.pageId)}` : "";
        return {
          kind: "comment" as const,
          id: row._id,
          title: canvas.title,
          detail: row.completion?.summary ?? row.body,
          href: `/c/${canvas._id}?comments=1${page}`,
          workspace: workspace.name,
        };
      }),
    );

    const loopItems = await Promise.all(
      loops.map(async (row) => {
        const project = await ctx.db.get(row.projectId);
        if (!project) return null;
        const workspace = await ctx.db.get(row.workspaceId);
        if (!workspace || workspace.archivedAt !== undefined) return null;
        return {
          kind: "loop" as const,
          id: row._id,
          title: project.title,
          detail: `${row.language.toUpperCase()} needs review`,
          href: `/v/${project._id}?production=1`,
          workspace: workspace.name,
        };
      }),
    );

    const items = [...commentItems, ...loopItems].filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    return { count: items.length, items };
  },
});
