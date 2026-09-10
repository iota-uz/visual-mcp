import { makeFunctionReference } from "convex/server";
import type { z } from "zod";
import {
  type MediaOperation,
  MediaProcessRequest,
  MediaProcessResult,
} from "../../packages/video/src/operations";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { headObject, presignObject } from "./objectStore";
import { verifiedMediaMetadata } from "./videoAssetMetadata";
import { getWorkerConfig } from "./worker";

const m = (name: string) => makeFunctionReference<"mutation">(name),
  q = (name: string) => makeFunctionReference<"query">(name);
/** Trusted byte processing; only scoped signed URLs reach the isolated worker. */
export async function processMedia(
  ctx: ActionCtx,
  job: {
    _id: Id<"videoJobs">;
    fence: number;
    principalId: Id<"users">;
    workspaceId: Id<"workspaces">;
  },
  asset: { assetId: string; revisionId: string },
  operation: z.infer<typeof MediaOperation>,
  additionalAssets: { assetId: string; revisionId: string }[] = [],
) {
  const source = await ctx.runQuery(q("videoProviders:source"), {
    jobId: job._id,
    ...asset,
  });
  const allAssets = [asset, ...additionalAssets];
  const sources = [
    source,
    ...(await Promise.all(
      additionalAssets.map((ref) =>
        ctx.runQuery(q("videoProviders:source"), { jobId: job._id, ...ref }),
      ),
    )),
  ];
  const names =
    operation.kind === "compare"
      ? ["contactsheet", ...operation.timesMs.flatMap((_, i) => [`frame-a-${i}`, `frame-b-${i}`])]
      : operation.kind === "frames"
        ? ["contactsheet", ...operation.timesMs.map((_, i) => `frame-${i}`)]
        : operation.kind === "audio_mix"
          ? ["audio", "report"]
          : [operation.kind === "proxy" ? "proxy" : "report"];
  const keys: Record<string, string> = {},
    outputs: Record<string, { url: string; method: "PUT" }> = {};
  for (const name of names) {
    const objectKey = `video-results/${job._id}/${job.fence}/${operation.kind}-${name}`,
      leaseId = `${job._id}:${job.fence}:${operation.kind}:${name}`;
    keys[name] = objectKey;
    await ctx.runMutation(m("assets:acquireObjectLease"), {
      objectKey,
      leaseId,
    });
    outputs[name] = {
      url: await presignObject(objectKey, "PUT", 900),
      method: "PUT",
    };
  }
  const request = MediaProcessRequest.parse({
    jobId: job._id,
    fence: job.fence,
    operation,
    inputs: await Promise.all(
      sources.map(async (s, index) => ({
        asset: allAssets[index],
        url: await presignObject(s.objectKey, "GET", 900),
        sha256: s.contentHash,
        sizeBytes: s.size,
        mimeType: s.mimeType,
      })),
    ),
    outputs,
  });
  const worker = getWorkerConfig();
  const response = await fetch(`${worker.url}/video/process`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${worker.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(330000),
  });
  const payload = await response.json();
  const result = MediaProcessResult.parse(response.ok ? payload : payload.result);
  if (
    result.jobId !== job._id ||
    result.fence !== job.fence ||
    result.sourceSha256 !== source.contentHash ||
    result.source.assetId !== asset.assetId ||
    result.source.revisionId !== asset.revisionId ||
    result.kind !== operation.kind ||
    result.sources.length !== sources.length ||
    result.sources.some(
      (s, index) =>
        s.sha256 !== sources[index].contentHash ||
        s.asset.assetId !== allAssets[index]!.assetId ||
        s.asset.revisionId !== allAssets[index]!.revisionId,
    ) ||
    result.outputs.length !== names.length ||
    new Set(result.outputs.map((o) => o.name)).size !== names.length ||
    result.outputs.some((o) => !names.includes(o.name))
  )
    throw new Error("Media processing identity mismatch");
  await ctx.runMutation(m("videoJobs:savePersistenceReceipt"), {
    jobId: job._id,
    fence: job.fence,
    receipt: { kind: "media", operation: operation.kind, keys, result },
    ...(!response.ok ? { stage: "outputs_partial" } : {}),
  });
  if (!response.ok)
    throw new Error(
      "Media processing partial persistence; known output metadata retained for reconciliation",
    );
  const registered = [];
  for (const output of result.outputs) {
    const objectKey = keys[output.name]!,
      head = await headObject(objectKey);
    if (!head.ok || Number(head.headers.get("content-length")) !== output.sizeBytes)
      throw new Error("Media output not persisted");
    const saved = await ctx.runMutation(m("assets:commitAssetVersion"), {
      scope: "workspace",
      ownerUserId: job.principalId,
      workspaceId: job.workspaceId,
      slug: `media-${job._id}-${job.fence}-${operation.kind}-${output.name}`,
      name: `${operation.kind} ${output.name}`,
      tags: ["video-analysis"],
      kind: output.mimeType.startsWith("image/")
        ? "image"
        : output.mimeType.startsWith("video/")
          ? "video"
          : output.mimeType.startsWith("audio/")
            ? "audio"
            : "data",
      objectKey,
      contentHash: output.sha256,
      mediaMetadata: verifiedMediaMetadata(output),
      mimeType: output.mimeType,
      size: output.sizeBytes,
      originalFilename: output.name,
      sourceType: "upload",
      objectLeaseId: `${job._id}:${job.fence}:${operation.kind}:${output.name}`,
      provenance: {
        kind: "render",
        jobId: job._id,
        metadata: JSON.stringify({
          operation,
          source: asset,
          sourceSha256: source.contentHash,
          sampling: result.sampling,
        }),
      },
    });
    registered.push({
      ...output,
      asset: { assetId: saved.assetId, revisionId: saved.versionId },
    });
  }
  return { ...result, outputs: registered };
}
