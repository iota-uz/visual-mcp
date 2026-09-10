import { z } from "zod";
import { AssetRef, Language } from "./contracts.js";
import { WorkflowHash } from "./workflow.js";

const Id = z.string().min(1).max(200),
  Text = z.string().trim().min(1).max(16000);
export const LearningSource = z
  .object({
    kind: z.enum(["manual", "platform_export", "user_reported"]),
    reference: Text,
    asset: AssetRef,
    sha256: WorkflowHash,
  })
  .strict();
export const MemoryProposal = z
  .object({
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("project"), projectId: Id }).strict(),
      z.object({ kind: z.literal("profile"), profileId: Id }).strict(),
    ]),
    statement: Text,
    applicability: Text,
    exceptions: z.array(Text).max(30).default([]),
    language: Language,
    supportingEvidenceIds: z.array(Id).min(1).max(30),
    contradictingEvidenceIds: z.array(Id).max(30).default([]),
  })
  .strict();
export const OfflineDataset = z
  .object({
    schemaVersion: z.literal(1),
    cases: z
      .array(
        z
          .object({
            id: Id,
            familyId: Id,
            split: z.enum(["development", "heldout"]),
            attemptCount: z.number().int().min(1).max(100),
            baselineEvidenceIds: z.array(Id).min(1).max(10),
            candidateEvidenceIds: z.array(Id).min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.cases.map((c) => c.id)).size !== v.cases.length)
      c.addIssue({ code: "custom", message: "Case IDs must be unique" });
    const families = new Map<string, string>();
    for (const row of v.cases) {
      if (families.has(row.familyId) && families.get(row.familyId) !== row.split)
        c.addIssue({ code: "custom", message: "A source family cannot cross development/heldout" });
      families.set(row.familyId, row.split);
    }
  });
export const OfflineEvalRequest = z
  .object({
    runner: z.literal("evidence-consistency-v1"),
    dataset: OfflineDataset,
    datasetHash: WorkflowHash,
    rubricHash: WorkflowHash,
    baselineWorkflowHash: WorkflowHash,
    candidateWorkflowHash: WorkflowHash,
    caseIds: z.array(Id).min(1).max(50).optional(),
    execution: z.object({ mode: z.literal("offline") }).strict(),
  })
  .strict();
export const ContractFixtureRequest = z
  .object({
    runner: z.literal("workflow-contract-v1"),
    dataset: z.literal("workflow-contract-v1"),
    repetitions: z.number().int().min(1).max(5).default(1),
    caseIds: z
      .array(
        z.enum([
          "false-critic",
          "stale-base",
          "pending-proposal",
          "iteration-bound",
          "human-pause",
        ]),
      )
      .min(1)
      .max(5)
      .optional(),
    execution: z.object({ mode: z.literal("offline") }).strict(),
  })
  .strict();
export const OfflineEvaluation = z.discriminatedUnion("runner", [
  OfflineEvalRequest,
  ContractFixtureRequest,
]);
export const PublicationRecord = z
  .object({
    renderJobId: Id,
    platform: z.enum(["youtube", "instagram", "tiktok", "other"]),
    externalPostId: Id,
    url: z.url().refine((u) => new URL(u).protocol === "https:"),
    publishedAt: z.iso.datetime().nullable(),
    source: LearningSource,
    expectedRevision: Id.nullable().default(null),
    reason: Text.nullable().default(null),
    topic: Text.nullable().default(null),
    format: Text.nullable().default(null),
    audience: Text.nullable().default(null),
    distribution: Text.nullable().default(null),
    hookVariant: Text.nullable().default(null),
  })
  .strict()
  .refine((v) => !v.expectedRevision || Boolean(v.reason), "Corrections need a reason");
export const MetricObservation = z
  .object({
    metric: z.enum([
      "views",
      "impressions",
      "likes",
      "comments",
      "shares",
      "saves",
      "watch_time_ms",
      "average_view_duration_ms",
      "completion_rate",
    ]),
    value: z.number().finite().nonnegative().nullable(),
    unit: z.enum(["count", "milliseconds", "ratio"]),
    definition: Text,
    aggregation: z.enum(["cumulative", "window"]),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    observedAt: z.iso.datetime(),
    sourceReference: Text,
  })
  .strict()
  .superRefine((v, c) => {
    if (
      Date.parse(v.windowEnd) <= Date.parse(v.windowStart) ||
      Date.parse(v.observedAt) < Date.parse(v.windowEnd)
    )
      c.addIssue({
        code: "custom",
        message: "Positive observation window and observedAt >= end required",
      });
    const unit = v.metric.endsWith("_ms")
      ? "milliseconds"
      : v.metric === "completion_rate"
        ? "ratio"
        : "count";
    if (v.unit !== unit)
      c.addIssue({ code: "custom", message: "Explicit unit does not match normalized metric" });
    if (v.unit === "ratio" && v.value !== null && v.value > 1)
      c.addIssue({ code: "custom", message: "Ratio is 0–1, not a percentage" });
  });
export const AnalyticsImport = z
  .object({
    publicationId: Id,
    publicationRevision: Id,
    source: LearningSource,
    observations: z.array(MetricObservation).min(1).max(100),
  })
  .strict();
