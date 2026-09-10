import type { FunctionReference } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

type GatewayFunction = FunctionReference<"query" | "mutation", "internal">;

const FUNCTIONS: Record<string, GatewayFunction> = {
  "assets:archiveByRef": internal.assets.archiveByRef,
  "assets:acquireObjectLease": internal.assets.acquireObjectLease,
  "assets:claimObjectDeletion": internal.assets.claimObjectDeletion,
  "assets:commitAssetVersion": internal.assets.commitAssetVersion,
  "assets:createUploads": internal.assets.createUploads,
  "assets:getUpload": internal.assets.getUpload,
  "assets:getWorkspace": internal.assets.getWorkspace,
  "assets:getWorkspaceBySlug": internal.assets.getWorkspaceBySlug,
  "assets:listInternal": internal.assets.listInternal,
  "assets:moveByRef": internal.assets.moveByRef,
  "assets:finishObjectDeletion": internal.assets.finishObjectDeletion,
  "assets:releaseObjectLease": internal.assets.releaseObjectLease,
  "assets:resolveRef": internal.assets.resolveRef,
  "assets:restoreByRef": internal.assets.restoreByRef,
  "canvases:attachCanvasRender": internal.canvases.attachCanvasRender,
  "canvases:bindAssetAndVersion": internal.canvases.bindAssetAndVersion,
  "canvases:changedPathsSinceVersion": internal.canvases.changedPathsSinceVersion,
  "canvases:checkpointByRef": internal.canvases.checkpointByRef,
  "canvases:commitFilePatch": internal.canvases.commitFilePatch,
  "canvases:commitSaveContent": internal.canvases.commitSaveContent,
  "canvases:currentDocStorageByRef": internal.canvases.currentDocStorageByRef,
  "canvases:currentNodeByRef": internal.canvases.currentNodeByRef,
  "canvases:currentVersion": internal.canvases.currentVersion,
  "canvases:detailByRef": internal.canvases.detailByRef,
  "canvases:detailFacetPageByRef": internal.canvases.detailFacetPageByRef,
  "canvases:findCanvasNodes": internal.canvases.findCanvasNodes,
  "canvases:findCanvases": internal.canvases.findCanvases,
  "canvases:findWorkspaces": internal.canvases.findWorkspaces,
  "canvases:getEditableFileByRef": internal.canvases.getEditableFileByRef,
  "canvases:getSnapshotCache": internal.canvases.getSnapshotCache,
  "canvases:listAssetBindingPaths": internal.canvases.listAssetBindingPaths,
  "canvases:listFilesForCanvas": internal.canvases.listFilesForCanvas,
  "canvases:listSourcesForVersion": internal.canvases.listSourcesForVersion,
  "canvases:logRender": internal.canvases.logRender,
  "canvases:putSnapshotCache": internal.canvases.putSnapshotCache,
  "canvases:promotedUploadReplay": internal.canvases.promotedUploadReplay,
  "canvases:recordExecArtifacts": internal.canvases.recordExecArtifacts,
  "canvases:removeByRef": internal.canvases.removeByRef,
  "canvases:snapshotContextByRef": internal.canvases.snapshotContextByRef,
  "canvases:storageAttachment": internal.canvases.storageAttachment,
  "canvases:upsertByRef": internal.canvases.upsertByRef,
  "embeds:requestPreparation": internal.embeds.requestPreparation,
  "embeds:resolveContextByRef": internal.embeds.resolveContextByRef,
  "comments:complete": internal.comments.complete,
  "comments:create": internal.comments.create,
  "comments:list": internal.comments.list,
  "comments:openCount": internal.comments.openCount,
  "comments:reply": internal.comments.reply,
  "comments:resolveId": internal.comments.resolveId,
  "comments:setStatus": internal.comments.setStatus,
  "workspaces:getThemeBySlug": internal.workspaces.getThemeBySlug,
};

const QUERIES = new Set([
  "assets:getUpload",
  "assets:getWorkspace",
  "assets:getWorkspaceBySlug",
  "assets:listInternal",
  "assets:resolveRef",
  "canvases:changedPathsSinceVersion",
  "canvases:currentDocStorageByRef",
  "canvases:currentNodeByRef",
  "canvases:currentVersion",
  "canvases:detailByRef",
  "canvases:detailFacetPageByRef",
  "canvases:findCanvasNodes",
  "canvases:findCanvases",
  "canvases:findWorkspaces",
  "canvases:getEditableFileByRef",
  "canvases:getSnapshotCache",
  "canvases:listAssetBindingPaths",
  "canvases:listFilesForCanvas",
  "canvases:listSourcesForVersion",
  "canvases:promotedUploadReplay",
  "canvases:snapshotContextByRef",
  "canvases:storageAttachment",
  "embeds:resolveContextByRef",
  "comments:list",
  "comments:openCount",
  "comments:resolveId",
  "workspaces:getThemeBySlug",
]);

