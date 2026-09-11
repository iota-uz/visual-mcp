"use node";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { JobRequest } from "../packages/video/src/jobs";
import { internalAction } from "./_generated/server";
import { sha256HexBytes } from "./lib/hash";
import { getObject, headObject } from "./lib/objectStore";
import { readBoundedBody } from "./lib/videoBytes";
import { compactCritiqueMetadata, completeCritique } from "./lib/videoCritiqueCompletion";
import { MAX_CRITIQUE_REPORT_BYTES } from "./lib/videoCritiqueLimits";
import type { PersistenceReceipt } from "./lib/videoPersistence";
import { Critique } from "./lib/videoProviderAdapters";

const m = (name: string) => makeFunctionReference<"mutation">(name),
  q = (name: string) => makeFunctionReference<"query">(name);
/** Reconcile only immutable stored report bytes; no Gemini dispatch. */
export const run = internalAction({
  args: { jobId: v.id("videoJobs"), fence: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(q("videoShots:status"), { jobId: args.jobId });
    if (
      job?.kind !== "critique" ||
      job.fence !== args.fence ||
      job.stage !== "recovering_bytes" ||
      !job.persistenceReceipt
    )
      return;
    const receipt = job.persistenceReceipt as PersistenceReceipt;
    const artifact = receipt.artifacts.find((item) => item.role === "critique");

    const request = JobRequest.parse(JSON.parse(job.request));
    if (
      request.kind !== "critique" ||
      receipt.kind !== "critique" ||
      !artifact?.objectKey ||
      !artifact.sha256
    )
      throw new Error("Critique receipt unavailable");
    const head = await headObject(artifact.objectKey);
    if (!head.ok || Number(head.headers.get("content-length")) > MAX_CRITIQUE_REPORT_BYTES)
      throw new Error("Stored critique unavailable");
    const response = await getObject(artifact.objectKey);
    if (!response.ok) throw new Error("Stored critique unavailable");
    const bytes = await readBoundedBody(response, MAX_CRITIQUE_REPORT_BYTES);
    if ((await sha256HexBytes(bytes)) !== artifact.sha256)
      throw new Error("Stored critique hash mismatch");
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    Critique.parse(payload.report);
    const source = await ctx.runQuery(q("videoProviders:source"), {
      jobId: job._id,
      ...request.asset,
    });
    if (payload.metadata.originalVideoSha256 !== source.contentHash)
      throw new Error("Critique source mismatch");
    const leaseId = `recovery:${job._id}:${job.fence}:critique`;
    await ctx.runMutation(m("assets:acquireObjectLease"), {
      objectKey: artifact.objectKey,
      leaseId,
    });
    const saved = await ctx.runMutation(m("assets:commitAssetVersion"), {
      scope: "workspace",
      ownerUserId: job.principalId,
      workspaceId: job.workspaceId,
      slug: `critique-${job._id}-${artifact.objectKey.split("/")[2]}`,
      name: "Video critique",
      tags: ["video-critique"],
      kind: "data",
      objectKey: artifact.objectKey,
      contentHash: artifact.sha256,
      mimeType: "application/json",
      size: bytes.length,
      originalFilename: "critique.json",
      sourceType: "upload",
      objectLeaseId: leaseId,
      provenance: {
        kind: "provider",
        jobId: job._id,
        provider: "gemini",
        requestedModel: request.modelId,
        actualModel: payload.metadata.actualModel,
        metadata: JSON.stringify(compactCritiqueMetadata(payload.metadata)),
      },
    });
    await completeCritique(
      ctx,
      job,
      request,
      saved,
      { bytes },
      source.contentHash,
      { metadata: payload.metadata },
      { durationMs: payload.metadata.durationMs },
    );
    return;
  },
});
