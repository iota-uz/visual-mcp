"use node";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { JobRequest } from "../packages/video/src/jobs";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { sha256HexBytes } from "./lib/hash";
import { getObject, presignObject, putObject } from "./lib/objectStore";
import { readBoundedBody } from "./lib/videoBytes";
import type { ClaimedVideoJob } from "./lib/videoJobTypes";
import { generateImage, generateVoice, ProviderFailure } from "./lib/videoProviderAdapters";
import { getWorkerConfig } from "./lib/worker";

const m = (name: string) => makeFunctionReference<"mutation">(name);
/** Scheduled once. Retrying a claim is safe; retrying a paid submission is never automatic. */
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
        await ctx.scheduler.runAfter(5000, makeFunctionReference<"action">("videoProviders:run"), {
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
    const fence = job.fence;
    try {
      const request = JobRequest.parse(job.request);
      if (request.kind !== "image" && request.kind !== "voice")
        throw new ProviderFailure("UNSUPPORTED_CAPABILITY", "not_applied");
      // 8.3M aggregate output pixels bound worst-case RGBA/base64/JSON copies
      // inside the trusted 512MiB Node action. Reject before any paid dispatch.
      if (request.kind === "image") {
        const [width, height] = request.size.split("x").map(Number);
        if (width! * height! * request.count > 8294400)
          throw new ProviderFailure("IMAGE_BATCH_MEMORY_LIMIT", "not_applied");
      }
      const worker = getWorkerConfig();
      const key = process.env[request.kind === "image" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY"];
      if (!key) throw new ProviderFailure("PROVIDER_NOT_CONFIGURED", "not_applied");
      const images = [];
      let sourceBytes = 0;
      let mask: { bytes: Uint8Array; mimeType: string } | undefined;
      let target: Doc<"assets"> | undefined;
      if (request.kind === "image" && (request.mask || request.editTarget) && !request.source)
        throw new ProviderFailure("SOURCE_REQUIRED", "not_applied");
      if (request.kind === "image" && request.editTarget) {
        if (
          request.count !== 1 ||
          request.source?.assetId !== request.editTarget.assetId ||
          request.source?.revisionId !== request.editTarget.expectedRevisionId
        )
          throw new ProviderFailure("EDIT_TARGET_MISMATCH", "not_applied");
        target = await ctx.runQuery(makeFunctionReference<"query">("videoProviders:editTarget"), {
          jobId: job._id,
          ...request.editTarget,
        });
      }
      if (request.kind === "image")
        for (const ref of [...(request.source ? [request.source] : []), ...request.references]) {
          const source = await ctx.runQuery(
            makeFunctionReference<"query">("videoProviders:source"),
            { jobId: args.jobId, ...ref },
          );
          if (source.size > 25 * 1024 * 1024 || !source.mimeType.startsWith("image/"))
            throw new ProviderFailure("SOURCE_TOO_LARGE", "not_applied");
          sourceBytes += source.size;
          if (sourceBytes > 32 * 1024 * 1024)
            throw new ProviderFailure("IMAGE_REFERENCE_MEMORY_LIMIT", "not_applied");
          const response = await getObject(source.objectKey);
          if (!response.ok) throw new ProviderFailure("SOURCE_UNAVAILABLE", "not_applied");
          const bytes = await readBoundedBody(response, 25 * 1024 * 1024);
          if (bytes.length !== source.size || (await sha256HexBytes(bytes)) !== source.contentHash)
            throw new ProviderFailure("SOURCE_HASH_MISMATCH", "not_applied");
          images.push({ bytes, mimeType: source.mimeType });
        }
      if (request.kind === "image" && request.mask && request.source) {
        const specs = [];
        for (const ref of [request.source, request.mask]) {
          const asset = await ctx.runQuery(
            makeFunctionReference<"query">("videoProviders:source"),
            { jobId: job._id, ...ref },
          );
          if (asset.size > 25 * 1024 * 1024)
            throw new ProviderFailure("SOURCE_TOO_LARGE", "not_applied");
          const response = await fetch(`${worker.url}/media/verify`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${worker.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              sourceUrl: await presignObject(asset.objectKey, "GET", 900),
              declaredMimeType: asset.mimeType,
              maxBytes: asset.size,
              expectedSize: asset.size,
              expectedSha256: asset.contentHash,
            }),
            signal: AbortSignal.timeout(540000),
          });
          if (!response.ok) throw new ProviderFailure("MASK_PREFLIGHT_FAILED", "not_applied");
          specs.push(
            (await response.json()) as {
              width: number;
              height: number;
              hasAlpha?: boolean;
              alphaMin?: number;
              mimeType: string;
            },
          );
          if (ref === request.mask) {
            if (sourceBytes + asset.size > 32 * 1024 * 1024)
              throw new ProviderFailure("IMAGE_REFERENCE_MEMORY_LIMIT", "not_applied");
            if (asset.mimeType !== "image/png")
              throw new ProviderFailure("MASK_FORMAT_INVALID", "not_applied");
            const response = await getObject(asset.objectKey);
            if (!response.ok) throw new ProviderFailure("MASK_UNAVAILABLE", "not_applied");
            const bytes = await readBoundedBody(response, 25 * 1024 * 1024);
            if (bytes.length !== asset.size || (await sha256HexBytes(bytes)) !== asset.contentHash)
              throw new ProviderFailure("SOURCE_HASH_MISMATCH", "not_applied");
            mask = { bytes, mimeType: "image/png" };
          }
        }
        const [sourceSpec, maskSpec] = specs;
        if (
          !sourceSpec ||
          !maskSpec ||
          sourceSpec.width !== maskSpec.width ||
          sourceSpec.height !== maskSpec.height ||
          !maskSpec.hasAlpha ||
          maskSpec.alphaMin !== 0
        )
          throw new ProviderFailure("MASK_GEOMETRY_INVALID", "not_applied");
      }
      await ctx.runMutation(m("videoJobs:markDispatch"), {
        jobId: args.jobId,
        fence,
      });
      paid = true;
      const output =
        request.kind === "image"
          ? await generateImage(request, key, images, fetch, mask)
          : await generateVoice(request, key);
      // Persist all returned bytes first, even if secondary alignment/inspection fails.
      const staged = [];
      for (const artifact of output.artifacts) {
        const objectKey = `video-results/${args.jobId}/${fence}/${artifact.role}`,
          leaseId = `${args.jobId}:${fence}:${artifact.role}`,
          sha256 = await sha256HexBytes(artifact.bytes);
        await ctx.runMutation(m("assets:acquireObjectLease"), {
          objectKey,
          leaseId,
        });
        await putObject(objectKey, artifact.bytes, artifact.mimeType);
        staged.push({
          objectKey,
          leaseId,
          role: artifact.role,
          mimeType: artifact.mimeType,
          sha256,
          sizeBytes: artifact.bytes.length,
        });
      }
      await ctx.runMutation(m("videoJobs:savePersistenceReceipt"), {
        jobId: args.jobId,
        fence,
        receipt: {
          state: "persisted",
          kind: request.kind,
          artifacts: staged,
          metadata: JSON.stringify(output.metadata),
          persistedRoles: staged.map((artifact) => artifact.role),
        },
      });
      const artifacts = [];
      for (const artifact of staged) {
        const verify = await fetch(`${worker.url}/media/verify`, {
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
        if (!verify.ok) throw new ProviderFailure("RESULT_PERSISTENCE_FAILED", "partial");
        const inspected = (await verify.json()) as {
          sha256: string;
          sizeBytes: number;
          kind: string;
          mimeType: string;
        };
        if (
          inspected.sha256 !== artifact.sha256 ||
          inspected.sizeBytes !== artifact.sizeBytes ||
          inspected.mimeType !== artifact.mimeType
        )
          throw new ProviderFailure("RESULT_PERSISTENCE_FAILED", "partial");
        const saved = await ctx.runMutation(m("assets:commitAssetVersion"), {
          scope: "workspace",
          ownerUserId: job.principalId,
          workspaceId: job.workspaceId,
          slug: `generated-${args.jobId}-${fence}-${artifact.role}`,
          name: `Generated ${artifact.role}`,
          tags: ["video-generation"],
          kind: inspected.kind,
          mediaMetadata: verifiedMediaMetadata(inspected),
          objectKey: artifact.objectKey,
          contentHash: artifact.sha256,
          mimeType: artifact.mimeType,
          size: artifact.sizeBytes,
          originalFilename: artifact.role,
          sourceType: "upload",
          ...(target && request.kind === "image" && request.editTarget
            ? {
                scope: target.scope,
                workspaceId: target.workspaceId,
                slug: target.slug,
                name: target.name,
                description: target.description,
                tags: target.tags,
                expectedHeadVersionId: request.editTarget.expectedRevisionId,
                candidateSlug: `candidate-${job._id}-${fence}`,
              }
            : {}),
          provenance: {
            kind: "provider",
            jobId: args.jobId,
            provider: output.metadata.provider,
            requestedModel: output.metadata.requestedModel,
            actualModel: output.metadata.actualModel,
            metadata: JSON.stringify(output.metadata),
          },
          objectLeaseId: artifact.leaseId,
        });
        artifacts.push({
          role: artifact.role,
          asset: { assetId: saved.assetId, revisionId: saved.versionId },
          sha256: artifact.sha256,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          ...(target ? { headAdvanced: saved.assetId === target._id } : {}),
        });
      }
      await ctx.runMutation(m("videoJobs:complete"), {
        jobId: args.jobId,
        fence,
        result: {
          kind: request.kind,
          artifacts,
          metadata: output.metadata,
          partial: output.metadata.partial === true,
        },
      });
    } catch (error) {
      const failure = error instanceof ProviderFailure ? error : null;
      await ctx.runMutation(m("videoJobs:fail"), {
        jobId: args.jobId,
        fence,
        code: failure?.code ?? (paid ? "RESULT_PERSISTENCE_FAILED" : "PROVIDER_PREFLIGHT_FAILED"),
        outcomeUnknown: failure?.effect === "unknown" || (!failure && paid),
        effect: failure?.effect ?? (paid ? "unknown" : "not_applied"),
      });
    }
  },
});

import { verifiedMediaMetadata } from "./lib/videoAssetMetadata";
