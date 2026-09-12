import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { JobRequest } from "../packages/video/src/jobs";
import {
  VideoRenderFailure,
  VideoRenderRequest,
  VideoRenderResult,
} from "../packages/video/src/media";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { sha256HexBytes } from "./lib/hash";
import { headObject, presignObject, putObject } from "./lib/objectStore";
import { verifiedMediaMetadata } from "./lib/videoAssetMetadata";
import type { ClaimedVideoJob } from "./lib/videoJobTypes";
import { getWorkerConfig } from "./lib/worker";

const mutationRef = (name: string) => makeFunctionReference<"mutation">(name);
export async function completeRender(
  ctx: ActionCtx,
  args: { jobId: Id<"videoJobs"> },
  fence: number,
  result: VideoRenderResult,
  registered: Record<string, { assetId: string; revisionId: string }>,
  data: {
    job: { principalId: Id<"users">; workspaceId: Id<"workspaces"> };
    version: { _id: Id<"videoVersions"> };
  },
  claimed: { request: Extract<JobRequest, { kind: "render" }> },
) {
  const completedResult = {
    kind: "render",
    versionId: data.version._id,
    ...registered,
    sha256: result.video.sha256,
    partial: result.partial,
    metadata: {
      width: result.video.width,
      height: result.video.height,
      durationMs: result.video.durationMs,
      fps: result.video.fps,
    },
    checks: result.checks,
    ...(result.engine ? { engine: result.engine } : {}),
  };
  if (claimed.request.rubricHash) {
    const required = [
      "dimensions_frames_duration_fps",
      "source_integrity",
      "audio_presence",
      "font_mapping",
    ];
    const missing = required.filter(
      (name) =>
        !result.checks.some(
          (c) => c.name === name && c.outcome !== "not_evaluated",
        ),
    );
    const outcome = result.checks.some(
      (c) => required.includes(c.name) && c.outcome === "fail",
    )
      ? "fail"
      : missing.length || result.partial
        ? "uncertain"
        : "pass";
    const reportBytes = new TextEncoder().encode(
      JSON.stringify({
        algorithm: "trusted-render-measurements-v1",
        engine: result.engine ?? null,
        versionId: data.version._id,
        videoSha256: result.video.sha256,
        checks: result.checks,
        required,
        partial: result.partial,
        rubricHash: claimed.request.rubricHash,
        outcome,
      }),
    );
    const objectKey = `video-results/${args.jobId}/${result.fence}/technical-report`,
      leaseId = `${args.jobId}:${fence}:technical-report`,
      reportSha256 = await sha256HexBytes(reportBytes);
    await ctx.runMutation(mutationRef("assets:acquireObjectLease"), {
      objectKey,
      leaseId,
    });
    await putObject(objectKey, reportBytes, "application/json");
    const saved = await ctx.runMutation(
      mutationRef("assets:commitAssetVersion"),
      {
        scope: "workspace",
        createdBy: data.job.principalId,
        workspaceId: data.job.workspaceId,
        slug: `render-${args.jobId}-${result.fence}-technical-report`,
        name: "Technical render report",
        tags: ["video-qa"],
        kind: "data",
        objectKey,
        contentHash: reportSha256,
        mimeType: "application/json",
        size: reportBytes.length,
        originalFilename: "technical-report.json",
        sourceType: "upload",
        objectLeaseId: leaseId,
        provenance: {
          kind: "render",
          jobId: args.jobId,
          metadata: JSON.stringify({
            versionId: data.version._id,
            algorithm: "trusted-render-measurements-v1",
          }),
        },
      },
    );
    const report = { assetId: saved.assetId, revisionId: saved.versionId };
    await ctx.runMutation(mutationRef("videoEvidence:completeWithEvidence"), {
      jobId: args.jobId,
      fence,
      result: {
        ...completedResult,
        technicalReport: report,
        technicalReportSha256: reportSha256,
      },
      evidence: {
        jobId: args.jobId,
        versionId: data.version._id,
        artifact: registered.video,
        artifactSha256: result.video.sha256,
        report,
        reportSha256,
        rubricHash: claimed.request.rubricHash,
        method: "measurement",
        outcome,
        observation:
          "Exact dimensions, frame count, source hashes, expected audio presence and font mapping measured on persisted render",
        uncertainty: [
          ...missing.map((name) => `Required measurement unavailable: ${name}`),
          ...(result.partial ? ["Only partial range rendered"] : []),
        ],
        coverage: {
          startMs: 0,
          endMs: result.video.durationMs,
          samplingFps: null,
          limitations: result.checks
            .filter((c) => c.outcome === "not_evaluated")
            .map((c) => `${c.name}: ${c.reason ?? "not evaluated"}`),
        },
      },
    });
  } else
    await ctx.runMutation(mutationRef("videoJobs:complete"), {
      jobId: args.jobId,
      fence,
      result: completedResult,
    });
}
export const inputs = internalQuery({
  args: { jobId: v.id("videoJobs"), fence: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.fence !== args.fence ||
      job.kind !== "render" ||
      !job.versionId
    )
      throw new Error("Render fence unavailable");
    const version = await ctx.db.get(job.versionId);
    if (!version) throw new Error("Version unavailable");
    const manifest = JSON.parse(version.manifest);
    const refs = new Map<string, { assetId: string; revisionId: string }>();
    function scan(x: unknown) {
      if (!x || typeof x !== "object") return;
      const o = x as Record<string, unknown>;
      if (typeof o.assetId === "string" && typeof o.revisionId === "string")
        refs.set(o.revisionId, {
          assetId: o.assetId,
          revisionId: o.revisionId,
        });
      for (const value of Object.values(o)) scan(value);
    }
    scan(manifest.timeline);
    const sources = [];
    for (const ref of refs.values()) {
      const a = ctx.db.normalizeId("assets", ref.assetId),
        r = ctx.db.normalizeId("assetVersions", ref.revisionId);
      const asset = a ? await ctx.db.get(a) : null,
        revision = r ? await ctx.db.get(r) : null;
      if (
        !asset ||
        asset.archivedAt !== undefined ||
        !revision ||
        revision.assetId !== a ||
        !(asset.workspaceId === job.workspaceId || asset.scope === "shared")
      )
        throw new Error("Pinned asset unavailable");
      sources.push({
        asset: ref,
        objectKey: revision.objectKey,
        sha256: revision.contentHash,
        mimeType: revision.mimeType,
        sizeBytes: revision.size,
      });
    }
    return { job, version, manifest, sources };
  },
});
/** One scheduled action, never automatically resubmitted after an ambiguous response. */
export const run = internalAction({
  args: { jobId: v.id("videoJobs"), admissionAttempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let claimed: ClaimedVideoJob<"render"> | null = null;
    try {
      claimed = await ctx.runMutation(mutationRef("videoJobs:claim"), {
        jobId: args.jobId,
      });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string }).code === "CAPACITY_EXCEEDED" &&
        (args.admissionAttempt ?? 0) < 30
      ) {
        await ctx.scheduler.runAfter(
          5000,
          makeFunctionReference<"action">("videoRender:run"),
          {
            jobId: args.jobId,
            admissionAttempt: (args.admissionAttempt ?? 0) + 1,
          },
        );
        return;
      }
      if (error instanceof ConvexError) {
        await ctx.runMutation(mutationRef("videoJobs:failAdmission"), {
          jobId: args.jobId,
          code: (error.data as { code?: string }).code ?? "ADMISSION_FAILED",
        });
        return;
      }
      throw error;
    }
    if (!claimed) return;
    const fence = claimed.fence as number;
    let dispatched = false;
    try {
      const data = await ctx.runQuery(
        makeFunctionReference<"query">("videoRender:inputs"),
        {
          jobId: args.jobId,
          fence,
        },
      );
      const outputs: Record<string, { url: string; method: "PUT" }> = {};
      const keys: Record<string, string> = {};
      for (const name of ["video", "poster", "captions"]) {
        const key = `video-results/${args.jobId}/${fence}/${name}`;
        keys[name] = key;
        await ctx.runMutation(mutationRef("assets:acquireObjectLease"), {
          objectKey: key,
          leaseId: `${args.jobId}:${fence}:${name}`,
        });
        outputs[name] = {
          url: await presignObject(key, "PUT", 900),
          method: "PUT",
        };
      }
      const input = VideoRenderRequest.parse({
        jobId: args.jobId,
        fence,
        version: {
          projectId: data.version.projectId,
          language: data.version.language,
          versionId: data.version._id,
        },
        format: data.manifest.format,
        script: data.manifest.script,
        timeline: data.manifest.timeline,
        inputs: await Promise.all(
          data.sources.map(async (s: { objectKey: string }) => {
            const { objectKey, ...rest } = s;
            return { ...rest, url: await presignObject(objectKey, "GET", 900) };
          }),
        ),
        outputs,
        ...(claimed.request.range ? { range: claimed.request.range } : {}),
      });
      await ctx.runMutation(mutationRef("videoJobs:savePersistenceReceipt"), {
        jobId: args.jobId,
        fence,
        receipt: {
          state: "reserved",
          kind: "render",
          artifacts: Object.entries(keys).map(([role, objectKey]) => ({
            role,
            objectKey,
          })),
        },
      });
      if (!process.env.WORKER_URL || !process.env.WORKER_TOKEN)
        throw new ConvexError({
          code: "WORKER_NOT_CONFIGURED",
          effect: "not_applied",
        });
      const worker = getWorkerConfig();
      await ctx.runMutation(mutationRef("videoJobs:markDispatch"), {
        jobId: args.jobId,
        fence,
      });
      dispatched = true;
      const response = await fetch(`${worker.url}/video/render`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${worker.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(540000),
      });
      if (response.status === 429) {
        const error = (await response.json().catch(() => null)) as {
          error?: { code?: string; effect?: string };
        } | null;
        if (
          error?.error?.code === "WORKER_BUSY" &&
          error.error.effect === "not_applied"
        ) {
          await ctx.runMutation(mutationRef("videoJobs:retryBusyRender"), {
            jobId: args.jobId,
            fence,
            attempt: args.admissionAttempt ?? 0,
          });
          return;
        }
      }
      if (!response.ok) {
        const failure = VideoRenderFailure.safeParse(
          await response.json().catch(() => null),
        );
        const partial = VideoRenderResult.safeParse(
          failure.success ? failure.data.error.result : undefined,
        );
        if (
          partial.success &&
          partial.data.jobId === args.jobId &&
          partial.data.fence === fence
        ) {
          await ctx.runMutation(
            mutationRef("videoJobs:savePersistenceReceipt"),
            {
              jobId: args.jobId,
              fence,
              receipt: {
                state: "partially_persisted",
                kind: "render",
                artifacts: Object.entries(keys).map(([role, objectKey]) => ({
                  role,
                  objectKey,
                })),
                result: JSON.stringify(partial.data),
                persistedRoles: failure.success
                  ? (failure.data.error.persisted ?? [])
                  : [],
              },
            },
          );
          throw new ConvexError({
            code: "RESULT_PERSISTENCE_FAILED",
            effect: "partial",
            reasonCode: failure.success
              ? (failure.data.error.reasonCode ?? "RESULT_UPLOAD_FAILED")
              : "RESULT_UPLOAD_FAILED",
          });
        }
        if (failure.success)
          throw new ConvexError({
            code: failure.data.error.code,
            effect: failure.data.error.effect,
            reasonCode: failure.data.error.reasonCode,
          });
        throw new ConvexError({
          code: "WORKER_RESPONSE_INVALID",
          effect: "unknown",
        });
      }
      const result = VideoRenderResult.parse(await response.json());
      if (result.jobId !== args.jobId || result.fence !== fence)
        throw new Error("Render output fence mismatch");
      await ctx.runMutation(mutationRef("videoJobs:savePersistenceReceipt"), {
        jobId: args.jobId,
        fence,
        receipt: {
          state: "persisted",
          kind: "render",
          artifacts: Object.entries(keys).map(([role, objectKey]) => ({
            role,
            objectKey,
          })),
          result: JSON.stringify(result),
          persistedRoles: ["video", "poster", "captions"],
        },
      });
      const registered: Record<
        string,
        { assetId: Id<"assets">; revisionId: Id<"assetVersions"> }
      > = {};
      for (const name of ["video", "poster", "captions"] as const) {
        const artifact = result[name],
          key = keys[name]!;
        const head = await headObject(key);
        if (
          !head.ok ||
          Number(head.headers.get("content-length")) !== artifact.sizeBytes
        )
          throw new Error("Persisted output size mismatch");
        const saved = await ctx.runMutation(
          mutationRef("assets:commitAssetVersion"),
          {
            scope: "workspace",
            createdBy: data.job.principalId,
            workspaceId: data.job.workspaceId,
            slug: `render-${args.jobId}-${fence}-${name}`,
            name: `${data.version.label} ${name}`,
            tags: ["video-render"],
            kind:
              name === "video" ? "video" : name === "poster" ? "image" : "data",
            objectKey: key,
            contentHash: artifact.sha256,
            mediaMetadata: verifiedMediaMetadata(artifact),
            mimeType: artifact.mimeType,
            size: artifact.sizeBytes,
            originalFilename: `${name}.${name === "video" ? "mp4" : name === "poster" ? "png" : "vtt"}`,
            sourceType: "upload",
            provenance: {
              kind: "render",
              jobId: args.jobId,
              metadata: JSON.stringify({
                versionId: data.version._id,
                manifestSha256: data.version.manifestSha256,
                partial: result.partial,
                engine: result.engine ?? null,
              }),
            },
            objectLeaseId: `${args.jobId}:${fence}:${name}`,
          },
        );
        registered[name] = {
          assetId: saved.assetId,
          revisionId: saved.versionId,
        };
      }
      await completeRender(
        ctx,
        { jobId: args.jobId },
        fence,
        result,
        registered,
        data,
        claimed,
      );
    } catch (error) {
      await ctx.runMutation(mutationRef("videoJobs:fail"), {
        jobId: args.jobId,
        fence,
        code:
          error instanceof ConvexError
            ? (error.data as { code: string }).code
            : dispatched
              ? "RESULT_PERSISTENCE_FAILED"
              : "RENDER_PREFLIGHT_FAILED",
        outcomeUnknown:
          error instanceof ConvexError
            ? (error.data as { effect: string }).effect === "unknown"
            : dispatched,
        effect:
          error instanceof ConvexError
            ? (error.data as { effect: string }).effect
            : dispatched
              ? "unknown"
              : "not_applied",
        ...(error instanceof ConvexError &&
        typeof (error.data as { reasonCode?: unknown }).reasonCode === "string"
          ? { reasonCode: (error.data as { reasonCode: string }).reasonCode }
          : error instanceof Error &&
              error.message === "Persisted output size mismatch"
            ? { reasonCode: "STORED_OUTPUT_MISMATCH" }
            : {}),
      });
    }
  },
});
