import { ConvexError, type ObjectType, type PropertyValidators, v } from "convex/values";
import {
  applyPatch,
  Brief,
  bounded,
  canonical,
  Script,
  Timeline,
} from "../packages/video/src/contracts";
import {
  WorkflowChange,
  WorkflowEvaluation,
  WorkflowEvidence,
  WorkflowProfile,
  WorkflowRole,
} from "../packages/video/src/workflow";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireIotaIdentity, requireUserId } from "./lib/auth";
import { sha256Hex } from "./lib/hash";

const language = v.union(v.literal("ru"), v.literal("uz"));
const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message, effect: "not_applied" });
};
const digest = (value: unknown) => sha256Hex(canonical(value));
type Context = QueryCtx | MutationCtx;
async function user(ctx: Context) {
  if ("videoPrincipalId" in ctx) {
    const id = ctx.videoPrincipalId as Id<"users">;
    if (!(await ctx.db.get(id))) fail("NOT_FOUND_OR_FORBIDDEN", "Principal unavailable");
    return id;
  }
  return requireUserId(ctx, await requireIotaIdentity(ctx));
}
async function project(ctx: Context, id: Id<"videoProjects">) {
  const p = await ctx.db.get(id);
  if (!p || !(await ctx.db.get(p.workspaceId)))
    return fail("NOT_FOUND_OR_FORBIDDEN", "Project unavailable");
  return p;
}
async function version(
  ctx: Context,
  id: Id<"videoVersions">,
  projectId: Id<"videoProjects">,
  lang?: "ru" | "uz",
) {
  const value = await ctx.db.get(id);
  if (!value || value.projectId !== projectId || (lang && value.language !== lang))
    return fail("NOT_FOUND_OR_FORBIDDEN", "Exact version does not match project/language");
  return value;
}
async function replay(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  tool: string,
  key: string,
  input: unknown,
) {
  const principalId = await user(ctx);
  if (!key.trim() || key.length > 200)
    fail("VALIDATION_ERROR", "Idempotency key must be 1–200 characters");
  try {
    bounded(input, 262144);
  } catch {
    fail("VALIDATION_ERROR", "Request exceeds 262144 bytes");
  }
  const inputHash = await digest(input);
  const previous = await ctx.db
    .query("videoOperations")
    .withIndex("by_principalId_and_workspaceId_and_tool_and_key", (q) =>
      q
        .eq("principalId", principalId)
        .eq("workspaceId", workspaceId)
        .eq("tool", tool)
        .eq("key", key),
    )
    .unique();
  if (previous && previous.inputHash !== inputHash)
    fail("IDEMPOTENCY_CONFLICT", "Key belongs to a different operation; inspect prior result");
  return { principalId, workspaceId, tool, key, inputHash, previous };
}
async function remember(ctx: MutationCtx, r: Awaited<ReturnType<typeof replay>>, result: unknown) {
  const { previous, ...fields } = r;
  await ctx.db.insert("videoOperations", { ...fields, result: canonical(result) });
}
function qdef<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: QueryCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return d;
}
function mdef<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: MutationCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return d;
}
function aq<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: QueryCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return internalQuery({
    args: { ...d.args, videoPrincipalId: v.id("users") },
    handler: (ctx, args) => {
      const { videoPrincipalId, ...rest } = args;
      return d.handler(Object.assign({}, ctx, { videoPrincipalId }), rest as ObjectType<A>);
    },
  });
}
function am<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: MutationCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return internalMutation({
    args: { ...d.args, videoPrincipalId: v.id("users") },
    handler: (ctx, args) => {
      const { videoPrincipalId, ...rest } = args;
      return d.handler(Object.assign({}, ctx, { videoPrincipalId }), rest as ObjectType<A>);
    },
  });
}
async function asset(
  ctx: Context,
  workspaceId: Id<"workspaces">,
  ref: { assetId: string; revisionId: string },
  hash?: string,
) {
  const aid = ctx.db.normalizeId("assets", ref.assetId),
    rid = ctx.db.normalizeId("assetVersions", ref.revisionId);
  const a = aid ? await ctx.db.get(aid) : null,
    r = rid ? await ctx.db.get(rid) : null;
  if (
    !a ||
    a.archivedAt !== undefined ||
    a.workspaceId !== workspaceId ||
    !r ||
    r.assetId !== a._id ||
    (hash && r.contentHash !== hash)
  )
    return fail(
      "NOT_FOUND_OR_FORBIDDEN",
      "Registered asset revision/hash unavailable in project workspace",
    );
  return r;
}
async function profileAt(ctx: Context, projectId: Id<"videoProjects">, revisionId?: string) {
  const p = await ctx.db
    .query("videoProfiles")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .unique();
  if (!p) return fail("WORKFLOW_NOT_INITIALIZED", "Project workflow requires migration before use");
  const r = revisionId
    ? await ctx.db
        .query("videoProfileRevisions")
        .withIndex("by_profileId_and_revisionId", (q) =>
          q.eq("profileId", p._id).eq("revisionId", revisionId),
        )
        .unique()
    : p;
  if (!r) return fail("NOT_FOUND_OR_FORBIDDEN", "Profile revision unavailable");
  return {
    profileId: p._id,
    revisionId: r.revisionId,
    document: WorkflowProfile.parse(JSON.parse(r.content)),
  };
}
const getProfileDef = qdef({
  args: {
    projectId: v.optional(v.id("videoProjects")),
    profileId: v.optional(v.id("videoProfiles")),
    revisionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await user(ctx);
    if (Boolean(args.projectId) === Boolean(args.profileId))
      return fail("VALIDATION_ERROR", "Choose exactly one projectId or profileId");
    const p = args.profileId ? await ctx.db.get(args.profileId) : null;
    const projectId = args.projectId ?? p?.projectId;
    if (!projectId) return fail("NOT_FOUND_OR_FORBIDDEN", "Profile unavailable");
    await project(ctx, projectId);
    return { projectId, ...(await profileAt(ctx, projectId, args.revisionId)) };
  },
});
export const getProfile = query(getProfileDef),
  agentGetProfile = aq(getProfileDef);
