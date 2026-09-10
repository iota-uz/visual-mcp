import { Language } from "@visual-canvas/video";
import {
  AnalyticsImport,
  LearningSource,
  MemoryProposal,
  MetricObservation,
  OfflineEvaluation,
  PublicationRecord,
} from "@visual-canvas/video/learning";
import { EvaluationReport, MemoryValidation } from "@visual-canvas/video/results";
import { WorkflowHash } from "@visual-canvas/video/workflow";
import { z } from "zod";
import type { Definition } from "./registry.js";

const id = z.string().min(1).max(200),
  write = { workspace_id: id, idempotency_key: id };
const page = {
  cursor: z.string().max(16000).optional(),
  limit: z.number().int().min(1).max(100).default(20),
};
const record = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
const snake = (raw: unknown) =>
  Object.fromEntries(
    Object.entries(record(raw)).map(([k, v]) => [
      k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      v,
    ]),
  );
const camel = (raw: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ]),
  );
const accepted = z
  .object({
    job_id: id,
    state: z.string(),
    replayed: z.boolean(),
    poll_after_ms: z.number(),
    operation: z.object({ tool: z.string(), idempotency_key: id }).strict(),
  })
  .strict();
function receipt(raw: unknown) {
  const j = record(raw),
    op = record(j.operation);
  return {
    job_id: j.jobId,
    state: j.state,
    replayed: j.replayed,
    poll_after_ms: j.pollAfterMs,
    operation: { tool: op.toolName, idempotency_key: op.idempotencyKey },
  };
}
const memory = MemoryProposal.extend({
  memory_id: id,
  revision_id: id,
  project_id: id,
  profile_id: id.nullable(),
  status: z.enum(["proposed", "supported", "rejected", "superseded"]),
  validation: MemoryValidation.nullable(),
});
const policy = z
  .object({ id: z.literal("independent-video-v1"), requirements: z.array(z.string()) })
  .strict();
const paged = <T extends z.ZodType>(item: T) =>
  z
    .object({ items: z.array(item), complete: z.boolean(), next_cursor: z.string().nullable() })
    .strict();
function listing(raw: unknown, map: (row: unknown) => unknown = snake) {
  const p = record(raw);
  return {
    items: z.array(z.unknown()).parse(p.page).map(map),
    complete: p.isDone,
    next_cursor: p.isDone ? null : p.continueCursor,
  };
}
const snapshot = PublicationRecord.safeExtend({
  projectId: id,
  versionId: id,
  language: Language,
  artifact: z.object({ assetId: id, revisionId: id }).strict(),
  artifactSha256: WorkflowHash,
  verification: z.literal("recorded"),
});
const group = z
  .object({
    platform: z.string(),
    sourceKind: z.string(),
    language: Language,
    metric: z.string(),
    unit: z.string(),
    definition: z.string(),
    aggregation: z.string(),
    publicationAge: z.object({ startMs: z.number(), endMs: z.number() }).nullable(),
    incomparablePublication: id.optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    topic: z.string().nullable(),
    format: z.string().nullable(),
    audience: z.string().nullable(),
    distribution: z.string().nullable(),
  })
  .strict();
const metric = MetricObservation.safeExtend({
  observation_id: id,
  publication_id: id,
  publication_revision: id,
  language: Language,
  source: LearningSource,
  comparison_group: group,
  caveats: z.array(z.string()),
});

