/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { canonical } from "../packages/video/src/contracts";
import { sha256Hex } from "./lib/hash";
import schema from "./schema";
import { MEMORY_POLICY } from "./videoLearning";

const modules = import.meta.glob("./**/*.ts"),
  ref = (name: string) => makeFunctionReference<"mutation">(`videoLearning:${name}`);

test("independent development and heldout receipts can promote profile memory through real validation", async () => {
  const f = await fixture();
  const second = await f.as.mutation(makeFunctionReference<"mutation">("video:createProject"), {
    workspaceId: f.workspaceId,
    idempotencyKey: "second",
    title: "Heldout",
    brief: { topic: "Independent fixture", direction: "Independent fixture" },
    languages: ["ru"],
    format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
  });
  const draft = second.drafts[0];
  const checkpoint = await f.as.mutation(makeFunctionReference<"mutation">("video:checkpoint"), {
    draftId: draft.draftId,
    idempotencyKey: "second-cp",
    expectedProjectRevision: second.revisionId,
    expectedScriptRevision: draft.scriptRevision,
    expectedTimelineRevision: draft.timelineRevision,
    label: "Heldout",
  });
  const evidenceIds = [];
  for (const [index, pair] of [
    { projectId: f.p.projectId, versionId: f.cp.version.versionId },
    { projectId: second.projectId, versionId: checkpoint.version.versionId },
  ].entries()) {
    const hashes = [(index ? "d" : "c").repeat(64), (index ? "f" : "e").repeat(64)];
    const receipts = await f.t.run(async (ctx) => {
      const refs = [];
      for (const [n, hash] of hashes.entries()) {
        const assetId = await ctx.db.insert("assets", {
          scope: "workspace",
          workspaceId: f.workspaceId,
          slug: `evidence-${index}-${n}`,
          name: "Synthetic contract fixture",
          tags: [],
          kind: "image",
          searchText: "fixture",
          createdBy: f.userId,
          updatedAt: 0,
        });
        const revisionId = await ctx.db.insert("assetVersions", {
          assetId,
          revision: 1,
          objectKey: `fixture-${index}-${n}`,
          contentHash: hash,
          mimeType: "video/mp4",
          size: 1,
          originalFilename: "fixture.mp4",
          sourceType: "upload",
          createdBy: f.userId,
        });
        refs.push({ assetId, revisionId });
      }
      const jobId = await ctx.db.insert("videoJobs", {
        workspaceId: f.workspaceId,
        principalId: f.userId,
        ...pair,
        kind: "render",
        idempotencyKey: `registered-${index}`,
        inputHash: "fixture",
        request: "{}",
        state: "succeeded",
        stage: "done",
        fence: 1,
        createdAt: 0,
        updatedAt: 0,
      });
      return { refs, jobId };
    });
    const registered = await f.t.mutation(
      makeFunctionReference<"mutation">("videoWorkflow:recordEvidence"),
      {
        evidence: {
          jobId: receipts.jobId,
          versionId: pair.versionId,
          artifact: receipts.refs[0],
          artifactSha256: hashes[0],
          report: receipts.refs[1],
          reportSha256: hashes[1],
          rubricHash: "a".repeat(64),
          method: "measurement",
          outcome: "pass",
          observation: "Synthetic contract fixture, no perceptual quality claim",
          uncertainty: [],
          coverage: { startMs: 0, endMs: 1000, samplingFps: null, limitations: [] },
        },
      },
    );
    evidenceIds.push(registered.evidenceId);
  }
  const profile = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getProfile"), {
    projectId: f.p.projectId,
  });
  const proposed = await f.as.mutation(ref("proposeMemory"), {
    workspaceId: f.workspaceId,
    idempotencyKey: "supported",
    proposal: {
      scope: { kind: "profile", profileId: profile.profileId },
      language: "ru",
      statement: "Scoped fixture lesson",
      applicability: "Synthetic contract tests only",
      supportingEvidenceIds: evidenceIds,
    },
  });
  const dataset = {
    schemaVersion: 1,
    cases: evidenceIds.map((id, i) => ({
      id: `case-${i}`,
      familyId: `family-${i}`,
      split: i ? "heldout" : "development",
      attemptCount: 1,
      baselineEvidenceIds: [id],
      candidateEvidenceIds: [id],
    })),
  };
  const evalJob = await f.job(
    {
      kind: "offline_eval",
      evaluation: {
        runner: "evidence-consistency-v1",
        dataset,
        datasetHash: await sha256Hex(canonical(dataset)),
        rubricHash: "a".repeat(64),
        baselineWorkflowHash: "b".repeat(64),
        candidateWorkflowHash: "b".repeat(64),
        execution: { mode: "offline" },
      },
    },
    "running",
  );
  const evaluation = await f.t.mutation(ref("applyJob"), { jobId: evalJob, fence: 1 });
  const validation = await f.job(
    {
      kind: "memory_validation",
      memoryId: proposed.memoryId,
      expectedRevision: proposed.revisionId,
      evidenceIds,
      evalIds: [evaluation.evalId],
      policyHash: await sha256Hex(canonical(MEMORY_POLICY)),
    },
    "running",
  );
  expect(await f.t.mutation(ref("applyJob"), { jobId: validation, fence: 1 })).toMatchObject({
    outcome: "supported",
    status: "supported",
  });
  const pack = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getContext"), {
    projectId: f.p.projectId,
    language: "ru",
    role: "writer",
    task: "retrieve supported lesson",
  });
  expect(JSON.stringify(pack.sections)).toContain("Scoped fixture lesson");
});
async function fixture() {
  const t = convexTest(schema, modules),
    ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "learning@iota.uz",
        name: "Learning",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Learning",
        slug: "learning",
        createdBy: userId,
      });
      return { userId, workspaceId };
    }),
    as = t.withIdentity({ subject: `${ids.userId}|session`, issuer: "convex" });
  let seq = 0;
  const p = await as.mutation(makeFunctionReference<"mutation">("video:createProject"), {
    workspaceId: ids.workspaceId,
    idempotencyKey: "p",
    title: "Learning",
    brief: { topic: "Fixture", direction: "Fixture" },
    languages: ["ru"],
    format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
  });
  const draft = p.drafts[0],
    cp = await as.mutation(makeFunctionReference<"mutation">("video:checkpoint"), {
      draftId: draft.draftId,
      idempotencyKey: "cp",
      expectedProjectRevision: p.revisionId,
      expectedScriptRevision: draft.scriptRevision,
      expectedTimelineRevision: draft.timelineRevision,
      label: "Fixture",
    });
  const source = await t.run(async (ctx) => {
    const assetId = await ctx.db.insert("assets", {
        scope: "workspace",
        workspaceId: ids.workspaceId,
        slug: "fixture",
        name: "Fixture",
        tags: [],
        kind: "image",
        searchText: "fixture",
        createdBy: ids.userId,
        updatedAt: 0,
      }),
      revisionId = await ctx.db.insert("assetVersions", {
        assetId,
        revision: 1,
        objectKey: "fixture",
        contentHash: "c".repeat(64),
        mimeType: "video/mp4",
        size: 1,
        originalFilename: "fixture.mp4",
        sourceType: "upload",
        createdBy: ids.userId,
      });
    return {
      kind: "manual" as const,
      reference: "Synthetic source receipt",
      asset: { assetId, revisionId },
      sha256: "c".repeat(64),
    };
  });
  async function job(
    request: unknown,
    state: "queued" | "running" | "succeeded" = "queued",
    result?: unknown,
  ) {
    return t.run((ctx) =>
      ctx.db.insert("videoJobs", {
        workspaceId: ids.workspaceId,
        principalId: ids.userId,
        projectId: p.projectId,
        versionId: cp.version.versionId,
        kind: (request as { kind: string }).kind,
        idempotencyKey: `fixture${++seq}`,
        inputHash: "fixture",
        request: canonical(request),
        state,
        stage: "fixture",
        fence: state === "queued" ? 0 : 1,
        createdAt: 0,
        updatedAt: 0,
        ...(result ? { result: canonical(result) } : {}),
      }),
    );
  }
  return { t, as, ...ids, p, cp, source, job };
}
test("durable offline fixture action executes real guards, saves provenance, no fixture project survives", async () => {
  const f = await fixture(),
    jobId = await f.job({
      kind: "offline_eval",
      evaluation: {
        runner: "workflow-contract-v1",
        dataset: "workflow-contract-v1",
        repetitions: 1,
        execution: { mode: "offline" },
      },
    });
  await f.t.action(makeFunctionReference<"action">("videoLearning:run"), { jobId });
  const result = await f.t.run((ctx) => ctx.db.get(jobId));
  expect(result?.state).toBe("succeeded");
  const body = JSON.parse(result!.result!);
  expect(body.report.cases).toHaveLength(5);
  expect(body.report.cases.every((c: { outcome: string }) => c.outcome === "pass")).toBe(true);
  expect(body.report.provenance).toBe("actual-convex-handler-execution-rolled-back");
  expect(await f.t.run((ctx) => ctx.db.query("videoProjects").take(10))).toHaveLength(1);
  expect(await f.t.run((ctx) => ctx.db.query("workspaces").take(10))).toHaveLength(1);
});
test("publication revisions preserve exact render/source, unknown date and idempotency", async () => {
  const f = await fixture(),
    renderJobId = await f.job({ kind: "render" }, "succeeded", {
      kind: "render",
      video: f.source.asset,
      sha256: f.source.sha256,
      partial: false,
    });
  const args = {
    workspaceId: f.workspaceId,
    idempotencyKey: "pub",
    record: {
      renderJobId,
      platform: "youtube",
      externalPostId: "post",
      url: "https://example.com/post",
      publishedAt: null,
      source: f.source,
    },
  };
  const p = await f.as.mutation(ref("recordPublication"), args);
  expect(await f.as.mutation(ref("recordPublication"), args)).toEqual(p);
  const updated = await f.as.mutation(ref("recordPublication"), {
    ...args,
    idempotencyKey: "correction",
    record: {
      ...args.record,
      expectedRevision: p.revisionId,
      reason: "Timestamp receipt",
      publishedAt: "2026-09-01T00:00:00Z",
    },
  });
  expect(updated.revisionId).not.toBe(p.revisionId);
  const old = await f.as.query(makeFunctionReference<"query">("videoLearning:getPublication"), {
    publicationId: p.publicationId,
    revisionId: p.revisionId,
  });
  expect(old.record.publishedAt).toBeNull();
  expect(old.record.verification).toBe("recorded");
});
test("analytics preserves null vs zero, dedupes timestamp spelling and atomically rejects conflict", async () => {
  const f = await fixture(),
    renderJobId = await f.job({ kind: "render" }, "succeeded", {
      kind: "render",
      video: f.source.asset,
      sha256: f.source.sha256,
      partial: false,
    });
  const p = await f.as.mutation(ref("recordPublication"), {
    workspaceId: f.workspaceId,
    idempotencyKey: "pub",
    record: {
      renderJobId,
      platform: "youtube",
      externalPostId: "post",
      url: "https://example.com/post",
      publishedAt: null,
      source: f.source,
    },
  });
  const row = {
    metric: "views",
    value: null,
    unit: "count",
    definition: "Platform views",
    aggregation: "window",
    windowStart: "2026-09-01T00:00:00Z",
    windowEnd: "2026-09-02T00:00:00Z",
    observedAt: "2026-09-02T00:00:00Z",
    sourceReference: "row1",
  };
  const request = (observations: unknown[]) => ({
    kind: "analytics_import",
    import: {
      publicationId: p.publicationId,
      publicationRevision: p.revisionId,
      source: f.source,
      observations,
    },
  });
  const first = await f.job(
    request([row, { ...row, value: 0, sourceReference: "row2" }]),
    "running",
  );
  expect(await f.t.mutation(ref("applyJob"), { jobId: first, fence: 1 })).toMatchObject({
    imported: 2,
    duplicates: 0,
  });
  const second = await f.job(
    request([
      { ...row, windowStart: "2026-09-01T00:00:00.000Z", windowEnd: "2026-09-02T00:00:00.000Z" },
    ]),
    "running",
  );
  expect(await f.t.mutation(ref("applyJob"), { jobId: second, fence: 1 })).toMatchObject({
    imported: 0,
    duplicates: 1,
  });
  const bad = await f.job(
    request([
      { ...row, sourceReference: "new" },
      { ...row, value: 123 },
    ]),
    "running",
  );
  await expect(f.t.mutation(ref("applyJob"), { jobId: bad, fence: 1 })).rejects.toThrow(
    "METRIC_CONFLICT",
  );
  expect(await f.t.run((ctx) => ctx.db.query("videoMetrics").take(10))).toHaveLength(2);
});
test("single-run memory cannot self-certify and proposed lessons never enter active context", async () => {
  const f = await fixture(),
    jobId = await f.job({ kind: "render" }, "succeeded"),
    evidenceId = await f.t.run((ctx) =>
      ctx.db.insert("videoWorkflowEvidence", {
        projectId: f.p.projectId,
        versionId: f.cp.version.versionId,
        jobId,
        contentHash: "fixture",
        content: canonical({
          jobId,
          versionId: f.cp.version.versionId,
          artifact: f.source.asset,
          artifactSha256: f.source.sha256,
          report: f.source.asset,
          reportSha256: f.source.sha256,
          rubricHash: "a".repeat(64),
          method: "measurement",
          outcome: "pass",
          observation: "Synthetic",
          uncertainty: [],
          coverage: { startMs: 0, endMs: 1000, samplingFps: null, limitations: [] },
        }),
      }),
    );
  const m = await f.as.mutation(ref("proposeMemory"), {
    workspaceId: f.workspaceId,
    idempotencyKey: "memory",
    proposal: {
      scope: { kind: "project", projectId: f.p.projectId },
      language: "ru",
      statement: "Longer hook may help",
      applicability: "This fixture",
      supportingEvidenceIds: [evidenceId],
    },
  });
  const validate = await f.job(
    {
      kind: "memory_validation",
      memoryId: m.memoryId,
      expectedRevision: m.revisionId,
      evidenceIds: [evidenceId],
      evalIds: [],
      policyHash: await sha256Hex(canonical(MEMORY_POLICY)),
    },
    "running",
  );
  const result = await f.t.mutation(ref("applyJob"), { jobId: validate, fence: 1 });
  expect(result).toMatchObject({ outcome: "inconclusive", status: "proposed" });
  const pack = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getContext"), {
    projectId: f.p.projectId,
    language: "ru",
    role: "writer",
    task: "write",
  });
  expect(pack.sections.find((s: { name: string }) => s.name === "memory").content.lessons).toEqual(
    [],
  );
});