const patchProfileDef = mdef({
  args: {
    profileId: v.id("videoProfiles"),
    expectedRevision: v.string(),
    idempotencyKey: v.string(),
    reason: v.string(),
    operations: v.any(),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.profileId);
    if (!p) return fail("NOT_FOUND_OR_FORBIDDEN", "Profile unavailable");
    const pr = await project(ctx, p.projectId);
    const r = await replay(ctx, pr.workspaceId, "patchProfile", args.idempotencyKey, args);
    if (r.previous)
      return JSON.parse(r.previous.result) as {
        profileId: Id<"videoProfiles">;
        revisionId: string;
      };
    if (p.revisionId !== args.expectedRevision)
      fail(
        "REVISION_CONFLICT",
        "Read profile and recompute patch; never only replace expected revision",
      );
    if (!args.reason.trim() || args.reason.length > 16000)
      fail("VALIDATION_ERROR", "Revision reason required");
    let next: ReturnType<typeof WorkflowProfile.parse>;
    try {
      next = applyPatch(
        WorkflowProfile.parse(JSON.parse(p.content)),
        args.operations,
        WorkflowProfile,
      );
    } catch {
      return fail(
        "VALIDATION_ERROR",
        "Profile patch violates schema; unknown is null, sourced needs attributed registered bytes",
      );
    }
    if (next.versionId) {
      const id = ctx.db.normalizeId("videoVersions", next.versionId);
      if (!id) fail("VALIDATION_ERROR", "Invalid version ID");
      const ver = await version(ctx, id!, p.projectId, next.language ?? undefined);
      const s = Script.parse(JSON.parse(ver.manifest).script);
      if (next.sceneIds.some((id) => !s.scenesById[id]))
        fail("SCOPE_MISMATCH", "Profile scene not present in exact version");
    }
    for (const e of next.entries) {
      if (e.source) await asset(ctx, pr.workspaceId, e.source.asset, e.source.sha256);
      for (const a of e.assets) await asset(ctx, pr.workspaceId, a);
    }
    const content = canonical(next),
      revisionId = await digest({ parent: p.revisionId, document: next });
    await ctx.db.patch(p._id, { content, revisionId });
    await ctx.db.insert("videoProfileRevisions", {
      profileId: p._id,
      content,
      revisionId,
      reason: args.reason,
    });
    const result = { profileId: p._id, revisionId };
    await remember(ctx, r, result);
    return result;
  },
});
export const patchProfile = mutation(patchProfileDef),
  agentPatchProfile = am(patchProfileDef);

async function loop(ctx: Context, projectId: Id<"videoProjects">, lang: "ru" | "uz") {
  await project(ctx, projectId);
  const l = await ctx.db
    .query("videoLoops")
    .withIndex("by_projectId_and_language", (q) =>
      q.eq("projectId", projectId).eq("language", lang),
    )
    .unique();
  if (!l)
    return fail(
      "WORKFLOW_NOT_INITIALIZED",
      "Project/language workflow unavailable; migrate existing project",
    );
  return l;
}
function loopView(l: Doc<"videoLoops">) {
  return {
    loopId: l._id,
    revisionId: l.revisionId,
    projectId: l.projectId,
    language: l.language,
    state: l.state,
    iteration: l.iteration,
    noProgress: l.noProgress,
    iterationLimit: l.iterationLimit,
    noProgressLimit: l.noProgressLimit,
    baseline: l.baseline,
    selectedCandidate: l.selectedCandidate,
    pendingProposalIds: l.pendingProposalId ? [l.pendingProposalId] : [],
    stopReason: l.stopReason,
    humanApproval: false,
    pausedByHuman: l.pausedByHuman,
  };
}
async function loopReadView(ctx: Context, l: Doc<"videoLoops">) {
  const pending = l.pendingProposalId ? await ctx.db.get(l.pendingProposalId) : null;
  const p = await project(ctx, l.projectId);
  const causes: string[] = [];
  if (pending && pending.humanInputRevision !== l.humanInputRevision)
    causes.push("human_input_changed");
  if (pending && pending.projectRevision !== p.revisionId) causes.push("project_brief_changed");
  return {
    ...loopView(l),
    pendingProposal: pending
      ? { proposalId: pending._id, invalidated: causes.length > 0, causes }
      : null,
  };
}
const getLoopDef = qdef({
  args: {
    projectId: v.optional(v.id("videoProjects")),
    language: v.optional(language),
    loopId: v.optional(v.id("videoLoops")),
  },
  handler: async (ctx, args) => {
    await user(ctx);
    if (args.loopId) {
      if (args.projectId || args.language)
        fail("VALIDATION_ERROR", "Choose loopId or project/language, not both");
      const l = await ctx.db.get(args.loopId);
      if (!l) return fail("NOT_FOUND_OR_FORBIDDEN", "Loop unavailable");
      await project(ctx, l.projectId);
      return loopReadView(ctx, l);
    }
    if (!args.projectId || !args.language)
      return fail("VALIDATION_ERROR", "projectId and language required together");
    return loopReadView(ctx, await loop(ctx, args.projectId, args.language));
  },
});
export const getLoop = query(getLoopDef),
  agentGetLoop = aq(getLoopDef);