export const learningDefinitions: Definition[] = [
  {
    name: "video_memory_propose",
    readOnly: false,
    description:
      "Record an evidence-attributed proposed lesson, never active advice. Project-scoped single-reel preferences cannot self-certify. Nested proposal follows canonical camelCase; source evidence IDs must exist.",
    input: z.object({ ...write, proposal: MemoryProposal }).strict(),
    output: z.object({ memory_id: id, revision_id: id, status: z.literal("proposed") }).strict(),
    run: async (i, call) => snake(await call("proposeMemory", camel(i))),
  },
  {
    name: "video_memory_get",
    readOnly: true,
    description:
      "Page scoped memory records and read the exact independent-video-v1 validation policy hash. Only supported lessons enter normal context; proposed/rejected lessons remain inspectable. Pages are live, not snapshots; keep original filters.",
    input: z
      .object({
        workspace_id: id,
        project_id: id.optional(),
        language: Language.optional(),
        status: z.enum(["proposed", "supported", "rejected", "superseded"]).optional(),
        ...page,
      })
      .strict(),
    output: paged(memory).extend({ policy, policy_hash: WorkflowHash }),
    run: async (i, call) => {
      const { cursor, limit, ...args } = camel(i);
      const p = record(
        await call("getMemory", {
          ...args,
          paginationOpts: { numItems: limit, cursor: cursor ?? null },
        }),
      );
      return {
        ...listing(p, (raw) => {
          const { memoryId, revisionId, projectId, profileId, ...document } = record(raw);
          return {
            ...document,
            memory_id: memoryId,
            revision_id: revisionId,
            project_id: projectId,
            profile_id: profileId,
          };
        }),
        policy: p.policy,
        policy_hash: p.policyHash,
      };
    },
  },
  {
    name: "video_memory_validate",
    readOnly: false,
    description:
      "Queue a deterministic evidence-support check under the policy hash from video_memory_get. Requires distinct underlying projects/media/reports, passing development and heldout evidence, no unresolved contradiction. No mark-as-true field and no native model call.",
    input: z
      .object({
        ...write,
        memory_id: id,
        expected_revision: id,
        evidence_ids: z.array(id).min(1).max(100),
        eval_ids: z.array(id).max(100),
        policy_hash: WorkflowHash,
      })
      .strict(),
    output: accepted,
    run: async (i, call) => {
      const { workspaceId, idempotencyKey, ...args } = camel(i);
      return receipt(
        await call("submitJob", {
          workspaceId,
          idempotencyKey,
          request: { kind: "memory_validation", ...args },
        }),
      );
    },
  },
  {
    name: "video_eval_run",
    readOnly: false,
    description:
      "Queue a supported offline runner: workflow-contract-v1 executes real domain handlers in rolled-back isolated fixtures; evidence-consistency-v1 audits pinned report comparisons. Neither is a native Codex/Claude execution or proof of artistic improvement. Live mode is unavailable, not simulated.",
    input: z.object({ ...write, evaluation: OfflineEvaluation }).strict(),
    output: accepted,
    run: async (i, call) =>
      receipt(
        await call("submitJob", {
          workspaceId: i.workspace_id,
          idempotencyKey: i.idempotency_key,
          request: { kind: "offline_eval", evaluation: i.evaluation },
        }),
      ),
  },
  {
    name: "video_eval_get",
    readOnly: true,
    description:
      "Read immutable evaluation report by eval_id from job_get.result; inspect provenance, actual exercised conditions, limits and regressions before claiming improvements.",
    input: z.object({ eval_id: id }).strict(),
    output: z
      .object({
        eval_id: id,
        workspace_id: id,
        job_id: id,
        report_hash: WorkflowHash,
        report: EvaluationReport,
      })
      .strict(),
    run: async (i, call) => snake(await call("getEval", { evalId: i.eval_id })),
  },
  {
    name: "video_publication_record",
    readOnly: false,
    description:
      "Record an externally published exact render with attributed source bytes and immutable correction history. Does not upload/post anywhere or claim verified publication. Unknown timestamp/descriptive values stay null. Corrections require current revision and reason.",
    input: z.object({ ...write, record: PublicationRecord }).strict(),
    output: z
      .object({ publication_id: id, revision_id: id, verification: z.literal("recorded") })
      .strict(),
    run: async (i, call) => snake(await call("recordPublication", camel(i))),
  },
  {
    name: "video_publication_get",
    readOnly: true,
    description:
      "Read publication metadata and exact historical revision before a correction or analytics import. Recorded means attributed, not verified platform authority.",
    input: z.object({ publication_id: id, revision_id: id.optional() }).strict(),
    output: z.object({ publication_id: id, revision_id: id, record: snapshot }).strict(),
    run: async (i, call) => snake(await call("getPublication", camel(i))),
  },
  {
    name: "video_analytics_import",
    readOnly: false,
    description:
      "Queue bounded normalized observations with pinned publication revision and source bytes. null is unknown, zero is observed zero; units/definitions/windows are explicit. Same source/window conflicting values fail atomically. No guessed reach score or platform posting.",
    input: z.object({ ...write, import: AnalyticsImport }).strict(),
    output: accepted,
    run: async (i, call) =>
      receipt(
        await call("submitJob", {
          workspaceId: i.workspace_id,
          idempotencyKey: i.idempotency_key,
          request: { kind: "analytics_import", import: i.import },
        }),
      ),
  },
  {
    name: "video_analytics_get",
    readOnly: true,
    description:
      "Read paginated observations with compatible comparison dimensions and source caveats. Equal-duration windows at different publication ages remain separate. Descriptive only; no causal/virality inference. Nested observation timestamps retain canonical camelCase.",
    input: z
      .object({
        workspace_id: id,
        project_id: id,
        publication_id: id.optional(),
        language: Language.optional(),
        ...page,
      })
      .strict(),
    output: paged(metric),
    run: async (i, call) => {
      const { cursor, limit, ...args } = camel(i);
      return listing(
        await call("getAnalytics", {
          ...args,
          paginationOpts: { numItems: limit, cursor: cursor ?? null },
        }),
        (raw) => {
          const { observationId, publicationId, publicationRevision, comparisonGroup, ...r } =
            record(raw);
          return {
            ...r,
            observation_id: observationId,
            publication_id: publicationId,
            publication_revision: publicationRevision,
            comparison_group: comparisonGroup,
          };
        },
      );
    },
  },
];
