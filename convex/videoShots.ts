import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { JobRequest } from "../packages/video/src/jobs";
import { internalAction, internalQuery } from "./_generated/server";
import { presignObject } from "./lib/objectStore";
import type { ClaimedVideoJob } from "./lib/videoJobTypes";
import { cancelShot, ProviderFailure, pollShot, submitShot } from "./lib/videoProviderAdapters";
import { getWorkerConfig } from "./lib/worker";

const m = (name: string) => makeFunctionReference<"mutation">(name),
  q = (name: string) => makeFunctionReference<"query">(name);
export const status = internalQuery({
  args: { jobId: v.id("videoJobs") },
  handler: (ctx, args) => ctx.db.get(args.jobId),
});
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
        await ctx.scheduler.runAfter(5000, makeFunctionReference<"action">("videoShots:run"), {
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
    let dispatched = false;
    try {
      const request = JobRequest.parse(job.request);
      if (request.kind !== "shot")
        throw new ProviderFailure("UNSUPPORTED_CAPABILITY", "not_applied");
      const keyId = process.env.HIGGSFIELD_API_KEY_ID,
        keySecret = process.env.HIGGSFIELD_API_KEY_SECRET;
      if (!keyId || !keySecret) throw new ProviderFailure("PROVIDER_NOT_CONFIGURED", "not_applied");
      getWorkerConfig();
      const source = await ctx.runQuery(q("videoProviders:source"), {
        jobId: job._id,
        ...request.startImage,
      });
      if (!source.mimeType.startsWith("image/"))
        throw new ProviderFailure("SOURCE_TYPE_MISMATCH", "not_applied");
      await ctx.runMutation(m("videoJobs:markDispatch"), {
        jobId: job._id,
        fence: job.fence,
      });
      dispatched = true;
      const receipt = await submitShot(
        request,
        await presignObject(source.objectKey, "GET", 900),
        keyId,
        keySecret,
      );
      await ctx.runMutation(m("videoJobs:savePersistenceReceipt"), {
        jobId: job._id,
        fence: job.fence,
        receipt: {
          state: "reserved",
          kind: "shot",
          artifacts: [],
          provider: {
            requestId: receipt.request_id,
            ...(receipt.status_url ? { statusUrl: receipt.status_url } : {}),
            ...(receipt.cancel_url ? { cancelUrl: receipt.cancel_url } : {}),
          },
        },
      });
      await ctx.runMutation(m("videoJobs:markDispatch"), {
        jobId: job._id,
        fence: job.fence,
        providerRequestId: receipt.request_id,
      });
      await ctx.scheduler.runAfter(10000, makeFunctionReference<"action">("videoShots:poll"), {
        jobId: job._id,
        fence: job.fence,
        attempt: 0,
      });
    } catch (error) {
      const failure = error instanceof ProviderFailure ? error : null;
      await ctx.runMutation(m("videoJobs:fail"), {
        jobId: job._id,
        fence: job.fence,
        code: failure?.code ?? "PROVIDER_SUBMISSION_UNKNOWN",
        outcomeUnknown: failure?.effect === "unknown" || (!failure && dispatched),
        effect: failure?.effect ?? (dispatched ? "unknown" : "not_applied"),
      });
    }
  },
});
export const poll = internalAction({
  args: { jobId: v.id("videoJobs"), fence: v.number(), attempt: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(q("videoShots:status"), {
      jobId: args.jobId,
    });
    if (
      !job ||
      job.fence !== args.fence ||
      !["running", "cancel_requested"].includes(job.state) ||
      !job.persistenceReceipt
    )
      return;
    const savedReceipt = job.persistenceReceipt;
    const receipt = savedReceipt.provider;
    if (!receipt?.statusUrl) return;
    try {
      const keyId = process.env.HIGGSFIELD_API_KEY_ID ?? "",
        keySecret = process.env.HIGGSFIELD_API_KEY_SECRET ?? "";
      if (
        (job.state === "cancel_requested" || job.cancelRequestedAt !== undefined) &&
        receipt.cancelUrl
      ) {
        const cancellation = await cancelShot(receipt.cancelUrl, keyId, keySecret);
        if (cancellation === "cancelled_before_start") {
          await ctx.runMutation(m("videoJobs:confirmCancelled"), {
            jobId: job._id,
            fence: job.fence,
          });
          return;
        }
      }
      const status = await pollShot(receipt.statusUrl, keyId, keySecret);
      if (status.request_id !== receipt.requestId) throw new Error("Provider identity mismatch");
      if (status.status === "queued" || status.status === "in_progress") {
        if (args.attempt >= 70) throw new Error("Provider timeout");
        await ctx.scheduler.runAfter(10000, makeFunctionReference<"action">("videoShots:poll"), {
          ...args,
          attempt: args.attempt + 1,
        });
        return;
      }
      if (status.status !== "completed" || !status.video?.url) {
        await ctx.runMutation(m("videoJobs:fail"), {
          jobId: job._id,
          fence: job.fence,
          code: "PROVIDER_GENERATION_FAILED",
          outcomeUnknown: false,
          effect: "unknown",
        });
        return;
      }
      const objectKey: string =
          savedReceipt.artifacts[0]?.objectKey ?? `video-results/${job._id}/${job.fence}/shot`,
        leaseId = `${job._id}:${job.fence}:shot`;
      await ctx.runMutation(m("videoJobs:savePersistenceReceipt"), {
        jobId: job._id,
        fence: job.fence,
        receipt: {
          state: "reserved",
          kind: "shot",
          provider: receipt,
          artifacts: [{ role: "shot", objectKey, leaseId, mimeType: "video/mp4" }],
        },
      });
      await ctx.runMutation(m("assets:acquireObjectLease"), {
        objectKey,
        leaseId,
      });
      const worker = getWorkerConfig();
      const response = await fetch(`${worker.url}/media/ingest`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${worker.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceUrl: status.video.url,
          declaredMimeType: "video/mp4",
          maxBytes: 2000000000,
          destinationUrl: await presignObject(objectKey, "PUT", 900),
        }),
        signal: AbortSignal.timeout(540000),
      });
      if (!response.ok) throw new Error("Shot persistence failed");
      const media = (await response.json()) as {
        persisted: boolean;
        kind: string;
        sha256: string;
        sizeBytes: number;
        durationMs: number;
        width: number;
        height: number;
      };
      if (!media.persisted || media.kind !== "video" || !/^[a-f0-9]{64}$/.test(media.sha256))
        throw new Error("Invalid ingestion result");
      await ctx.runMutation(m("videoJobs:savePersistenceReceipt"), {
        jobId: job._id,
        fence: job.fence,
        receipt: {
          state: "persisted",
          kind: "shot",
          provider: receipt,
          artifacts: [
            {
              role: "shot",
              objectKey,
              leaseId,
              mimeType: "video/mp4",
              sha256: media.sha256,
              sizeBytes: media.sizeBytes,
            },
          ],
          persistedRoles: ["shot"],
        },
      });
      const saved = await ctx.runMutation(m("assets:commitAssetVersion"), {
        scope: "workspace",
        createdBy: job.principalId,
        workspaceId: job.workspaceId,
        slug: `generated-${job._id}-${objectKey.split("/")[2]}-shot`,
        name: "Generated shot",
        tags: ["video-generation"],
        kind: "video",
        mediaMetadata: verifiedMediaMetadata(media),
        objectKey,
        contentHash: media.sha256,
        mimeType: "video/mp4",
        size: media.sizeBytes,
        originalFilename: "shot.mp4",
        sourceType: "upload",
        objectLeaseId: leaseId,
        provenance: {
          kind: "provider",
          jobId: job._id,
          provider: "higgsfield",
          requestedModel: "kling-video/v2.5-turbo/pro/image-to-video",
          actualModel: null,
          metadata: JSON.stringify({ requestId: receipt.requestId }),
        },
      });
      await ctx.runMutation(m("videoJobs:complete"), {
        jobId: job._id,
        fence: job.fence,
        result: {
          kind: "shot",
          artifacts: [
            {
              role: "video",
              asset: { assetId: saved.assetId, revisionId: saved.versionId },
              sha256: media.sha256,
              mimeType: "video/mp4",
              sizeBytes: media.sizeBytes,
            },
          ],
          metadata: {
            provider: "higgsfield",
            requestedModel: "higgsfield-kling-v2.5-turbo-pro",
            requestId: receipt.requestId,
            actualModel: null,
            durationMs: media.durationMs,
            width: media.width,
            height: media.height,
          },
          partial: false,
        },
      });
    } catch {
      if (args.attempt < 70) {
        await ctx.scheduler.runAfter(
          Math.min(30000, 10000 + args.attempt * 1000),
          makeFunctionReference<"action">("videoShots:poll"),
          { ...args, attempt: args.attempt + 1 },
        );
        return;
      }
      await ctx.runMutation(m("videoJobs:fail"), {
        jobId: job._id,
        fence: job.fence,
        code: "PROVIDER_RESULT_UNKNOWN",
        outcomeUnknown: true,
        effect: "unknown",
      });
    }
  },
});

import { verifiedMediaMetadata } from "./lib/videoAssetMetadata";