function secret(): string {
  const value = process.env.AGENT_GATEWAY_SECRET;
  if (!value) throw new Error("AGENT_GATEWAY_SECRET is not configured");
  return value;
}

function authorized(request: Request): boolean {
  return request.headers.get("authorization") === `Bearer ${secret()}`;
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function handleAgentGateway(ctx: ActionCtx, request: Request): Promise<Response> {
  if (!authorized(request)) return jsonError(401, "Unauthorized");
  const body = (await request.json().catch(() => null)) as {
    operation?: unknown;
    name?: unknown;
    args?: unknown;
  } | null;
  if (!body || typeof body.operation !== "string") return jsonError(400, "Invalid request");

  try {
    if (body.operation === "video") {
      const value = body.args as {
        tokenId?: unknown;
        name?: unknown;
        input?: unknown;
      } | null;
      const methods: Record<
        string,
        { method: string; kind: "query" | "mutation" | "action"; readOnly?: boolean }
      > = {
        prepareUpload: {
          method: "videoMedia:agentPrepareUpload",
          kind: "action",
        },
        listVoices: {
          method: "videoCapabilities:agentListVoices",
          kind: "action",
          readOnly: true,
        },
        resolveRubric: {
          method: "videoCapabilities:agentResolveRubric",
          kind: "action",
          readOnly: true,
        },
        getCapabilities: {
          method: "videoCapabilities:agentGetCapabilities",
          kind: "action",
          readOnly: true,
        },
        getMemory: { method: "videoLearning:agentGetMemory", kind: "query" },
        getMemoryRecord: {
          method: "videoLearning:agentGetMemoryRecord",
          kind: "query",
        },
        proposeMemory: {
          method: "videoLearning:agentProposeMemory",
          kind: "mutation",
        },
        recordPublication: {
          method: "videoLearning:agentRecordPublication",
          kind: "mutation",
        },
        getPublication: {
          method: "videoLearning:agentGetPublication",
          kind: "query",
        },
        getAnalytics: {
          method: "videoLearning:agentGetAnalytics",
          kind: "query",
        },
        getEval: { method: "videoLearning:agentGetEval", kind: "query" },
        reconcileJob: {
          method: "videoRecovery:agentReconcile",
          kind: "action",
        },
        finalizeUpload: {
          method: "videoMedia:agentFinalizeUpload",
          kind: "action",
        },
        getUpload: { method: "videoMedia:agentGetUpload", kind: "query" },
        addReply: { method: "videoReview:agentAddReply", kind: "mutation" },
        createProject: { method: "agentCreateProject", kind: "mutation" },
        getProject: { method: "agentGetProject", kind: "query" },
        listProjects: { method: "agentListProjects", kind: "query" },
        getDraft: { method: "agentGetDraft", kind: "query" },
        patchScript: { method: "agentPatchScript", kind: "mutation" },
        patchTimeline: { method: "agentPatchTimeline", kind: "mutation" },
        checkpoint: { method: "agentCheckpoint", kind: "mutation" },
        listVersions: { method: "agentListVersions", kind: "query" },
        getVersion: { method: "agentGetVersion", kind: "query" },
        getCanvasCommentScope: { method: "agentGetCanvasCommentScope", kind: "query" },
        submitJob: { method: "videoJobs:agentSubmit", kind: "mutation" },
        getContext: { method: "videoWorkflow:agentGetContext", kind: "query" },
        getProfile: { method: "videoWorkflow:agentGetProfile", kind: "query" },
        patchProfile: {
          method: "videoWorkflow:agentPatchProfile",
          kind: "mutation",
        },
        getLoop: { method: "videoWorkflow:agentGetLoop", kind: "query" },
        loopPropose: { method: "videoWorkflow:agentPropose", kind: "mutation" },
        loopSelect: { method: "videoWorkflow:agentSelect", kind: "mutation" },
        loopPause: { method: "videoWorkflow:agentPause", kind: "mutation" },
        loopResume: { method: "videoWorkflow:agentResume", kind: "mutation" },
        listComments: {
          method: "videoReview:agentListComments",
          kind: "query",
        },
        createComment: {
          method: "videoReview:agentCreateComment",
          kind: "mutation",
        },
        setCommentStatus: {
          method: "videoReview:agentSetCommentStatus",
          kind: "mutation",
        },
        reanchorComment: {
          method: "videoReview:agentReanchorComment",
          kind: "mutation",
        },
        getJob: { method: "videoJobs:agentGetJob", kind: "query" },
        listJobs: { method: "videoJobs:agentListJobs", kind: "query" },
        inspectAsset: { method: "videoMedia:agentPreviewAsset", kind: "action", readOnly: true },
        getVideoComment: { method: "videoReview:agentGetComment", kind: "query" },
        getVideoCommentReplies: { method: "videoReview:agentReplies", kind: "query" },
        lookupJob: { method: "videoJobs:agentLookupJob", kind: "query" },
        getJobEffects: { method: "videoJobs:agentGetEffects", kind: "query" },
        getJobEffect: { method: "videoJobs:agentGetEffect", kind: "query" },
        cancelJob: { method: "videoJobs:agentCancel", kind: "mutation" },
        claimJob: { method: "videoJobs:claim", kind: "mutation" },
        recordEffect: { method: "videoJobs:recordEffect", kind: "mutation" },
        completeJob: { method: "videoJobs:complete", kind: "mutation" },
        failJob: { method: "videoJobs:fail", kind: "mutation" },
      };
      if (
        !value ||
        typeof value.tokenId !== "string" ||
        typeof value.name !== "string" ||
        !Object.hasOwn(methods, value.name) ||
        !value.input ||
        typeof value.input !== "object" ||
        Array.isArray(value.input)
      )
        return jsonError(400, "Invalid video request");
      try {
        const principal = await ctx.runQuery(
          makeFunctionReference<"query">("video:agentPrincipal"),
          { tokenId: value.tokenId as Id<"mcpTokens">, now: Date.now() },
        );
        if (!principal)
          return Response.json({
            result: {
              ok: false,
              error: {
                code: "NOT_FOUND_OR_FORBIDDEN",
                message: "Token unavailable or expired",
                effect: "not_applied",
              },
            },
          });
        const selected = methods[value.name]!;
        const functionName = selected.method.includes(":")
          ? selected.method
          : `video:${selected.method}`;
        const args = { ...value.input, videoPrincipalId: principal };
        const data =
          selected.kind === "query"
            ? await ctx.runQuery(makeFunctionReference<"query">(functionName), args)
            : selected.kind === "action"
              ? await ctx.runAction(makeFunctionReference<"action">(functionName), args)
              : await ctx.runMutation(makeFunctionReference<"mutation">(functionName), args);
        return Response.json({ result: { ok: true, data } });
      } catch (error) {
        // Deliberately no raw argument/provider response logging on this boundary.
        const safe =
          error instanceof ConvexError && typeof error.data === "object" && error.data !== null
            ? error.data
            : {
                code: "BACKEND_UNAVAILABLE",
                message:
                  "Backend outcome unavailable; inspect the original operation before resubmitting",
                effect:
                  methods[value.name]?.kind === "query" || methods[value.name]?.readOnly
                    ? "none"
                    : "unknown",
                recovery: {
                  kind: "inspect_operation",
                  message:
                    "Reuse the original idempotency key to look up the durable operation; do not assume it was not applied",
                },
              };
        return Response.json({ result: { ok: false, error: safe } });
      }
    }
    if (body.operation === "authenticate") {
      const tokenHash =
        typeof body.args === "object" && body.args && "tokenHash" in body.args
          ? (body.args as { tokenHash?: unknown }).tokenHash
          : undefined;
      if (typeof tokenHash !== "string") return jsonError(400, "Invalid token hash");
      const principal = await ctx.runQuery(internal.tokens.verify, {
        tokenHash,
        now: Date.now(),
      });
      if (principal) {
        await ctx.scheduler.runAfter(0, internal.tokens.touchLastUsed, {
          tokenId: principal.tokenId,
        });
      }
      return Response.json({ result: principal });
    }

    if (body.operation === "query" || body.operation === "mutation") {
      if (typeof body.name !== "string") return jsonError(400, "Function name is required");
      const fn = FUNCTIONS[body.name];
      const actualOperation = QUERIES.has(body.name) ? "query" : "mutation";
      if (!fn || actualOperation !== body.operation)
        return jsonError(404, "Function is not exposed");
      const args = body.args && typeof body.args === "object" ? body.args : {};
      const result =
        body.operation === "query"
          ? await ctx.runQuery(fn as FunctionReference<"query", "internal">, args)
          : await ctx.runMutation(fn as FunctionReference<"mutation", "internal">, args);
      return Response.json({ result });
    }

    if (body.operation === "storage.generateUploadUrl") {
      return Response.json({ result: await ctx.storage.generateUploadUrl() });
    }
    const storageId =
      typeof body.args === "object" && body.args && "storageId" in body.args
        ? (body.args as { storageId?: unknown }).storageId
        : undefined;
    if (typeof storageId !== "string") return jsonError(400, "storageId is required");
    if (body.operation === "storage.getUrl") {
      return Response.json({ result: await ctx.storage.getUrl(storageId) });
    }
    if (body.operation === "storage.getMetadata") {
      return Response.json({
        result: await ctx.storage.getMetadata(storageId),
      });
    }
    if (body.operation === "storage.delete") {
      await ctx.storage.delete(storageId);
      return Response.json({ result: null });
    }
    return jsonError(404, "Operation is not exposed");
  } catch (error) {
    console.error("Agent gateway request failed", error);
    return jsonError(500, error instanceof Error ? error.message : "Gateway request failed");
  }
}
