import { z } from "zod";
import { AssetRef, Format } from "./contracts.js";
import { RenderEngine } from "./media.js";
import { MediaProcessResult } from "./operations.js";
import { WorkflowHash } from "./workflow.js";

const Id = z.string().min(1),
  Strings = z.array(z.string());
export const MeasuredMediaMetadata = z
  .object({
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    durationMs: z.number().positive().optional(),
    frameCount: z.number().int().positive().optional(),
    fps: Format.shape.fps.optional(),
    hasAudio: z.boolean().optional(),
    hasAlpha: z.boolean().optional(),
    alphaMin: z.number().min(0).max(255).optional(),
    alphaMax: z.number().min(0).max(255).optional(),
    audioStreams: z
      .array(
        z
          .object({
            codec: z.string().nullable(),
            channels: z.number().nullable(),
            sampleRateHz: z.number().nullable(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const ExecutionResult = z
  .object({
    run_id: Id,
    success: z.boolean(),
    emitted: z.array(z.json()),
    stdout: z.string(),
    stderr: z.string(),
    output_truncated: z.boolean(),
    error: z.string().optional(),
    accounting: z.literal("broker_only"),
    untracked_network_effects_possible: z.literal(true),
  })
  .strict();
export const ArtifactResult = z
  .object({
    role: z.string(),
    asset: AssetRef,
    sha256: WorkflowHash,
    mimeType: z.string(),
    sizeBytes: z.number().nonnegative(),
    headAdvanced: z.boolean().optional(),
  })
  .strict();
/** Core identity is typed; extra provider-specific diagnostic metadata remains explicit JSON. */
export const ProviderMetadata = z
  .object({
    provider: z.string(),
    requestedModel: z.string(),
    actualModel: z.string().nullable(),
    requestId: z.string().nullable(),
  })
  .catchall(z.json());
const MediaResult = z
  .object({
    kind: z.enum(["image", "voice", "shot", "critique"]),
    artifacts: z.array(ArtifactResult),
    metadata: ProviderMetadata,
    partial: z.boolean(),
  })
  .strict();
const Check = z
  .object({
    name: z.string(),
    outcome: z.enum(["pass", "fail", "not_evaluated"]),
    reason: z.string().optional(),
  })
  .strict();
export const RenderResult = z
  .object({
    kind: z.literal("render"),
    versionId: Id,
    video: AssetRef,
    poster: AssetRef,
    captions: AssetRef,
    sha256: WorkflowHash,
    partial: z.boolean(),
    metadata: z
      .object({
        width: z.number(),
        height: z.number(),
        durationMs: z.number(),
        fps: Format.shape.fps,
      })
      .strict(),
    checks: z.array(Check),
    evidenceId: Id.optional(),
    engine: RenderEngine.optional(),
    technicalReport: AssetRef.optional(),
    technicalReportSha256: WorkflowHash.optional(),
  })
  .strict();
const Finding = z
  .object({
    startMs: z.number(),
    endMs: z.number(),
    severity: z.enum(["blocker", "major", "minor", "note"]),
    observation: z.string(),
    suggestedChange: z.string().optional(),
    confidence: z.number().nullable(),
  })
  .strict();
const CritiqueResult = z
  .object({
    kind: z.literal("critique"),
    report: AssetRef,
    reportSha256: WorkflowHash,
    artifact: AssetRef,
    artifactSha256: WorkflowHash,
    rubricHash: WorkflowHash,
    metadata: ProviderMetadata,
    findings: z.array(Finding),
    limitations: Strings,
    partial: z.literal(false),
    evidenceId: Id.optional(),
  })
  .strict();
const FixtureCase = z
  .object({
    caseId: z.string(),
    repetition: z.number().int(),
    outcome: z.enum(["pass", "fail"]),
    observed: z.string(),
    expected: z.string().optional(),
    coverage: z.literal("actual-domain-state-transitions-only"),
    workspaceRolledBack: z.boolean().optional(),
  })
  .strict();
const FixtureConfig = z
  .object({
    version: z.literal("workflow-contract-v1"),
    cases: Strings,
    limits: z.object({ rounds: z.number(), noProgress: z.number() }).strict(),
    coverage: z.literal("actual-domain-state-transitions-only"),
    expected: z.record(z.string(), z.string()),
  })
  .strict();
const ConsistencyCase = z
  .object({
    caseId: Id,
    familyId: Id,
    split: z.enum(["development", "heldout"]),
    attemptCount: z.number(),
    baselineOutcome: z.enum(["pass", "fail", "inconclusive"]),
    outcome: z.enum(["pass", "fail", "inconclusive"]),
    regression: z.boolean(),
    evidenceIds: Strings,
    projectIds: Strings,
    artifactHashes: Strings,
    reportHashes: Strings,
  })
  .strict();
export const EvaluationReport = z.discriminatedUnion("runner", [
  z
    .object({
      kind: z.literal("offline_eval"),
      runner: z.literal("workflow-contract-v1"),
      configHash: WorkflowHash,
      config: FixtureConfig,
      cases: z.array(FixtureCase),
      provenance: z.literal("actual-convex-handler-execution-rolled-back"),
      codeRevision: WorkflowHash.nullable(),
      limitations: Strings,
    })
    .strict(),
  z
    .object({
      kind: z.literal("offline_eval"),
      runner: z.literal("evidence-consistency-v1"),
      datasetHash: WorkflowHash,
      rubricHash: WorkflowHash,
      baselineWorkflowHash: WorkflowHash,
      candidateWorkflowHash: WorkflowHash,
      cases: z.array(ConsistencyCase),
      regressions: Strings,
      provenance: z.literal("stored-evidence-audit"),
      limitations: Strings,
    })
    .strict(),
]);
export const MemoryValidation = z
  .object({
    outcome: z.enum(["rejected", "inconclusive", "supported"]),
    reasons: Strings,
    evidenceIds: Strings,
    evalIds: Strings,
    policyHash: WorkflowHash,
    interpretation: z.string(),
  })
  .strict();
export const LearningResult = z.union([
  z
    .object({
      kind: z.literal("offline_eval"),
      evalId: Id,
      reportHash: WorkflowHash,
      report: EvaluationReport,
    })
    .strict(),
  MemoryValidation.extend({
    kind: z.literal("memory_validation"),
    memoryId: Id,
    revisionId: Id,
    status: z.enum(["proposed", "supported", "rejected"]),
  }).strict(),
  z
    .object({
      kind: z.literal("analytics_import"),
      publicationId: Id,
      imported: z.number().int(),
      duplicates: z.number().int(),
    })
    .strict(),
]);
export const ProcessedMediaResult = MediaProcessResult.omit({ kind: true, outputs: true }).extend({
  kind: z.literal("media"),
  operation: MediaProcessResult.shape.kind,
  outputs: z.array(MediaProcessResult.shape.outputs.element.extend({ asset: AssetRef })),
});
export const JobResult = z.union([
  ExecutionResult,
  RenderResult,
  MediaResult,
  CritiqueResult,
  LearningResult,
  ProcessedMediaResult,
]);
