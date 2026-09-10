import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { canonical } from "../packages/video/src/contracts";
import { JobRequest } from "../packages/video/src/jobs";
import {
  AnalyticsImport,
  MemoryProposal,
  OfflineEvaluation,
  PublicationRecord,
} from "../packages/video/src/learning";
import { WorkflowEvidence } from "../packages/video/src/workflow";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { FIXTURE_CASES, FIXTURE_CONFIG } from "./videoLearningFixtures";
import {
  am,
  aq,
  asset,
  digest,
  fail,
  mdef,
  project,
  qdef,
  remember,
  replay,
  user,
} from "./videoWorkflow";

export const MEMORY_POLICY = {
  id: "independent-video-v1",
  requirements: [
    "distinct underlying projects",
    "distinct media hashes",
    "distinct report hashes",
    "one rubric",
    "development and heldout",
    "no unresolved contradictory evidence",
    "not deterministic fixture evidence",
  ],
};
type Context = QueryCtx | MutationCtx;
function page(args: { numItems: number }) {
  if (!Number.isInteger(args.numItems) || args.numItems < 1 || args.numItems > 100)
    fail("VALIDATION_ERROR", "Page size must be 1–100");
}
async function memory(ctx: Context, id: Id<"videoMemories">) {
  const row = await ctx.db.get(id);
  if (!row || !(await ctx.db.get(row.workspaceId)))
    return fail("NOT_FOUND_OR_FORBIDDEN", "Memory unavailable");
  return row;
}
function memoryView(m: Doc<"videoMemories">) {
  return {
    memoryId: m._id,
    revisionId: m.revisionId,
    projectId: m.projectId,
    profileId: m.profileId ?? null,
    status: m.status,
    ...MemoryProposal.parse(JSON.parse(m.content)),
    validation: m.validation ? JSON.parse(m.validation) : null,
  };
}
async function observations(ctx: Context, workspaceId: Id<"workspaces">, ids: string[]) {
  if (!ids.length || ids.length > 100) fail("VALIDATION_ERROR", "Expected 1–100 evidence IDs");
  const result = [];
  for (const raw of new Set(ids)) {
    const id = ctx.db.normalizeId("videoWorkflowEvidence", raw),
      e = id ? await ctx.db.get(id) : null;
    if (!e) return fail("NOT_FOUND_OR_FORBIDDEN", "Evidence unavailable");
    const p = await project(ctx, e.projectId);
    if (p.workspaceId !== workspaceId)
      fail("NOT_FOUND_OR_FORBIDDEN", "Evidence workspace mismatch");
    const version = await ctx.db.get(e.versionId);
    if (!version) return fail("NOT_FOUND_OR_FORBIDDEN", "Evidence version unavailable");
    result.push({
      evidenceId: e._id,
      projectId: e.projectId,
      language: version.language,
      ...WorkflowEvidence.parse(JSON.parse(e.content)),
    });
  }
  return result;
}
const proposeDef = mdef({
  args: { workspaceId: v.id("workspaces"), idempotencyKey: v.string(), proposal: v.any() },
  handler: async (ctx, args) => {
    const parsed = MemoryProposal.safeParse(args.proposal);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Memory proposal contract invalid");
    const input = parsed.data,
      r = await replay(ctx, args.workspaceId, "memoryPropose", args.idempotencyKey, {
        ...args,
        proposal: input,
      });
    if (r.previous)
      return JSON.parse(r.previous.result) as {
        memoryId: Id<"videoMemories">;
        revisionId: string;
        status: "proposed";
      };
    const profileId =
        input.scope.kind === "profile"
          ? ctx.db.normalizeId("videoProfiles", input.scope.profileId)
          : null,
      profile = profileId ? await ctx.db.get(profileId) : null;
    const projectId =
      input.scope.kind === "project"
        ? ctx.db.normalizeId("videoProjects", input.scope.projectId)
        : profile?.projectId;
    if (!projectId) return fail("NOT_FOUND_OR_FORBIDDEN", "Memory scope unavailable");
    const p = await project(ctx, projectId);
    if (p.workspaceId !== args.workspaceId)
      fail("NOT_FOUND_OR_FORBIDDEN", "Memory workspace mismatch");
    const evidence = await observations(ctx, args.workspaceId, [
      ...input.supportingEvidenceIds,
      ...input.contradictingEvidenceIds,
    ]);
    if (
      evidence.some(
        (e) =>
          e.language !== input.language ||
          (input.scope.kind === "project" && e.projectId !== projectId),
      )
    )
      fail("SCOPE_MISMATCH", "Evidence is outside memory language/project scope");
    const content = canonical(input),
      revisionId = await digest(input),
      memoryId = await ctx.db.insert("videoMemories", {
        workspaceId: args.workspaceId,
        projectId,
        ...(profileId ? { profileId } : {}),
        language: input.language,
        revisionId,
        content,
        status: "proposed",
      });
    await ctx.db.insert("videoMemoryRevisions", {
      memoryId,
      revisionId,
      content,
      status: "proposed",
    });
    const result = { memoryId, revisionId, status: "proposed" as const };
    await remember(ctx, r, result);
    return result;
  },
});
export const proposeMemory = mutation(proposeDef),
  agentProposeMemory = am(proposeDef);
