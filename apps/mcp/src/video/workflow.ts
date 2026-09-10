import { Language, Patch } from "@visual-canvas/video";
import {
  WorkflowChange,
  WorkflowEvaluation,
  WorkflowProfile,
  WorkflowRole,
} from "@visual-canvas/video/workflow";
import { z } from "zod";
import type { Definition } from "./registry.js";

const id = z.string().min(1).max(200),
  text = z.string().trim().min(1).max(16000);
const write = {
  idempotency_key: id.describe("Reuse unchanged only for recovery of this logical write."),
};
const loopRead = z.union([
  z.object({ project_id: id, language: Language }).strict(),
  z.object({ loop_id: id }).strict(),
]);
const profileRead = z.union([
  z.object({ project_id: id, revision_id: id.optional() }).strict(),
  z.object({ profile_id: id, revision_id: id.optional() }).strict(),
]);
const loop = z
  .object({
    loop_id: id,
    revision_id: id,
    project_id: id,
    language: Language,
    state: z.enum(["idle", "active", "paused", "awaiting_human", "finished"]),
    iteration: z.number().int(),
    no_progress: z.number().int(),
    iteration_limit: z.number().int(),
    no_progress_limit: z.number().int(),
    baseline: id.nullable(),
    selected_candidate: id.nullable(),
    pending_proposal_ids: z.array(id),
    stop_reason: z.string().nullable(),
    human_approval: z.literal(false),
    paused_by_human: z.boolean().default(false),
    pending_proposal: z
      .object({ proposalId: id, invalidated: z.boolean(), causes: z.array(z.string()) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
const source = z.object({ kind: z.string(), id: z.string(), revision: z.string() }).strict();
const control = { loop_id: id, expected_loop_revision: id, ...write };
function mapInput(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
}
function mapOutput(raw: unknown) {
  const value = z.record(z.string(), z.unknown()).parse(raw);
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      v,
    ]),
  );
}
function tool(
  name: string,
  backend: string,
  readOnly: boolean,
  input: z.ZodType,
  output: z.ZodType,
  description: string,
): Definition {
  return {
    name,
    description,
    readOnly,
    input,
    output,
    run: async (args, call) => mapOutput(await call(backend, mapInput(args))),
  };
}

export const workflowDefinitions: Definition[] = [
  tool(
    "video_context_get",
    "getContext",
    true,
    z
      .object({
        project_id: id,
        language: Language,
        version_id: id.optional(),
        role: WorkflowRole,
        task: text.describe("Bounded task for this helper; not a new trusted human instruction."),
        scene_ids: z.array(id).max(100).optional(),
        shot_ids: z.array(id).max(100).optional(),
        include: z
          .array(
            z.enum([
              "brief",
              "script",
              "timeline",
              "profile",
              "assets",
              "feedback",
              "qa",
              "memory",
            ]),
          )
          .max(8)
          .optional(),
        max_bytes: z.number().int().min(2048).max(131072).default(32768),
      })
      .strict(),
    z
      .object({
        context_id: id,
        snapshot_revision: id,
        sections: z.array(
          z.object({ name: z.string(), content: z.unknown(), sources: z.array(source) }).strict(),
        ),
        omitted: z.array(z.object({ section: z.string(), reason: z.string() }).strict()),
        unresolved_questions: z.array(z.string()),
      })
      .strict(),
    "Retrieve bounded exact-version context for one role and optional scenes/shots plus neighbors. Critic excludes author intent and prior scores; use reviewer separately for compliance. Role does not grant permission. Omitted sections are explicit; this tool neither runs an agent nor claims quality.",
  ),
  tool(
    "video_profile_get",
    "getProfile",
    true,
    profileRead,
    z
      .object({ project_id: id, profile_id: id, revision_id: id, document: WorkflowProfile })
      .strict(),
    "Read project profile or an immutable profile revision. Source-backed means attributed, not verified truth; unknown facts stay null. Nested document uses the canonical camelCase schema.",
  ),
  tool(
    "video_profile_patch",
    "patchProfile",
    false,
    z
      .object({ profile_id: id, expected_revision: id, ...write, reason: text, operations: Patch })
      .strict(),
    z.object({ profile_id: id, revision_id: id }).strict(),
    "Create a profile revision with guarded keyed JSON Patch. Read first and recompute on revision conflict. Exact checkpoint profile pins retain older revisions. No secret storage or promotion of hypotheses to verified facts.",
  ),
  tool(
    "video_loop_get",
    "getLoop",
    true,
    loopRead,
    loop,
    "Read durable language loop, pending proposal, selected creative reference and stop reason. Agent selection is never human approval. Loops are initialized with language branches; this reader does not start work.",
  ),
  tool(
    "video_loop_propose",
    "loopPropose",
    false,
    z
      .object({
        project_id: id,
        language: Language,
        expected_loop_revision: id,
        ...write,
        baseline: id.describe(
          "Current checkpoint version_id in this language; selected creative reference is kept separately.",
        ),
        hypothesis: text,
        evidence_ids: z
          .array(id)
          .min(1)
          .max(30)
          .describe("Persisted trusted report evidence IDs, never caller-written pass flags."),
        changes: z.array(WorkflowChange).min(1).max(20),
        evaluation: WorkflowEvaluation,
        iteration_limit: z.number().int().min(1).max(20),
        no_progress_limit: z.number().int().min(1).max(20),
      })
      .strict(),
    z.object({ proposal_id: id, loop_revision: id }).strict(),
    "Reserve one bounded iteration with one explicit hypothesis and scoped changes. Requires observed reference and fixed rubric/workflow hashes. One pending proposal; limits cannot be relaxed on retry/resume. Does not generate media or invoke hidden reasoning.",
  ),
  tool(
    "video_loop_select",
    "loopSelect",
    false,
    z
      .object({
        ...control,
        proposal_id: id,
        candidate: id,
        evidence_ids: z.array(id).min(1).max(30),
        decision: z.enum(["select", "revert"]).default("select"),
        rationale: text,
      })
      .strict(),
    loop.extend({ requires_human_review: z.literal(true) }),
    "Select a current descendant candidate only with exact passing technical and independent video evidence under the pinned rubric. Uncertainty blocks selection. Revert records a failed attempt and keeps the selected reference; rounds/no-progress remain bounded. Never creates human approval or publication.",
  ),
  tool(
    "video_loop_pause",
    "loopPause",
    false,
    z
      .object({
        ...control,
        reason: text,
        running_jobs: z.enum(["leave_running", "request_cancel"]).default("leave_running"),
      })
      .strict(),
    z
      .object({
        loop_revision: id,
        state: z.literal("paused"),
        cancellation_requested_job_ids: z.array(id),
      })
      .strict(),
    "Pause new producer dispatch for this loop; already dispatched effects can complete and be charged. Cancellation request is not confirmation. Human UI pauses cannot be bypassed by an agent resume.",
  ),
  tool(
    "video_loop_resume",
    "loopResume",
    false,
    z.object(control).strict(),
    z.object({ loop_revision: id, state: z.literal("active"), next_action: z.string() }).strict(),
    "Resume an agent-paused loop without resetting limits or launching cloud reasoning. Never call automatically to bypass a human pause; bounded/exhausted experiments require human attention.",
  ),
];
