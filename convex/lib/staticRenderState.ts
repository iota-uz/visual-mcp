import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function recomputeCanvasStaticRenderState(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
): Promise<void> {
  const [recipes, embeds] = await Promise.all([
    ctx.db
      .query("canvasRenderRecipes")
      .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
      .take(100),
    ctx.db
      .query("canvasEmbeds")
      .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
      .take(500),
  ]);
  const rows = [...recipes, ...embeds];
  if (rows.length === 0) return;
  const error = rows.find((row) => row.status === "error");
  const status = error
    ? "error"
    : rows.some((row) => row.status === "updating")
      ? "updating"
      : rows.some((row) => row.status === "queued")
        ? "queued"
        : rows.some(
              (row) => row.status === "stale" || row.completedGeneration !== row.desiredGeneration,
            )
          ? "stale"
          : "ready";
  await ctx.db.patch(canvasId, {
    staticRenderStatus: status,
    staticRenderError: error?.errorText?.slice(0, 500),
    staticRenderUpdatedAt: Date.now(),
  });
}