const getMemoryDef = qdef({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("videoProjects")),
    language: v.optional(v.union(v.literal("ru"), v.literal("uz"))),
    status: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("supported"),
        v.literal("rejected"),
        v.literal("superseded"),
      ),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await user(ctx);
    if (!(await ctx.db.get(args.workspaceId)))
      fail("NOT_FOUND_OR_FORBIDDEN", "Workspace unavailable");
    page(args.paginationOpts);
    if (args.projectId && (await project(ctx, args.projectId)).workspaceId !== args.workspaceId)
      fail("NOT_FOUND_OR_FORBIDDEN", "Project mismatch");
    const rows = await ctx.db
      .query("videoMemories")
      .withIndex("by_workspaceId_and_status", (q) =>
        args.status
          ? q.eq("workspaceId", args.workspaceId).eq("status", args.status)
          : q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...rows,
      policy: MEMORY_POLICY,
      policyHash: await digest(MEMORY_POLICY),
      page: rows.page
        .filter(
          (m) =>
            (!args.projectId || m.projectId === args.projectId) &&
            (!args.language || m.language === args.language),
        )
        .map(memoryView),
    };
  },
});
export const getMemory = query(getMemoryDef),
  agentGetMemory = aq(getMemoryDef);
const memoryRecordDef = qdef({
  args: { memoryId: v.id("videoMemories") },
  handler: async (ctx, args) => {
    await user(ctx);
    const m = await memory(ctx, args.memoryId);
    return { workspaceId: m.workspaceId, ...memoryView(m) };
  },
});
export const getMemoryRecord = query(memoryRecordDef),
  agentGetMemoryRecord = aq(memoryRecordDef);

