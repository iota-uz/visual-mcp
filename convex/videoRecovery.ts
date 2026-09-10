import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { JobRequest } from "../packages/video/src/jobs";
import { VideoRenderResult } from "../packages/video/src/media";
import { MediaProcessResult } from "../packages/video/src/operations";
import { action, internalAction, internalMutation } from "./_generated/server";
import { presignObject } from "./lib/objectStore";
import { getWorkerConfig } from "./lib/worker";
import { completeRender } from "./videoRender";

const m = (name: string) => makeFunctionReference<"mutation">(name),
  q = (name: string) => makeFunctionReference<"query">(name);
export const admit = internalMutation({
  args: { jobId: v.id("videoJobs"), fence: v.number() },
  handler: async (ctx, args) => {
    const j = await ctx.db.get(args.jobId);
    if (!j || j.fence !== args.fence || j.stage !== "reconciling") return false;
    await ctx.db.patch(j._id, { stage: "recovering_bytes" });
    return true;
  },
});
export const begin = internalMutation({
  args: { jobId: v.id("videoJobs"), principalId: v.id("users") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.principalId !== args.principalId)
      throw new ConvexError({
        code: "NOT_FOUND_OR_FORBIDDEN",
        effect: "not_applied",
      });
    if (job.state === "succeeded") return { jobId: job._id, state: job.state };
    if (
      !["failed", "outcome_unknown"].includes(job.state) ||
      !job.persistenceReceipt ||
      !["image", "voice", "render", "shot", "media", "critique"].includes(job.kind)
    )
      throw new ConvexError({
        code: "RECOVERY_UNAVAILABLE",
        message:
          "No completed persistence receipt; inspect known provider status, never repeat paid submission",
        effect: "not_applied",
      });
    const fence = job.fence + 1;
    await ctx.db.patch(job._id, {
      fence,
      state: "running",
      stage: "reconciling",
      errorCode: undefined,
      errorEffect: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"action">(
        job.kind === "shot" ? "videoShots:poll" : "videoRecovery:run",
      ),
      { jobId: job._id, fence, ...(job.kind === "shot" ? { attempt: 0 } : {}) },
    );
    await ctx.scheduler.runAfter(
      900000,
      makeFunctionReference<"mutation">("videoJobs:expireClaim"),
      { jobId: job._id, fence },
    );
    return { jobId: job._id, state: "running" };
  },
});
export const reconcile = action({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) =>
    ctx.runMutation(m("videoRecovery:begin"), {
      ...args,
      principalId: await ctx.runQuery(q("videoMedia:principal"), {}),
    }),
});
export const agentReconcile = internalAction({
  args: { jobId: v.id("videoJobs"), videoPrincipalId: v.id("users") },
  handler: async (ctx, { videoPrincipalId, ...args }) =>
    ctx.runMutation(m("videoRecovery:begin"), {
      ...args,
      principalId: videoPrincipalId,
    }),
});
/** Recovery reads known stored bytes only: no provider endpoint or rendering calls. */
export const run = internalAction({
  args: { jobId: v.id("videoJobs"), fence: v.number() },
  handler: async (ctx, args) => {
    if (!(await ctx.runMutation(m("videoRecovery:admit"), args))) return;
    const job = await ctx.runQuery(q("videoShots:status"), {
      jobId: args.jobId,
    });
    if (
      !job ||
      job.fence !== args.fence ||
      job.stage !== "recovering_bytes" ||
      !job.persistenceReceipt
    )
      return;
    try {
      const receipt = JSON.parse(job.persistenceReceipt);
      if (job.kind === "critique") {
        await ctx.runAction(makeFunctionReference<"action">("videoCritiqueRecovery:run"), args);
        return;
      }
      const render = job.kind === "render" ? VideoRenderResult.parse(receipt.result) : null;
      const processing = job.kind === "media" ? MediaProcessResult.parse(receipt.result) : null;
      const staged: {
        objectKey: string;
        role: string;
        sha256: string;
        sizeBytes: number;
        mimeType: string;
      }[] = render
        ? ["video", "poster", "captions"].map((name) => ({
            objectKey: receipt.keys[name],
            role: name,
            ...render[name as "video" | "poster" | "captions"],
          }))
        : processing
          ? processing.outputs.map((o) => ({
              ...o,
              role: o.name,
              objectKey: receipt.keys[o.name],
            }))
          : receipt.staged;
      if (!Array.isArray(staged) || staged.length < 1 || staged.length > 32)
        throw new Error("Invalid persisted receipt");
      const worker = getWorkerConfig();
      const recoveryRequest = JobRequest.parse(JSON.parse(job.request));
      const editTarget =
        recoveryRequest.kind === "image" && recoveryRequest.editTarget
          ? await ctx.runQuery(q("videoProviders:editTarget"), {
              jobId: job._id,
              ...recoveryRequest.editTarget,
            })
          : null;
      const artifacts: {
        role: string;
        asset: { assetId: string; revisionId: string };
        sha256: string;
        mimeType: string;
        sizeBytes: number;
        headAdvanced?: boolean;
      }[] = [];
      for (const artifact of staged) {
        const response = await fetch(`${worker.url}/media/verify`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${worker.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sourceUrl: await presignObject(artifact.objectKey, "GET", 900),
            declaredMimeType: artifact.mimeType,
            maxBytes: artifact.sizeBytes,
            expectedSize: artifact.sizeBytes,
            expectedSha256: artifact.sha256,
          }),
          signal: AbortSignal.timeout(540000),
        });
        if (!response.ok) throw new Error("Stored output unavailable");
        const data = (await response.json()) as {
          sha256: string;
          sizeBytes: number;
          mimeType: string;
          kind: string;
        };
        if (
          data.sha256 !== artifact.sha256 ||
          data.sizeBytes !== artifact.sizeBytes ||
          data.mimeType !== artifact.mimeType
        )
          throw new Error("Stored output mismatch");
        const leaseId = `recovery:${job._id}:${job.fence}:${artifact.role}`;
        await ctx.runMutation(m("assets:acquireObjectLease"), {
          objectKey: artifact.objectKey,
          leaseId,
        });
        const originalFence = render?.fence ?? artifact.objectKey.split("/")[2];
        const saved = await ctx.runMutation(m("assets:commitAssetVersion"), {
          scope: "workspace",
          ownerUserId: job.principalId,
          workspaceId: job.workspaceId,
          slug: processing
            ? `media-${job._id}-${originalFence}-${processing.kind}-${artifact.role}`
            : `${render ? "render" : "generated"}-${job._id}-${originalFence}-${artifact.role}`,
          name: `Recovered ${artifact.role}`,
          tags: [render ? "video-render" : "video-generation"],
          kind: data.kind,
          mediaMetadata: verifiedMediaMetadata(data),
          objectKey: artifact.objectKey,
          contentHash: artifact.sha256,
          mimeType: artifact.mimeType,
          size: artifact.sizeBytes,
          originalFilename: artifact.role,
          sourceType: "upload",
          objectLeaseId: leaseId,
          ...(editTarget && recoveryRequest.kind === "image" && recoveryRequest.editTarget
            ? {
                scope: editTarget.scope,
                workspaceId: editTarget.workspaceId,
                slug: editTarget.slug,
                name: editTarget.name,
                description: editTarget.description,
                tags: editTarget.tags,
                expectedHeadVersionId: recoveryRequest.editTarget.expectedRevisionId,
                candidateSlug: `candidate-${job._id}-${originalFence}`,
              }
            : {}),
          provenance: processing
            ? {
                kind: "render",
                jobId: job._id,
                metadata: JSON.stringify({
                  operation: processing.kind,
                  source: processing.source,
                  sourceSha256: processing.sourceSha256,
                  sampling: processing.sampling,
                }),
              }
            : render
              ? {
                  kind: "render",
                  jobId: job._id,
                  metadata: JSON.stringify({
                    versionId: job.versionId,
                    partial: render.partial,
                    engine: render.engine ?? null,
                  }),
                }
              : {
                  kind: "provider",
                  jobId: job._id,
                  provider: receipt.metadata.provider,
                  requestedModel: receipt.metadata.requestedModel,
                  actualModel: receipt.metadata.actualModel,
                  metadata: JSON.stringify(receipt.metadata),
                },
        });
        artifacts.push({
          role: artifact.role,
          asset: { assetId: saved.assetId, revisionId: saved.versionId },
          sha256: artifact.sha256,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          ...(saved.headAdvanced !== undefined ? { headAdvanced: saved.headAdvanced } : {}),
        });
      }
      const result = render
        ? {
            kind: "render",
            versionId: job.versionId,
            ...Object.fromEntries(artifacts.map((a) => [a.role, a.asset])),
            sha256: render.video.sha256,
            partial: render.partial,
            metadata: {
              width: render.video.width,
              height: render.video.height,
              durationMs: render.video.durationMs,
              fps: render.video.fps,
            },
            checks: render.checks,
          }
        : processing
          ? {
              ...processing,
              kind: "media",
              operation: processing.kind,
              outputs: processing.outputs.map((output) => ({
                ...output,
                asset: artifacts.find((a) => a.role === output.name)!.asset,
              })),
            }
          : {
              kind: job.kind,
              artifacts,
              metadata: receipt.metadata,
              partial: receipt.metadata.partial === true,
            };
      if (render) {
        const request = JobRequest.parse(JSON.parse(job.request));
        if (request.kind !== "render" || !job.versionId)
          throw new Error("Render recovery scope missing");
        await completeRender(
          ctx,
          { jobId: job._id },
          job.fence,
          render,
          Object.fromEntries(artifacts.map((a) => [a.role, a.asset])),
          { job, version: { _id: job.versionId } },
          { request },
        );
        return;
      }
      await ctx.runMutation(m("videoJobs:complete"), {
        jobId: job._id,
        fence: job.fence,
        result,
      });
    } catch {
      await ctx.runMutation(m("videoJobs:fail"), {
        jobId: job._id,
        fence: job.fence,
        code: "RESULT_PERSISTENCE_FAILED",
        outcomeUnknown: false,
        effect: "partial",
      });
    }
  },
});

import { verifiedMediaMetadata } from "./lib/videoAssetMetadata";