/** Not registered in agent gateway: trusted provider/worker action after real media/report ingestion. */
export async function recordVideoEvidence(ctx: MutationCtx, args: { evidence: unknown }) {
  const parsed = WorkflowEvidence.safeParse(args.evidence);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Evidence receipt schema invalid");
  const e = parsed.data;
  const jid = ctx.db.normalizeId("videoJobs", e.jobId),
    vid = ctx.db.normalizeId("videoVersions", e.versionId);
  const j = jid ? await ctx.db.get(jid) : null;
  if (
    !j ||
    j.state !== "succeeded" ||
    !vid ||
    j.versionId !== vid ||
    !j.projectId ||
    !(
      (e.method === "measurement" && j.kind === "render") ||
      (e.method === "provider_video" && j.kind === "critique")
    )
  )
    return fail(
      "EVIDENCE_UNAVAILABLE",
      "Evidence requires exact completed trusted measurement/critique job",
    );
  await version(ctx, vid, j.projectId);
  await asset(ctx, j.workspaceId, e.artifact, e.artifactSha256);
  await asset(ctx, j.workspaceId, e.report, e.reportSha256);
  const content = canonical(e),
    contentHash = await digest(e);
  const previous = await ctx.db
    .query("videoWorkflowEvidence")
    .withIndex("by_jobId", (q) => q.eq("jobId", j._id))
    .unique();
  if (previous) {
    if (previous.contentHash !== contentHash)
      fail("EVIDENCE_CONFLICT", "Completed job already has immutable evidence");
    return { evidenceId: previous._id };
  }
  return {
    evidenceId: await ctx.db.insert("videoWorkflowEvidence", {
      projectId: j.projectId,
      versionId: vid,
      jobId: j._id,
      content,
      contentHash,
    }),
  };
}
export const recordEvidence = internalMutation({
  args: { evidence: v.any() },
  handler: recordVideoEvidence,
});
async function evidence(
  ctx: Context,
  ids: Id<"videoWorkflowEvidence">[],
  projectId: Id<"videoProjects">,
) {
  if (!ids.length || ids.length > 30 || new Set(ids).size !== ids.length)
    return fail("EVIDENCE_REQUIRED", "Use 1–30 distinct persisted evidence IDs");
  const result = [];
  for (const id of ids) {
    const e = await ctx.db.get(id);
    if (!e || e.projectId !== projectId)
      return fail("NOT_FOUND_OR_FORBIDDEN", "Evidence unavailable in project");
    result.push({ id: e._id, ...WorkflowEvidence.parse(JSON.parse(e.content)) });
  }
  return result;
}
const proposeDef = mdef({
  args: {
    projectId: v.id("videoProjects"),
    language,
    expectedLoopRevision: v.string(),
    idempotencyKey: v.string(),
    baseline: v.id("videoVersions"),
    hypothesis: v.string(),
    evidenceIds: v.array(v.id("videoWorkflowEvidence")),
    changes: v.any(),
    evaluation: v.any(),
    iterationLimit: v.number(),
    noProgressLimit: v.number(),
  },
  handler: async (ctx, args) => {
    const l = await loop(ctx, args.projectId, args.language),
      p = await project(ctx, args.projectId),
      r = await replay(ctx, p.workspaceId, "loopPropose", args.idempotencyKey, args);
    if (r.previous)
      return JSON.parse(r.previous.result) as {
        proposalId: Id<"videoLoopProposals">;
        loopRevision: string;
      };
    if (l.revisionId !== args.expectedLoopRevision)
      fail("REVISION_CONFLICT", "Read loop and recompute hypothesis against current selection");
    if (l.state === "paused")
      fail("LOOP_PAUSED", l.stopReason ?? "Paused; do not resume to bypass a human");
    if (["awaiting_human", "finished"].includes(l.state))
      fail("HUMAN_ACTION_REQUIRED", l.stopReason ?? "Bounded loop stopped");
    if (l.pendingProposalId)
      fail("PROPOSAL_PENDING", "One pending proposal owns the iteration slot");
    if (!args.hypothesis.trim() || args.hypothesis.length > 16000)
      fail("VALIDATION_ERROR", "A bounded hypothesis is required");
    const evalParsed = WorkflowEvaluation.safeParse(args.evaluation),
      changesParsed = WorkflowChange.array().min(1).max(20).safeParse(args.changes);
    if (!evalParsed.success || !changesParsed.success)
      return fail("VALIDATION_ERROR", "Invalid evaluation/change contract");
    if (
      !Number.isInteger(args.iterationLimit) ||
      args.iterationLimit < 1 ||
      args.iterationLimit > 20 ||
      !Number.isInteger(args.noProgressLimit) ||
      args.noProgressLimit < 1 ||
      args.noProgressLimit > args.iterationLimit
    )
      fail("VALIDATION_ERROR", "Iteration limit 1–20; no-progress limit 1–iteration limit");
    if (
      l.iteration > 0 &&
      (l.iterationLimit !== args.iterationLimit ||
        l.noProgressLimit !== args.noProgressLimit ||
        l.evaluation !== canonical(evalParsed.data))
    )
      fail(
        "POLICY_PINNED",
        "Cannot relax limits or replace rubric/workflow within an existing loop",
      );
    const base = await version(ctx, args.baseline, p._id, args.language),
      draft = await ctx.db.get(base.draftId);
    if (draft?.currentVersionId !== base._id)
      fail(
        "STALE_BASE",
        "Proposal baseline must be latest checkpoint in this language; selected creative reference is preserved separately",
      );
    const script = Script.parse(JSON.parse(base.manifest).script);
    for (const change of changesParsed.data) {
      if (change.sceneIds.some((s) => !script.scenesById[s]))
        fail("SCOPE_MISMATCH", "Change references missing scene");
      for (const shot of change.shotIds)
        if (!change.sceneIds.some((s) => Boolean(script.scenesById[s]?.shotsById[shot])))
          fail("SCOPE_MISMATCH", "Shot is outside selected scenes");
    }
    const observed = await evidence(ctx, args.evidenceIds, p._id);
    if (!observed.some((e) => e.versionId === (l.selectedCandidate ?? base._id)))
      fail("EVIDENCE_REQUIRED", "Observe the currently selected reference before proposing");
    if (observed.some((e) => e.rubricHash !== evalParsed.data.rubricHash))
      fail("RUBRIC_MISMATCH", "Evidence rubric must match pinned evaluation");
    const proposalId = await ctx.db.insert("videoLoopProposals", {
      loopId: l._id,
      baseline: base._id,
      referenceVersion: l.selectedCandidate ?? base._id,
      humanInputRevision: l.humanInputRevision,
      projectRevision: p.revisionId,
      hypothesis: args.hypothesis,
      changes: canonical(changesParsed.data),
      evidenceIds: args.evidenceIds,
      state: "proposed",
    });
    const revisionId = await digest({ parent: l.revisionId, proposalId });
    await ctx.db.patch(l._id, {
      revisionId,
      state: "active",
      iteration: l.iteration + 1,
      iterationLimit: args.iterationLimit,
      noProgressLimit: args.noProgressLimit,
      evaluation: canonical(evalParsed.data),
      baseline: base._id,
      selectedCandidate: l.selectedCandidate ?? base._id,
      pendingProposalId: proposalId,
    });
    const result = { proposalId, loopRevision: revisionId };
    await remember(ctx, r, result);
    return result;
  },
});
export const propose = mutation(proposeDef),
  agentPropose = am(proposeDef);