const recordDef = mdef({
  args: { workspaceId: v.id("workspaces"), idempotencyKey: v.string(), record: v.any() },
  handler: async (ctx, args) => {
    const parsed = PublicationRecord.safeParse(args.record);
    if (!parsed.success)
      return fail("VALIDATION_ERROR", "Publication source/revision contract invalid");
    const input = parsed.data,
      r = await replay(ctx, args.workspaceId, "publicationRecord", args.idempotencyKey, {
        ...args,
        record: input,
      });
    if (r.previous)
      return JSON.parse(r.previous.result) as {
        publicationId: Id<"videoPublications">;
        revisionId: string;
        verification: "recorded";
      };
    const jid = ctx.db.normalizeId("videoJobs", input.renderJobId),
      job = jid ? await ctx.db.get(jid) : null;
    if (
      !job ||
      job.workspaceId !== args.workspaceId ||
      job.kind !== "render" ||
      job.state !== "succeeded" ||
      !job.projectId ||
      !job.versionId ||
      !job.result
    )
      return fail("NOT_FOUND_OR_FORBIDDEN", "Publication requires exact completed render");
    const render = JSON.parse(job.result) as {
      kind?: string;
      partial?: boolean;
      sha256?: string;
      video?: { assetId: string; revisionId: string };
    };
    if (render.kind !== "render" || render.partial || !render.sha256 || !render.video)
      fail("VALIDATION_ERROR", "Partial/nonvideo result cannot be registered as publication");
    await asset(ctx, args.workspaceId, render.video!, render.sha256);
    await asset(ctx, args.workspaceId, input.source.asset, input.source.sha256);
    const version = await ctx.db.get(job.versionId);
    if (!version) return fail("NOT_FOUND_OR_FORBIDDEN", "Version unavailable");
    const previous = await ctx.db
      .query("videoPublications")
      .withIndex("by_workspaceId_and_platform_and_externalPostId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("platform", input.platform)
          .eq("externalPostId", input.externalPostId),
      )
      .unique();
    if ((previous?.revisionId ?? null) !== input.expectedRevision)
      fail("REVISION_CONFLICT", "Read publication revision before recording correction");
    if (
      previous &&
      (previous.projectId !== job.projectId || previous.language !== version.language)
    )
      fail("SCOPE_MISMATCH", "External post identity cannot move project/language");
    const value = {
        ...input,
        projectId: job.projectId,
        versionId: job.versionId,
        language: version.language,
        artifact: render.video,
        artifactSha256: render.sha256,
        verification: "recorded" as const,
      },
      content = canonical(value),
      revisionId = await digest({ parent: previous?.revisionId ?? null, value });
    const publicationId = previous
      ? previous._id
      : await ctx.db.insert("videoPublications", {
          workspaceId: args.workspaceId,
          projectId: job.projectId,
          language: version.language,
          platform: input.platform,
          externalPostId: input.externalPostId,
          revisionId,
          content,
        });
    if (previous) await ctx.db.patch(previous._id, { revisionId, content });
    await ctx.db.insert("videoPublicationRevisions", { publicationId, revisionId, content });
    const result = { publicationId, revisionId, verification: "recorded" as const };
    await remember(ctx, r, result);
    return result;
  },
});
export const recordPublication = mutation(recordDef),
  agentRecordPublication = am(recordDef);
const publicationDef = qdef({
  args: { publicationId: v.id("videoPublications"), revisionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await user(ctx);
    const p = await ctx.db.get(args.publicationId);
    if (!p) return fail("NOT_FOUND_OR_FORBIDDEN", "Publication unavailable");
    await project(ctx, p.projectId);
    const row = args.revisionId
      ? await ctx.db
          .query("videoPublicationRevisions")
          .withIndex("by_publicationId_and_revisionId", (q) =>
            q.eq("publicationId", p._id).eq("revisionId", args.revisionId!),
          )
          .unique()
      : p;
    if (!row) return fail("NOT_FOUND_OR_FORBIDDEN", "Publication revision unavailable");
    return { publicationId: p._id, revisionId: row.revisionId, record: JSON.parse(row.content) };
  },
});
export const getPublication = query(publicationDef),
  agentGetPublication = aq(publicationDef);
