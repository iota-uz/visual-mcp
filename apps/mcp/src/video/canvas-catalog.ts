import { z } from "zod";
import { parseAssetRef } from "../../../../convex/lib/assetRef.js";
import { parseRef } from "../../../../convex/lib/ref.js";
import type { AgentContext } from "../gateway.js";
import { internal } from "../refs.js";
import type { CapturedCanvasTool, McpPrincipal } from "../tools.js";
import { type VideoBackend, VideoDomainError, videoRegistry } from "./registry.js";

const obj = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
/** Per-request authenticated handler closures, never a global principal cache. */
export function attachCanvasCatalog(
  call: VideoBackend,
  ctx: AgentContext,
  principal: McpPrincipal,
  canvas: CapturedCanvasTool[],
) {
  call.catalog = {
    tools: [...canvas, ...videoRegistry],
    checkScope: async (name, input, workspaceId) => {
      let checked = false;
      const verify = (actual: unknown) => {
        if (actual !== workspaceId)
          throw new VideoDomainError(
            "SCOPE_MISMATCH",
            "Canvas target is outside the execute workspace; use a direct tool for intentional cross-workspace work.",
          );
        checked = true;
      };
      const slug = async (value: unknown) => {
        const row = await ctx.runQuery(internal.assets.getWorkspaceBySlug, {
          slug: z.string().parse(value),
        });
        verify(row?.workspaceId);
      };
      const ref = async (value: unknown) => {
        const parsed = parseRef(value);
        if (parsed.form === "slug") await slug(parsed.workspaceSlug);
        else {
          const row = await ctx.runQuery(internal.canvases.detailByRef, {
            ref: z.string().parse(value),
            includeDoc: false,
          });
          verify(row?.canvas.workspace_id);
        }
      };
      for (const key of ["ref", "source_ref", "destination_ref"])
        if (input[key]) await ref(input[key]);
      for (const key of ["workspace", "destination_workspace"])
        if (input[key]) await slug(input[key]);
      if (input.scope === "personal" || input.destination_scope === "personal")
        throw new VideoDomainError(
          "SCOPE_MISMATCH",
          "Personal-library operations require a direct tool outside a workspace-scoped execute run.",
        );
      if (input.asset_ref) {
        const asset = parseAssetRef(z.string().parse(input.asset_ref));
        if (asset.scope !== "workspace")
          throw new VideoDomainError(
            "SCOPE_MISMATCH",
            "Personal assets require direct inspection or import into the selected workspace.",
          );
        await slug(asset.workspaceSlug);
      }
      if (input.comment_id) {
        const scope = obj(await call("getCanvasCommentScope", { commentId: input.comment_id }));
        verify(scope.workspaceId);
      }
      if (name === "asset_finalize") {
        const items = Array.isArray(input.items) ? input.items : [input];
        for (const item of items) {
          const entry = obj(item);
          const upload = await ctx.runQuery(internal.assets.getUpload, {
            uploadId: z.string().parse(entry.upload_id) as never,
            userId: principal.userId,
            now: Date.now(),
          });
          verify(upload?.workspaceId);
        }
      }
      // This only reserves anonymous storage uploads; later canvas_save still has
      // its own workspace fence. It does not publish or write a library record.
      if (name === "canvas_upload_url") checked = true;
      if (!checked)
        throw new VideoDomainError(
          "SCOPE_REQUIRED",
          "This Canvas operation needs an explicit ref/workspace in execute. Use its direct tool for global discovery.",
        );
    },
  };
}