const selectDef = mdef({
  args: {
    loopId: v.id("videoLoops"),
    expectedLoopRevision: v.string(),
    idempotencyKey: v.string(),
    proposalId: v.id("videoLoopProposals"),
    candidate: v.id("videoVersions"),
    evidenceIds: v.array(v.id("videoWorkflowEvidence")),
    decision: v.union(v.literal("select"), v.literal("revert")),
    rationale: v.string(),
  },
  handler: async (ctx, args) => {
    const l = await ctx.db.get(args.loopId);
    if (!l) return fail("NOT_FOUND_OR_FORBIDDEN", "Loop unavailable");
    const p = await project(ctx, l.projectId),
      r = await replay(ctx, p.workspaceId, "loopSelect", args.idempotencyKey, args);
    if (r.previous)
      return JSON.parse(r.previous.result) as ReturnType<typeof loopView> & {
        requiresHumanReview: boolean;
      };
    if (l.revisionId !== args.expectedLoopRevision)
      fail("REVISION_CONFLICT", "Read current loop; recompute decision");
    if (l.state !== "active")
      fail(
        l.state === "paused" ? "LOOP_PAUSED" : "HUMAN_ACTION_REQUIRED",
        l.stopReason ?? "Loop is not active",
      );
    const proposal = await ctx.db.get(args.proposalId);
    if (
      !proposal ||
      proposal.loopId !== l._id ||
      proposal.state !== "proposed" ||
      l.pendingProposalId !== proposal._id
    )
      return fail("PROPOSAL_STALE", "Proposal is not pending for this loop");
    if (
      proposal.humanInputRevision !== l.humanInputRevision ||
      proposal.projectRevision !== p.revisionId
    )
      fail(
        "HUMAN_INPUT_CHANGED",
        "Human inputs/brief changed; review them before another decision",
      );
    if (!args.rationale.trim() || args.rationale.length > 16000)
      fail("VALIDATION_ERROR", "Decision rationale required");
    const candidate = await version(ctx, args.candidate, p._id, l.language),
      draft = await ctx.db.get(candidate.draftId);
    if (draft?.currentVersionId !== candidate._id || candidate._id === proposal.baseline)
      fail(
        "STALE_BASE",
        "Candidate must be a new current checkpoint, not reference or stale result",
      );
    let ancestor: Doc<"videoVersions"> | null = candidate;
    let descended = false;
    for (let depth = 0; ancestor && depth < 100; depth++) {
      if (ancestor._id === proposal.baseline) {
        descended = true;
        break;
      }
      ancestor = ancestor.parentVersionId ? await ctx.db.get(ancestor.parentVersionId) : null;
    }
    if (!descended)
      fail(
        "SCOPE_MISMATCH",
        "Candidate must descend from proposal baseline within 100 checkpoints; ancestry unavailable is not proof",
      );
    const observed = await evidence(ctx, args.evidenceIds, p._id),
      evaluation = WorkflowEvaluation.parse(JSON.parse(l.evaluation!));
    if (observed.some((e) => e.rubricHash !== evaluation.rubricHash))
      fail("RUBRIC_MISMATCH", "Evidence must use pinned rubric");
    const candidateEvidence = observed.filter((e) => e.versionId === candidate._id);
    if (!candidateEvidence.length)
      fail("EVIDENCE_REQUIRED", "Observe exact candidate before deciding");
    if (args.decision === "select") {
      if (!observed.some((e) => e.versionId === proposal.referenceVersion))
        fail("COMPARISON_REQUIRED", "Include evidence for selected reference and exact candidate");
      if (
        candidateEvidence.some((e) => e.outcome !== "pass" || e.uncertainty.length) ||
        !candidateEvidence.some((e) => e.method === "measurement") ||
        !candidateEvidence.some((e) => e.method === "provider_video")
      )
        fail(
          "COMPARISON_REQUIRED",
          "Selection requires passing technical and independent real-video evidence without unresolved uncertainty; no scalar score shortcut",
        );
      if (new Set(candidateEvidence.map((e) => e.artifactSha256)).size !== 1)
        fail(
          "EVIDENCE_MISMATCH",
          "Technical and critique reports must evaluate the same exact media bytes",
        );
    }
    const noProgress = args.decision === "revert" ? l.noProgress + 1 : 0;
    const stopReason =
      l.iteration >= l.iterationLimit
        ? "iteration_limit"
        : noProgress >= l.noProgressLimit
          ? "no_progress"
          : null;
    const revisionId = await digest({
      parent: l.revisionId,
      decision: args.decision,
      candidate: candidate._id,
    });
    await ctx.db.patch(proposal._id, {
      state: args.decision === "select" ? "selected" : "reverted",
      candidate: candidate._id,
      decisionEvidenceIds: args.evidenceIds,
      rationale: args.rationale,
    });
    await ctx.db.patch(l._id, {
      revisionId,
      selectedCandidate: args.decision === "select" ? candidate._id : l.selectedCandidate,
      pendingProposalId: null,
      noProgress,
      state: stopReason ? "awaiting_human" : "active",
      stopReason,
    });
    const updated = await ctx.db.get(l._id);
    const result = { ...loopView(updated!), requiresHumanReview: true };
    await remember(ctx, r, result);
    return result;
  },
});
export const select = mutation(selectDef),
  agentSelect = am(selectDef);