const analyticsDef = qdef({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.id("videoProjects"),
    publicationId: v.optional(v.id("videoPublications")),
    language: v.optional(v.union(v.literal("ru"), v.literal("uz"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await user(ctx);
    if ((await project(ctx, args.projectId)).workspaceId !== args.workspaceId)
      fail("NOT_FOUND_OR_FORBIDDEN", "Project workspace mismatch");
    page(args.paginationOpts);
    const rows = await ctx.db
      .query("videoMetrics")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .paginate(args.paginationOpts);
    return {
      ...rows,
      page: rows.page
        .filter(
          (r) =>
            (!args.publicationId || r.publicationId === args.publicationId) &&
            (!args.language || r.language === args.language),
        )
        .map((row) => ({
          observationId: row._id,
          publicationId: row.publicationId,
          publicationRevision: row.publicationRevision,
          language: row.language,
          ...JSON.parse(row.content),
          comparisonGroup: JSON.parse(row.groupKey),
          caveats: [
            "Descriptive observations, not causal improvement or guaranteed reach",
            "Unknown publication age remains incomparable across posts/windows",
          ],
        })),
    };
  },
});
export const getAnalytics = query(analyticsDef),
  agentGetAnalytics = aq(analyticsDef);
const evalDef = qdef({
  args: { evalId: v.id("videoEvaluations") },
  handler: async (ctx, args) => {
    await user(ctx);
    const e = await ctx.db.get(args.evalId);
    if (!e || !(await ctx.db.get(e.workspaceId)))
      return fail("NOT_FOUND_OR_FORBIDDEN", "Evaluation unavailable");
    return {
      evalId: e._id,
      workspaceId: e.workspaceId,
      jobId: e.jobId,
      reportHash: e.reportHash,
      report: JSON.parse(e.report),
    };
  },
});
export const getEval = query(evalDef),
  agentGetEval = aq(evalDef);

async function claimed(ctx: MutationCtx, jobId: Id<"videoJobs">, fence: number) {
  const j = await ctx.db.get(jobId);
  if (
    !j ||
    j.state !== "running" ||
    j.fence !== fence ||
    !(await ctx.db.get(j.principalId)) ||
    !(await ctx.db.get(j.workspaceId))
  )
    return fail("STALE_FENCE", "Learning job not owned/running");
  return j;
}
async function complete(ctx: MutationCtx, j: Doc<"videoJobs">, result: unknown) {
  await ctx.runMutation(makeFunctionReference<"mutation">("videoJobs:complete"), {
    jobId: j._id,
    fence: j.fence,
    result,
  });
}
export const applyJob = internalMutation({
  args: { jobId: v.id("videoJobs"), fence: v.number(), fixtureReport: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const j = await claimed(ctx, args.jobId, args.fence),
      request = JobRequest.parse(JSON.parse(j.request));
    if (request.kind === "analytics_import") {
      const input = AnalyticsImport.parse(request.import),
        pid = ctx.db.normalizeId("videoPublications", input.publicationId),
        pub = pid ? await ctx.db.get(pid) : null;
      if (!pub || pub.workspaceId !== j.workspaceId)
        return fail("NOT_FOUND_OR_FORBIDDEN", "Publication unavailable");
      const revision = await ctx.db
        .query("videoPublicationRevisions")
        .withIndex("by_publicationId_and_revisionId", (q) =>
          q.eq("publicationId", pub._id).eq("revisionId", input.publicationRevision),
        )
        .unique();
      if (!revision) return fail("NOT_FOUND_OR_FORBIDDEN", "Publication revision unavailable");
      const p = JSON.parse(revision.content);
      await asset(ctx, j.workspaceId, input.source.asset, input.source.sha256);
      let imported = 0,
        duplicates = 0;
      for (const row of input.observations) {
        if (p.publishedAt && Date.parse(row.windowStart) < Date.parse(p.publishedAt))
          fail("METRIC_WINDOW", "Observation starts before publication");
        const identity = {
          publicationId: pub._id,
          source: input.source,
          sourceReference: row.sourceReference,
          metric: row.metric,
          unit: row.unit,
          definition: row.definition,
          aggregation: row.aggregation,
          windowStart: new Date(row.windowStart).toISOString(),
          windowEnd: new Date(row.windowEnd).toISOString(),
        };
        const identityHash = await digest(identity),
          old = await ctx.db
            .query("videoMetrics")
            .withIndex("by_workspaceId_and_identityHash", (q) =>
              q.eq("workspaceId", j.workspaceId).eq("identityHash", identityHash),
            )
            .unique();
        if (old) {
          if (JSON.parse(old.content).value !== row.value)
            fail(
              "METRIC_CONFLICT",
              "Same source/window conflicts; corrected source reference required",
            );
          if (old.publicationRevision !== input.publicationRevision)
            fail(
              "METRIC_REVISION_CONFLICT",
              "Observation cannot silently relink publication revision",
            );
          duplicates++;
          continue;
        }
        const age = p.publishedAt
          ? {
              startMs: Date.parse(row.windowStart) - Date.parse(p.publishedAt),
              endMs: Date.parse(row.windowEnd) - Date.parse(p.publishedAt),
            }
          : null;
        const groupKey = canonical({
          platform: p.platform,
          sourceKind: input.source.kind,
          language: pub.language,
          metric: row.metric,
          unit: row.unit,
          definition: row.definition,
          aggregation: row.aggregation,
          publicationAge: age,
          ...(!age
            ? {
                incomparablePublication: pub._id,
                start: identity.windowStart,
                end: identity.windowEnd,
              }
            : {}),
          topic: p.topic,
          format: p.format,
          audience: p.audience,
          distribution: p.distribution,
        });
        await ctx.db.insert("videoMetrics", {
          workspaceId: j.workspaceId,
          projectId: pub.projectId,
          publicationId: pub._id,
          publicationRevision: input.publicationRevision,
          language: pub.language,
          identityHash,
          content: canonical({ ...row, source: input.source }),
          groupKey,
        });
        imported++;
      }
      const result = { kind: "analytics_import", publicationId: pub._id, imported, duplicates };
      await complete(ctx, j, result);
      return result;
    }
    if (request.kind === "offline_eval") {
      const input = OfflineEvaluation.parse(request.evaluation);
      let report: unknown;
      if (input.runner === "workflow-contract-v1") {
        if (!args.fixtureReport)
          return fail("VALIDATION_ERROR", "Internal fixture report required");
        report = args.fixtureReport;
      } else {
        if ((await digest(input.dataset)) !== input.datasetHash)
          fail("DATASET_HASH_MISMATCH", "Dataset manifest hash differs from pinned hash");
        if (input.caseIds?.some((id) => !input.dataset.cases.some((c) => c.id === id)))
          fail("NOT_FOUND_OR_FORBIDDEN", "Unknown selected case");
        const cases = [];
        for (const c of input.dataset.cases.filter(
          (c) => !input.caseIds || input.caseIds.includes(c.id),
        )) {
          const baseline = await observations(ctx, j.workspaceId, c.baselineEvidenceIds),
            candidate = await observations(ctx, j.workspaceId, c.candidateEvidenceIds),
            all = [...baseline, ...candidate];
          if (all.some((e) => e.rubricHash !== input.rubricHash))
            fail("RUBRIC_MISMATCH", "Case evidence differs from pinned rubric");
          const outcome = (rows: typeof all) =>
            rows.some((e) => e.outcome === "fail")
              ? "fail"
              : rows.some((e) => e.outcome === "uncertain" || e.uncertainty.length)
                ? "inconclusive"
                : "pass";
          const before = outcome(baseline),
            after = outcome(candidate);
          cases.push({
            caseId: c.id,
            familyId: c.familyId,
            split: c.split,
            attemptCount: c.attemptCount,
            baselineOutcome: before,
            outcome: after,
            regression: before === "pass" && after !== "pass",
            evidenceIds: c.candidateEvidenceIds,
            projectIds: [...new Set(candidate.map((e) => e.projectId))],
            artifactHashes: [...new Set(candidate.map((e) => e.artifactSha256))],
            reportHashes: [...new Set(candidate.map((e) => e.reportSha256))],
          });
        }
        // Never accept a claimed family split that places the same actual project/media on both sides.
        for (const a of cases)
          for (const b of cases)
            if (
              a.split !== b.split &&
              (a.projectIds.some((id) => b.projectIds.includes(id)) ||
                a.artifactHashes.some((h) => b.artifactHashes.includes(h)))
            )
              fail(
                "DATASET_LEAKAGE",
                "Underlying project/media crosses development/heldout boundary",
              );
        report = {
          kind: "offline_eval",
          runner: input.runner,
          datasetHash: input.datasetHash,
          rubricHash: input.rubricHash,
          baselineWorkflowHash: input.baselineWorkflowHash,
          candidateWorkflowHash: input.candidateWorkflowHash,
          cases,
          regressions: cases.filter((c) => c.regression).map((c) => c.caseId),
          provenance: "stored-evidence-audit",
          limitations: [
            "Did not execute a native Codex/Claude harness or the declared workflow variants",
            "Family labels and attempt counts are attributed dataset claims, not independently verified",
            "Passing evidence audit is not causal creative improvement",
          ],
        };
      }
      const serialized = canonical(report),
        reportHash = await digest(report),
        evalId = await ctx.db.insert("videoEvaluations", {
          workspaceId: j.workspaceId,
          jobId: j._id,
          request: canonical(input),
          report: serialized,
          reportHash,
        });
      const result = { kind: "offline_eval", evalId, reportHash, report };
      await complete(ctx, j, result);
      return result;
    }
    if (request.kind === "memory_validation") {
      const id = ctx.db.normalizeId("videoMemories", request.memoryId);
      if (!id) return fail("NOT_FOUND_OR_FORBIDDEN", "Memory unavailable");
      const m = await memory(ctx, id);
      if (m.workspaceId !== j.workspaceId)
        fail("NOT_FOUND_OR_FORBIDDEN", "Memory workspace mismatch");
      if (m.revisionId !== request.expectedRevision)
        fail("REVISION_CONFLICT", "Read memory before validating");
      if (m.status !== "proposed") fail("MEMORY_STATE", "Only proposed memory can be validated");
      if (request.policyHash !== (await digest(MEMORY_POLICY)))
        fail("POLICY_MISMATCH", "Use the pinned independent-video-v1 policy hash");
      const content = MemoryProposal.parse(JSON.parse(m.content)),
        ev = await observations(ctx, j.workspaceId, request.evidenceIds);
      if (
        ev.some(
          (e) =>
            e.language !== m.language ||
            (content.scope.kind === "project" && e.projectId !== m.projectId),
        )
      )
        fail("SCOPE_MISMATCH", "Evidence outside memory applicability");
      const splits = new Set<string>();
      const splitEvidence: { split: string; ids: string[] }[] = [];
      for (const raw of request.evalIds) {
        const eid = ctx.db.normalizeId("videoEvaluations", raw),
          e = eid ? await ctx.db.get(eid) : null;
        if (!e || e.workspaceId !== j.workspaceId)
          return fail("NOT_FOUND_OR_FORBIDDEN", "Evaluation unavailable");
        const r = JSON.parse(e.report);
        if (r.runner !== "evidence-consistency-v1") continue;
        for (const c of r.cases)
          if (
            c.outcome === "pass" &&
            !c.regression &&
            c.evidenceIds.every((id: string) => request.evidenceIds.includes(id))
          ) {
            splits.add(c.split);
            splitEvidence.push({ split: c.split, ids: c.evidenceIds });
          }
      }
      const reasons: string[] = [];
      if (content.supportingEvidenceIds.some((id) => !request.evidenceIds.includes(id)))
        reasons.push(
          "Validation must include original supporting evidence, not selectively discard it",
        );
      const assignments = new Map<string, Set<string>>();
      for (const row of splitEvidence)
        for (const id of row.ids) {
          const e = ev.find((e) => e.evidenceId === id);
          if (!e) continue;
          for (const key of [`project:${e.projectId}`, `artifact:${e.artifactSha256}`]) {
            const set = assignments.get(key) ?? new Set<string>();
            set.add(row.split);
            assignments.set(key, set);
          }
        }
      if ([...assignments.values()].some((s) => s.size > 1))
        reasons.push("Cross-evaluation development/heldout leakage");
      if (ev.some((e) => !splitEvidence.some((s) => s.ids.includes(e.evidenceId))))
        reasons.push("Every selected evidence must occur in a passing pinned evaluation case");
      if (new Set(ev.map((e) => e.projectId)).size < 2)
        reasons.push("Need distinct underlying projects, not versions of one reel");
      if (
        new Set(ev.map((e) => e.artifactSha256)).size < 2 ||
        new Set(ev.map((e) => e.reportSha256)).size < 2
      )
        reasons.push("Need distinct artifact and report bytes");
      if (new Set(ev.map((e) => e.rubricHash)).size !== 1)
        reasons.push("One pinned rubric required");
      if (!splits.has("development") || !splits.has("heldout"))
        reasons.push("Need passing development and heldout evidence from pinned eval datasets");
      if (content.contradictingEvidenceIds.length)
        reasons.push("Unresolved contradictory evidence");
      if (ev.some((e) => e.outcome !== "pass" || e.uncertainty.length))
        reasons.push("Failing or uncertain evidence");
      const outcome = ev.some((e) => e.outcome === "fail")
          ? "rejected"
          : reasons.length
            ? "inconclusive"
            : "supported",
        status = outcome === "inconclusive" ? "proposed" : outcome;
      const validation = {
          outcome,
          reasons,
          evidenceIds: request.evidenceIds,
          evalIds: request.evalIds,
          policyHash: request.policyHash,
          interpretation:
            "Minimum evidence support within declared applicability, not verified universal truth",
        },
        revisionId = await digest({ parent: m.revisionId, validation });
      await ctx.db.patch(m._id, { revisionId, status, validation: canonical(validation) });
      await ctx.db.insert("videoMemoryRevisions", {
        memoryId: m._id,
        revisionId,
        content: m.content,
        status,
        validation: canonical(validation),
      });
      const result = {
        kind: "memory_validation",
        memoryId: m._id,
        revisionId,
        status,
        ...validation,
      };
      await complete(ctx, j, result);
      return result;
    }
    return fail("CAPABILITY_NOT_AVAILABLE", "Job is not a supported learning operation");
  },
});

export const run = internalAction({
  args: { jobId: v.id("videoJobs"), admissionAttempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let job: Doc<"videoJobs"> & { request: unknown };
    try {
      job = await ctx.runMutation(makeFunctionReference<"mutation">("videoJobs:claim"), {
        jobId: args.jobId,
      });
      if (!job) return;
    } catch (error) {
      const data = error instanceof ConvexError ? error.data : null;
      if (
        data &&
        typeof data === "object" &&
        "code" in data &&
        data.code === "CAPACITY_EXCEEDED" &&
        (args.admissionAttempt ?? 0) < 30
      ) {
        await ctx.scheduler.runAfter(5000, makeFunctionReference<"action">("videoLearning:run"), {
          jobId: args.jobId,
          admissionAttempt: (args.admissionAttempt ?? 0) + 1,
        });
        return;
      }
      await ctx.runMutation(makeFunctionReference<"mutation">("videoJobs:failAdmission"), {
        jobId: args.jobId,
        code: "LEARNING_ADMISSION_FAILED",
      });
      return;
    }
    try {
      const request = JobRequest.parse(job.request);
      let fixtureReport: unknown;
      if (request.kind === "offline_eval" && request.evaluation.runner === "workflow-contract-v1") {
        const input = request.evaluation,
          cases = [];
        for (const caseId of input.caseIds ?? FIXTURE_CASES)
          for (let repetition = 0; repetition < input.repetitions; repetition++) {
            const nonce = crypto.randomUUID();
            let report: unknown = {
              caseId,
              repetition,
              outcome: "fail",
              observed: "unexpected_success",
              coverage: "actual-domain-state-transitions-only",
            };
            try {
              await ctx.runMutation(
                makeFunctionReference<"mutation">("videoLearningFixtures:exercise"),
                { principalId: job.principalId, caseId, nonce },
              );
            } catch (error) {
              const data = error instanceof ConvexError ? error.data : null;
              if (
                data &&
                typeof data === "object" &&
                "code" in data &&
                data.code === "INTERNAL_FIXTURE_ROLLBACK" &&
                "nonce" in data &&
                data.nonce === nonce &&
                "caseId" in data &&
                data.caseId === caseId &&
                "report" in data
              )
                report = { ...(data.report as object), repetition };
              else
                report = {
                  caseId,
                  repetition,
                  outcome: "fail",
                  observed: "unexpected_contract_error",
                  coverage: "actual-domain-state-transitions-only",
                };
            }
            cases.push(report);
          }
        fixtureReport = {
          kind: "offline_eval",
          runner: input.runner,
          configHash: await digest(FIXTURE_CONFIG),
          config: FIXTURE_CONFIG,
          cases,
          provenance: "actual-convex-handler-execution-rolled-back",
          codeRevision: null,
          limitations: [
            "Exercises currently deployed handlers; code revision must be attached by deployment provenance, not guessed",
            "Structural fixture registry entries are not decoded media or native model perception",
            "No creative superiority or view-count claim",
          ],
        };
      }
      await ctx.runMutation(makeFunctionReference<"mutation">("videoLearning:applyJob"), {
        jobId: job._id,
        fence: job.fence,
        ...(fixtureReport ? { fixtureReport } : {}),
      });
    } catch (error) {
      const data = error instanceof ConvexError ? error.data : null;
      const code =
        data && typeof data === "object" && "code" in data ? String(data.code) : "LEARNING_FAILED";
      await ctx.runMutation(makeFunctionReference<"mutation">("videoJobs:fail"), {
        jobId: job._id,
        fence: job.fence,
        code,
        outcomeUnknown: false,
      });
    }
  },
});
