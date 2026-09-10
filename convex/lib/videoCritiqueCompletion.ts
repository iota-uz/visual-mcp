import { makeFunctionReference } from "convex/server";
import { bounded, canonical } from "../../packages/video/src/contracts";
import { type JobRequest, resolvedCritiquePolicy } from "../../packages/video/src/jobs";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { sha256Hex, sha256HexBytes } from "./hash";
import { MAX_CRITIQUE_SUMMARY_BYTES, utf8Prefix } from "./videoCritiqueLimits";

const m = (name: string) => makeFunctionReference<"mutation">(name);
function conciseStrings(value: unknown): string[] {
  const strings = Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
  return [
    ...strings.slice(0, 29).map((s) => utf8Prefix(s, 384)),
    ...(strings.length > 29 ? ["Additional details retained in the immutable full report"] : []),
  ];
}
export function compactCritiqueMetadata(metadata: Record<string, unknown>) {
  const { criteria, blockingUncertainty, ...rest } = metadata;
  const compact = {
    ...rest,
    criterionIds: Array.isArray(criteria)
      ? criteria.slice(0, 30).map((c) => utf8Prefix(String(c.id), 100))
      : [],
    blockingUncertainty: conciseStrings(blockingUncertainty),
    fullReportRequiredForDetails: true,
  };
  if (new TextEncoder().encode(canonical(compact)).length <= 16384) return compact;
  return {
    provider: String(metadata.provider),
    requestedModel: utf8Prefix(String(metadata.requestedModel), 200),
    actualModel:
      metadata.actualModel === null ? null : utf8Prefix(String(metadata.actualModel), 200),
    requestId: metadata.requestId === null ? null : utf8Prefix(String(metadata.requestId), 200),
    outcome: metadata.outcome,
    blockingUncertainty: conciseStrings(blockingUncertainty),
    fullReportRequiredForDetails: true,
    metadataSummaryTruncated: true,
  };
}
export async function completeCritique(
  ctx: ActionCtx,
  job: Pick<Doc<"videoJobs">, "_id" | "fence" | "projectId" | "versionId">,
  request: Extract<JobRequest, { kind: "critique" }>,
  saved: { assetId: Id<"assets">; versionId: Id<"assetVersions"> },
  artifact: { bytes: Uint8Array },
  originalHash: string,
  output: { metadata: Record<string, unknown> },
  media: { durationMs: number },
) {
  const sha256 = await sha256HexBytes(artifact.bytes);
  const report = { assetId: saved.assetId, revisionId: saved.versionId },
    rubricHash = await sha256Hex(canonical(resolvedCritiquePolicy(request)));
  const payload = JSON.parse(new TextDecoder().decode(artifact.bytes));
  const completedResult = {
    kind: "critique",
    report,
    reportSha256: sha256,
    artifact: request.asset,
    artifactSha256: originalHash,
    rubricHash,
    metadata: {
      ...compactCritiqueMetadata(output.metadata),
      findingCount: payload.report.findings.length,
      findingsSummaryOnly: true,
    },
    findings: payload.report.findings.slice(0, 12).map((finding: Record<string, unknown>) => ({
      ...finding,
      observation: utf8Prefix(String(finding.observation), 512),
      ...(finding.suggestedChange
        ? { suggestedChange: utf8Prefix(String(finding.suggestedChange), 512) }
        : {}),
    })),
    limitations: conciseStrings(payload.report.limitations),
    partial: false,
  };
  bounded(completedResult, MAX_CRITIQUE_SUMMARY_BYTES);
  if (job.versionId && job.projectId)
    await ctx.runMutation(m("videoEvidence:completeWithEvidence"), {
      jobId: job._id,
      fence: job.fence,
      result: completedResult,
      evidence: {
        jobId: job._id,
        versionId: job.versionId,
        artifact: request.asset,
        artifactSha256: originalHash,
        report,
        reportSha256: sha256,
        rubricHash,
        method: "provider_video",
        outcome: payload.outcome,
        observation: "Gemini sampled actual video; no human approval or performance prediction",
        uncertainty: conciseStrings(output.metadata.blockingUncertainty),
        coverage: {
          startMs: 0,
          endMs: media.durationMs,
          samplingFps: request.samplingFps,
          limitations: [
            ...conciseStrings(payload.report.limitations),
            "Model judgment is not human approval or a performance prediction",
          ].slice(0, 30),
        },
      },
    });
  else
    await ctx.runMutation(m("videoJobs:complete"), {
      jobId: job._id,
      fence: job.fence,
      result: completedResult,
    });
}
