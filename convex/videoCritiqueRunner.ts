"use node";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { JobRequest } from "../packages/video/src/jobs";
import { internalAction } from "./_generated/server";
import { sha256HexBytes } from "./lib/hash";
import { getObject, presignObject, putObject } from "./lib/objectStore";
import { readBoundedBody } from "./lib/videoBytes";
import { MAX_CRITIQUE_REPORT_BYTES } from "./lib/videoCritiqueLimits";
import type { ClaimedVideoJob } from "./lib/videoJobTypes";
import { processMedia } from "./lib/videoProcessing";
import { critique, ProviderFailure } from "./lib/videoProviderAdapters";
import { getWorkerConfig } from "./lib/worker";

const m = (name: string) => makeFunctionReference<"mutation">(name),
  q = (name: string) => makeFunctionReference<"query">(name);

import { compactCritiqueMetadata, completeCritique } from "./lib/videoCritiqueCompletion";
export const run = internalAction({
  args: { jobId: v.id("videoJobs"), admissionAttempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let job: ClaimedVideoJob | null = null;
    try {
      job = await ctx.runMutation(m("videoJobs:claim"), { jobId: args.jobId });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string }).code === "CAPACITY_EXCEEDED" &&
        (args.admissionAttempt ?? 0) < 30
      ) {
        await ctx.scheduler.runAfter(5000, makeFunctionReference<"action">("videoCritique:run"), {
          jobId: args.jobId,
          admissionAttempt: (args.admissionAttempt ?? 0) + 1,
        });
        return;
      }
      if (error instanceof ConvexError) {
        await ctx.runMutation(m("videoJobs:failAdmission"), {
          jobId: args.jobId,
          code: (error.data as { code?: string }).code ?? "ADMISSION_FAILED",
        });
        return;
      }
      throw error;
    }
    if (!job) return;
    let paid = false;
    try {
      const request = JobRequest.parse(job.request);
      if (request.kind !== "critique")
        throw new ProviderFailure("UNSUPPORTED_CAPABILITY", "not_applied");
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new ProviderFailure("PROVIDER_NOT_CONFIGURED", "not_applied");
      const models = (process.env.GEMINI_VIDEO_MODELS ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!models.includes(request.modelId))
        throw new ProviderFailure("MODEL_UNAVAILABLE", "not_applied");
      let source = await ctx.runQuery(q("videoProviders:source"), {
        jobId: job._id,
        ...request.asset,
      });
      const originalHash = source.contentHash;
      let analysisAsset = request.asset;
      let proxySampling: unknown = null;
      if (!["video/mp4", "video/webm"].includes(source.mimeType))
        throw new ProviderFailure("SOURCE_TYPE_MISMATCH", "not_applied");
      if (source.size > 12 * 1024 * 1024 || source.mimeType !== "video/mp4") {
        const processed = await processMedia(ctx, job, request.asset, {
          kind: "proxy",
          maxWidth: 720,
          fps: Math.min(4, request.samplingFps),
          maxOutputBytes: 12 * 1024 * 1024,
        });
        const proxy = processed.outputs.find((o) => o.name === "proxy");
        if (!proxy) throw new ProviderFailure("ANALYSIS_PROXY_FAILED", "not_applied");
        analysisAsset = proxy.asset;
        proxySampling = processed.sampling;
        source = await ctx.runQuery(q("videoProviders:source"), {
          jobId: job._id,
          ...analysisAsset,
        });
      }
      const worker = getWorkerConfig();
      const verified = await fetch(`${worker.url}/media/verify`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${worker.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceUrl: await presignObject(source.objectKey, "GET", 900),
          declaredMimeType: source.mimeType,
          maxBytes: source.size,
          expectedSize: source.size,
          expectedSha256: source.contentHash,
        }),
        signal: AbortSignal.timeout(540000),
      });
      if (!verified.ok) throw new ProviderFailure("SOURCE_VERIFICATION_FAILED", "not_applied");
      const media = (await verified.json()) as {
        durationMs: number;
        hasAudio: boolean;
        sha256: string;
      };
      if (media.sha256 !== source.contentHash || !Number.isFinite(media.durationMs))
        throw new ProviderFailure("SOURCE_HASH_MISMATCH", "not_applied");
      const response = await getObject(source.objectKey);
      if (!response.ok) throw new ProviderFailure("SOURCE_UNAVAILABLE", "not_applied");
      const bytes = await readBoundedBody(response, 12 * 1024 * 1024);
      if (bytes.length !== source.size || (await sha256HexBytes(bytes)) !== source.contentHash)
        throw new ProviderFailure("SOURCE_HASH_MISMATCH", "not_applied");
      await ctx.runMutation(m("videoJobs:markDispatch"), {
        jobId: job._id,
        fence: job.fence,
      });
      paid = true;
      const output = await critique(
        request,
        {
          bytes,
          durationMs: media.durationMs,
          hasAudio: media.hasAudio,
          sha256: source.contentHash,
          analysisLimitations: proxySampling
            ? [
                "Supplied media is a 720px-wide maximum, sampled/resized analysis proxy; audio may be downmixed/recompressed. It is not full-resolution original video.",
              ]
            : [],
        },
        key,
        models,
      );
      output.metadata.originalVideoSha256 = originalHash;
      output.metadata.analysisAsset = analysisAsset;
      output.metadata.proxySampling = proxySampling;
      const artifact = output.artifacts[0];
      if (!artifact) throw new ProviderFailure("CRITIQUE_REPORT_MISSING", "not_applied");
      const reportPayload = JSON.parse(new TextDecoder().decode(artifact.bytes));
      reportPayload.metadata = {
        ...reportPayload.metadata,
        ...output.metadata,
      };
      artifact.bytes = new TextEncoder().encode(JSON.stringify(reportPayload));
      if (artifact.bytes.length > MAX_CRITIQUE_REPORT_BYTES)
        throw new ProviderFailure("CRITIQUE_REPORT_TOO_LARGE", "partial");
      const objectKey = `video-results/${job._id}/${job.fence}/critique`,
        leaseId = `${job._id}:${job.fence}:critique`,
        sha256 = await sha256HexBytes(artifact.bytes);
      await ctx.runMutation(m("assets:acquireObjectLease"), {
        objectKey,
        leaseId,
      });
      await putObject(objectKey, artifact.bytes, "application/json");
      await ctx.runMutation(m("videoJobs:savePersistenceReceipt"), {
        jobId: job._id,
        fence: job.fence,
        receipt: {
          state: "persisted",
          kind: "critique",
          artifacts: [
            {
              role: "critique",
              objectKey,
              leaseId,
              sha256,
              sizeBytes: artifact.bytes.length,
              mimeType: "application/json",
            },
          ],
          metadata: JSON.stringify(compactCritiqueMetadata(output.metadata)),
          persistedRoles: ["critique"],
        },
      });
      const saved = await ctx.runMutation(m("assets:commitAssetVersion"), {
        scope: "workspace",
        ownerUserId: job.principalId,
        workspaceId: job.workspaceId,
        slug: `critique-${job._id}-${job.fence}`,
        name: "Video critique",
        tags: ["video-critique"],
        kind: "data",
        objectKey,
        contentHash: sha256,
        mimeType: "application/json",
        size: artifact.bytes.length,
        originalFilename: "critique.json",
        sourceType: "upload",
        objectLeaseId: leaseId,
        provenance: {
          kind: "provider",
          jobId: job._id,
          provider: "gemini",
          requestedModel: request.modelId,
          actualModel: output.metadata.actualModel,
          metadata: JSON.stringify(output.metadata),
        },
      });
      await completeCritique(ctx, job, request, saved, artifact, originalHash, output, media);
    } catch (error) {
      const failure = error instanceof ProviderFailure ? error : null;
      const current = await ctx.runQuery(q("videoShots:status"), {
        jobId: job._id,
      });
      if (current?.state === "succeeded") return;
      await ctx.runMutation(m("videoJobs:fail"), {
        jobId: job._id,
        fence: job.fence,
        code: failure?.code ?? "CRITIQUE_RESULT_UNKNOWN",
        outcomeUnknown: failure?.effect === "unknown" || (!failure && paid),
        effect: failure?.effect ?? (paid ? "unknown" : "not_applied"),
      });
    }
  },
});