const controlArgs = {
  loopId: v.id("videoLoops"),
  expectedLoopRevision: v.string(),
  idempotencyKey: v.string(),
};
const pauseDef = mdef({
  args: {
    ...controlArgs,
    reason: v.string(),
    runningJobs: v.union(v.literal("leave_running"), v.literal("request_cancel")),
  },
  handler: async (ctx, args) => {
    const l = await ctx.db.get(args.loopId);
    if (!l) return fail("NOT_FOUND_OR_FORBIDDEN", "Loop unavailable");
    const p = await project(ctx, l.projectId),
      r = await replay(ctx, p.workspaceId, "loopPause", args.idempotencyKey, args);
    if (r.previous)
      return JSON.parse(r.previous.result) as {
        loopRevision: string;
        state: "paused";
        cancellationRequestedJobIds: string[];
      };
    if (l.revisionId !== args.expectedLoopRevision)
      fail("REVISION_CONFLICT", "Read current loop before pause");
    if (!args.reason.trim() || args.reason.length > 16000)
      fail("VALIDATION_ERROR", "Pause reason required");
    const cancellationRequestedJobIds: string[] = [];
    if (args.runningJobs === "request_cancel") {
      // Bound transaction work; refuse before writing rather than silently leave unmatched active jobs.
      const queued = await ctx.db
        .query("videoJobs")
        .withIndex("by_projectId_and_state", (q) => q.eq("projectId", p._id).eq("state", "queued"))
        .take(101);
      const running = await ctx.db
        .query("videoJobs")
        .withIndex("by_projectId_and_state", (q) => q.eq("projectId", p._id).eq("state", "running"))
        .take(101);
      if (queued.length + running.length > 100)
        fail(
          "CAPACITY_EXCEEDED",
          "Pause with leave_running then cancel explicit jobs in bounded pages; more than 100 active jobs",
        );
      for (const job of [...queued, ...running]) {
        const ver = job.versionId ? await ctx.db.get(job.versionId) : null;
        if (ver && ver.language !== l.language) continue;
        await ctx.db.patch(job._id, {
          state: job.state === "queued" ? "cancelled" : "cancel_requested",
          updatedAt: Date.now(),
        });
        cancellationRequestedJobIds.push(job._id);
      }
    }
    const revisionId = await digest({ parent: l.revisionId, pause: args.reason });
    await ctx.db.patch(l._id, {
      revisionId,
      state: "paused",
      stopReason: args.reason,
      pausedByHuman: l.pausedByHuman || !("videoPrincipalId" in ctx),
    });
    const result = {
      loopRevision: revisionId,
      state: "paused" as const,
      cancellationRequestedJobIds,
    };
    await remember(ctx, r, result);
    return result;
  },
});
export const pause = mutation(pauseDef),
  agentPause = am(pauseDef);
const resumeDef = mdef({
  args: controlArgs,
  handler: async (ctx, args) => {
    const l = await ctx.db.get(args.loopId);
    if (!l) return fail("NOT_FOUND_OR_FORBIDDEN", "Loop unavailable");
    const p = await project(ctx, l.projectId),
      r = await replay(ctx, p.workspaceId, "loopResume", args.idempotencyKey, args);
    if (r.previous)
      return JSON.parse(r.previous.result) as {
        loopRevision: string;
        state: "active";
        nextAction: string;
      };
    if (l.revisionId !== args.expectedLoopRevision)
      fail("REVISION_CONFLICT", "Read loop before resume");
    if (l.pausedByHuman && "videoPrincipalId" in ctx)
      fail("HUMAN_ACTION_REQUIRED", "Only authenticated review UI can resume a human pause");
    if (
      l.state !== "paused" ||
      l.iteration >= l.iterationLimit ||
      l.noProgress >= l.noProgressLimit
    )
      fail("HUMAN_ACTION_REQUIRED", "Resume does not reset bounds or restart a stopped experiment");
    const revisionId = await digest({ parent: l.revisionId, resume: true });
    await ctx.db.patch(l._id, {
      revisionId,
      state: "active",
      stopReason: null,
      pausedByHuman: false,
    });
    const result = {
      loopRevision: revisionId,
      state: "active" as const,
      nextAction:
        "Harness reads current context and drives next explicit operation; no cloud reasoning started",
    };
    await remember(ctx, r, result);
    return result;
  },
});
export const resume = mutation(resumeDef),
  agentResume = am(resumeDef);

/** Human-only explicit abandonment; intentionally no agent* export/gateway. */
export const abandonPending = mutation({
  args: { ...controlArgs, reason: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireUserId(ctx, await requireIotaIdentity(ctx));
    const l = await ctx.db.get(args.loopId);
    if (!l) return fail("NOT_FOUND_OR_FORBIDDEN", "Loop unavailable");
    const p = await project(ctx, l.projectId),
      saved = await replay(ctx, p.workspaceId, "humanAbandonPending", args.idempotencyKey, args);
    if (saved.previous)
      return JSON.parse(saved.previous.result) as {
        loopId: Id<"videoLoops">;
        loopRevision: string;
        state: "paused" | "awaiting_human";
        nextAction: string;
      };
    if (l.revisionId !== args.expectedLoopRevision)
      fail("REVISION_CONFLICT", "Read the current loop before abandoning the pending proposal");
    if (!args.reason.trim() || args.reason.length > 2000)
      fail("VALIDATION_ERROR", "Human replanning needs a reason of 1–2000 characters");
    const pending = l.pendingProposalId ? await ctx.db.get(l.pendingProposalId) : null;
    if (!pending || pending.state !== "proposed")
      return fail("PROPOSAL_REQUIRED", "No pending proposal to abandon");
    const state =
      l.iteration >= l.iterationLimit || l.noProgress >= l.noProgressLimit
        ? ("awaiting_human" as const)
        : ("paused" as const);
    const revisionId = await digest({
      parent: l.revisionId,
      abandoned: pending._id,
      actor,
      reason: args.reason,
    });
    await ctx.db.patch(pending._id, {
      state: "abandoned",
      rationale: args.reason,
      abandonedBy: actor,
      abandonedAt: Date.now(),
    });
    await ctx.db.patch(l._id, {
      revisionId,
      pendingProposalId: null,
      state,
      pausedByHuman: true,
      stopReason:
        state === "awaiting_human" ? "bounds_exhausted_after_abandon" : "human_abandoned_proposal",
      humanInputRevision: l.humanInputRevision + 1,
    });
    const result = {
      loopId: l._id,
      loopRevision: revisionId,
      state,
      nextAction:
        "Read current user direction and exact selected reference. No code/provider dispatch occurred. Spent rounds, no-progress and frozen policy remain unchanged; explicit human resume is possible only within remaining bounds.",
    };
    await remember(ctx, saved, result);
    return result;
  },
});

const contextDef = qdef({
  args: {
    projectId: v.id("videoProjects"),
    language,
    versionId: v.optional(v.id("videoVersions")),
    role: v.string(),
    task: v.string(),
    sceneIds: v.optional(v.array(v.string())),
    shotIds: v.optional(v.array(v.string())),
    include: v.optional(v.array(v.string())),
    maxBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await user(ctx);
    const p = await project(ctx, args.projectId),
      role = WorkflowRole.safeParse(args.role);
    if (!role.success) fail("VALIDATION_ERROR", "Unknown context role");
    if (
      !args.task.trim() ||
      args.task.length > 16000 ||
      (args.sceneIds?.length ?? 0) > 100 ||
      (args.shotIds?.length ?? 0) > 100
    )
      fail("VALIDATION_ERROR", "Bound task and scene/shot scope");
    const maxBytes = args.maxBytes ?? 32768;
    if (!Number.isInteger(maxBytes) || maxBytes < 2048 || maxBytes > 131072)
      fail("VALIDATION_ERROR", "maxBytes must be 2048–131072");
    const d = await ctx.db
      .query("videoDrafts")
      .withIndex("by_projectId_and_language", (q) =>
        q.eq("projectId", p._id).eq("language", args.language),
      )
      .unique();
    if (!d) return fail("NOT_FOUND_OR_FORBIDDEN", "Language branch unavailable");
    const ver = args.versionId
      ? await version(ctx, args.versionId, p._id, args.language)
      : d.currentVersionId
        ? await version(ctx, d.currentVersionId, p._id, args.language)
        : null;
    const manifest = ver
      ? JSON.parse(ver.manifest)
      : {
          brief: JSON.parse(p.brief),
          script: JSON.parse(d.script),
          timeline: JSON.parse(d.timeline),
        };
    const script = Script.parse(manifest.script),
      timeline = Timeline.parse(manifest.timeline),
      selected = args.sceneIds?.length ? args.sceneIds : script.sceneOrder;
    if (selected.some((s) => !script.scenesById[s]))
      fail("SCOPE_MISMATCH", "Context scene is not in exact version");
    const neighbors = new Set(selected);
    for (const id of selected) {
      const i = script.sceneOrder.indexOf(id);
      if (i > 0) neighbors.add(script.sceneOrder[i - 1]!);
      if (i + 1 < script.sceneOrder.length) neighbors.add(script.sceneOrder[i + 1]!);
    }
    if (
      args.shotIds?.some(
        (id) => !selected.some((s) => Boolean(script.scenesById[s]?.shotsById[id])),
      )
    )
      fail("SCOPE_MISMATCH", "Shot outside selected scenes");
    const blind = args.role === "critic",
      sections: {
        name: string;
        content: unknown;
        sources: { kind: string; id: string; revision: string }[];
      }[] = [],
      omitted: { section: string; reason: string }[] = [];
    const includes = new Set(
      args.include ?? [
        "brief",
        "script",
        "timeline",
        "profile",
        "assets",
        "feedback",
        "qa",
        "memory",
      ],
    );
    const source = {
      kind: ver ? "version" : "draft",
      id: ver ? ver._id : d._id,
      revision: ver ? ver.manifestSha256 : `${d.scriptRevision}:${d.timelineRevision}`,
    };
    function add(
      name: string,
      content: unknown,
      sources: { kind: string; id: string; revision: string }[] = [source],
    ) {
      if (!includes.has(name)) return;
      const entry = { name, content, sources };
      if (
        new TextEncoder().encode(canonical({ sections: [...sections, entry], omitted })).length >
        maxBytes - 1536
      )
        omitted.push({ section: name, reason: "max_bytes; retrieve exact source separately" });
      else sections.push(entry);
    }
    add("brief", {
      ...Brief.parse(manifest.brief),
      policy:
        "Explicit current user instructions outrank profile suggestions. Stored topic/direction are user-reported inputs, not cryptographic proof of human authorship.",
    });
    if (blind)
      omitted.push({
        section: "script",
        reason:
          "Blind critic excludes author script, rationale, prior scores and production intent. Use separate reviewer role for brief-compliance.",
      });
    else
      add("script", {
        language: script.language,
        writingSystem: script.writingSystem,
        scenes: script.sceneOrder
          .filter((s) => neighbors.has(s))
          .map((id) => ({
            id,
            neighbor: !selected.includes(id),
            ...script.scenesById[id],
            shotOrder: script.scenesById[id]!.shotOrder.filter(
              (shot) => !args.shotIds?.length || args.shotIds.includes(shot),
            ),
            shotContexts: script.scenesById[id]!.shotOrder.filter(
              (shot) => !args.shotIds?.length || args.shotIds.includes(shot),
            ).map((shotId) => ({
              sceneId: id,
              shotId,
              plannedDurationMs: script.scenesById[id]!.shotsById[shotId]!.durationMs ?? null,
              editHandlesMs: script.scenesById[id]!.shotsById[shotId]!.editHandlesMs ?? null,
              clips: timeline.trackOrder.flatMap((trackId) => {
                const track = timeline.tracksById[trackId]!;
                return track.clipOrder.flatMap((clipId) => {
                  const clip = track.clipsById[clipId]!;
                  if (clip.sceneId !== id || clip.shotId !== shotId) return [];
                  return [
                    {
                      trackId,
                      clipId,
                      startFrame: clip.startFrame,
                      durationFrames: clip.durationFrames,
                      durationMs:
                        (clip.durationFrames * 1000 * timeline.fps.denominator) /
                        timeline.fps.numerator,
                      source: clip.source,
                      layout: clip.layout ?? null,
                    },
                  ];
                });
              }),
              mappingPolicy:
                "Only explicit sceneId/shotId bindings; absent clips are not inferred. Layout fit is not an explicit crop rectangle.",
            })),
            shotsById: Object.fromEntries(
              Object.entries(script.scenesById[id]!.shotsById).filter(
                ([shot]) => !args.shotIds?.length || args.shotIds.includes(shot),
              ),
            ),
          })),
      });
    const media: unknown[] = [];
    for (const trackId of timeline.trackOrder) {
      const track = timeline.tracksById[trackId]!;
      for (const clipId of track.clipOrder) {
        const clip = track.clipsById[clipId]!;
        if (clip.sceneId && !neighbors.has(clip.sceneId)) continue;
        if (args.shotIds?.length && clip.shotId && !args.shotIds.includes(clip.shotId)) continue;
        if (clip.source.kind === "asset")
          media.push({ trackId, clipId, kind: track.kind, ...clip });
      }
    }
    add("assets", {
      media,
      registeredSources: await Promise.all(
        [
          ...new Map(
            media.flatMap((entry) => {
              const clip = entry as { source: { asset: { assetId: string; revisionId: string } } };
              return [
                [
                  `${clip.source.asset.assetId}:${clip.source.asset.revisionId}`,
                  clip.source.asset,
                ] as const,
              ];
            }),
          ).values(),
        ]
          .slice(0, 100)
          .map(async (ref) => {
            const revision = await asset(ctx, p.workspaceId, ref);
            return {
              asset: ref,
              sha256: revision.contentHash ?? null,
              metadata: revision.mediaMetadata ?? null,
            };
          }),
      ),
      registeredSourceLimit: 100,
      timebase: timeline.fps,
      sourcePolicy: "Pinned source revisions; a contact sheet does not prove temporal continuity",
    });
    if (!blind)
      add("timeline", {
        fps: timeline.fps,
        durationFrames: timeline.durationFrames,
        tracks: timeline.trackOrder.map((id) => ({
          id,
          ...timeline.tracksById[id],
          clipsById: Object.fromEntries(
            Object.entries(timeline.tracksById[id]!.clipsById).filter(
              ([, c]) => !c.sceneId || neighbors.has(c.sceneId),
            ),
          ),
          clipOrder: timeline.tracksById[id]!.clipOrder.filter((cid) => {
            const c = timeline.tracksById[id]!.clipsById[cid]!;
            return !c.sceneId || neighbors.has(c.sceneId);
          }),
        })),
      });
    const pinned = manifest.profile as { profileId?: string; revisionId?: string } | undefined;
    if (ver && !pinned?.revisionId)
      omitted.push({
        section: "profile",
        reason:
          "Historical version has no pinned profile; latest suggestions must not be retroactively attached",
      });
    else {
      const profile = await profileAt(ctx, p._id, pinned?.revisionId),
        doc = profile.document;
      if (
        (!doc.language || doc.language === args.language) &&
        (!doc.versionId || doc.versionId === ver?._id) &&
        (!doc.sceneIds.length || doc.sceneIds.some((s) => neighbors.has(s)))
      )
        add(
          "profile",
          {
            ...(blind
              ? { language: doc.language, versionId: doc.versionId, sceneIds: doc.sceneIds }
              : doc),
            entries: doc.entries.filter((e) =>
              blind
                ? e.kind === "fact" && e.status === "sourced"
                : args.role === "writer" || args.role === "image_artist"
                  ? e.kind !== "pronunciation"
                  : true,
            ),
            trust:
              "Sourced means attributed, not verified. Hypotheses remain hypotheses; unknown stays null.",
          },
          [{ kind: "profile", id: profile.profileId, revision: profile.revisionId }],
        );
      else
        omitted.push({
          section: "profile",
          reason: "Pinned profile scope does not match selected language/version/scenes",
        });
    }
    if (!blind && ver && includes.has("qa")) {
      const rows = await ctx.db
        .query("videoWorkflowEvidence")
        .withIndex("by_versionId", (q) => q.eq("versionId", ver._id))
        .take(31);
      add("qa", {
        evidence: rows
          .slice(0, 30)
          .map((e) => ({ evidenceId: e._id, ...WorkflowEvidence.parse(JSON.parse(e.content)) })),
        complete: rows.length <= 30,
      });
    }
    if (!blind && includes.has("feedback")) {
      const comments = await ctx.db
        .query("videoComments")
        .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", p._id))
        .order("desc")
        .take(31);
      add("feedback", {
        comments: comments
          .slice(0, 30)
          .filter((c) => c.language === args.language && c.status !== "resolved")
          .map((c) => ({
            commentId: c._id,
            revision: c.revision,
            target: c.target,
            body: c.body,
            authorKind: c.authorKind,
            status: c.status,
          })),
        complete: comments.length <= 30,
        policy:
          "Human notes/directives outrank suggestions; agent completion is not human resolution. Exact anchors identify possibly stale feedback.",
      });
    }
    if (!blind && includes.has("memory")) {
      const memories = await ctx.db
        .query("videoMemories")
        .withIndex("by_projectId_and_status", (q) =>
          q.eq("projectId", p._id).eq("status", "supported"),
        )
        .take(31);
      add("memory", {
        lessons: memories
          .slice(0, 30)
          .filter((m) => m.language === args.language)
          .map((m) => ({
            memoryId: m._id,
            revisionId: m.revisionId,
            proposal: JSON.parse(m.content),
            validation: m.validation ? JSON.parse(m.validation) : null,
          })),
        complete: memories.length <= 30,
        policy:
          "Scoped evidence-supported advice only, not instructions or universal truth. Explicit user direction wins.",
      });
    }
    for (const section of [
      ...(blind ? ["feedback", "memory"] : []),
      ...(blind || !ver ? ["qa"] : []),
    ])
      if (includes.has(section))
        omitted.push({
          section,
          reason: blind
            ? "Excluded from independent critic context"
            : "Use dedicated readers; this context projection does not yet include this section",
        });
    const result = {
      snapshotRevision: await digest({
        source,
        sections,
        omitted,
        role: args.role,
        task: args.task,
        sceneIds: selected,
        shotIds: args.shotIds ?? [],
      }),
      sections,
      omitted,
      unresolvedQuestions: [
        "Creative efficacy and future views are unproven; human review remains independent of agent selection.",
      ],
    };
    return { contextId: result.snapshotRevision, ...result };
  },
});
export const getContext = query(contextDef),
  agentGetContext = aq(contextDef);

// Shared authenticated domain primitives; these are not registered Convex functions.
export {
  am,
  aq,
  asset,
  digest,
  evidence,
  fail,
  mdef,
  project,
  qdef,
  remember,
  replay,
  user,
  version,
};
