/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { canonical } from "../packages/video/src/contracts";
import { resolvedCritiquePolicy } from "../packages/video/src/jobs";
import { sha256Hex, sha256HexBytes } from "./lib/hash";
import { critique } from "./lib/videoProviderAdapters";
import { assertVideoProductionAllowed, noteHumanWorkflowInput } from "./lib/videoWorkflow";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ref = (name: string) => makeFunctionReference<"mutation">(`videoWorkflow:${name}`);
const core = (name: string) => makeFunctionReference<"mutation">(`video:${name}`);
const rubricHash = "a".repeat(64),
  workflowHash = "b".repeat(64);
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "workflow@iota.uz",
      name: "Workflow",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Workflow",
      slug: "workflow",
      createdBy: userId,
    });
    return { userId, workspaceId };
  });
  const as = t.withIdentity({ subject: `${ids.userId}|session`, issuer: "convex" });
  const p = await as.mutation(core("createProject"), {
    workspaceId: ids.workspaceId,
    idempotencyKey: "project",
    title: "Farq",
    brief: { topic: "Exact user-reported topic", direction: "Exact direction" },
    languages: ["ru", "uz"],
    format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
  });
  const ru = p.drafts.find((d: { language: string }) => d.language === "ru");
  const scene = {
    purpose: "Author intent withheld",
    narration: "Author script withheld",
    onScreenText: ["Text"],
    visual: {
      description: "Author rationale withheld",
      shot: "close",
      motion: "none",
      keyframeOrder: [],
      keyframesById: {},
    },
    shotOrder: ["shot"],
    shotsById: {
      shot: {
        durationMs: 1000,
        editHandlesMs: { before: 100, after: 200 },
        purpose: "show object",
        method: "remotion",
        subjectAction: "static",
        cameraMotion: "push",
        constraints: [],
      },
    },
    claims: [],
  };
  await as.mutation(core("patchScript"), {
    draftId: ru.draftId,
    expectedRevision: ru.scriptRevision,
    idempotencyKey: "script",
    operations: [
      { op: "add", path: "/scenesById/hook", value: scene },
      { op: "replace", path: "/sceneOrder", value: ["hook"] },
    ],
  });
  let key = 0;
  async function checkpoint() {
    const d = await as.query(makeFunctionReference<"query">("video:getDraft"), {
      draftId: ru.draftId,
    });
    return as.mutation(core("checkpoint"), {
      draftId: ru.draftId,
      expectedProjectRevision: p.revisionId,
      expectedScriptRevision: d.scriptRevision,
      expectedTimelineRevision: d.timelineRevision,
      idempotencyKey: `checkpoint${++key}`,
      label: `candidate${key}`,
    });
  }
  async function media(hash: string) {
    return t.run(async (ctx) => {
      const assetId = await ctx.db.insert("assets", {
        scope: "workspace",
        workspaceId: ids.workspaceId,
        slug: `asset${++key}`,
        name: "Fixture",
        tags: [],
        kind: "image",
        searchText: "Fixture",
        createdBy: ids.userId,
        updatedAt: 0,
      });
      const revisionId = await ctx.db.insert("assetVersions", {
        assetId,
        revision: 1,
        objectKey: `fixture${key}`,
        contentHash: hash,
        mimeType: "video/mp4",
        size: 12,
        originalFilename: "fixture.mp4",
        sourceType: "upload",
        createdBy: ids.userId,
      });
      return { assetId, revisionId };
    });
  }
  async function evidence(
    versionId: string,
    method: "measurement" | "provider_video",
    outcome: "pass" | "fail" | "uncertain" = "pass",
    uncertainty: string[] = [],
    artifactSha256 = "c".repeat(64),
    evidenceRubricHash = rubricHash,
  ) {
    const reportSha256 = "d".repeat(64),
      artifact = await media(artifactSha256),
      report = await media(reportSha256);
    const jobId = await t.run((ctx) =>
      ctx.db.insert("videoJobs", {
        workspaceId: ids.workspaceId,
        principalId: ids.userId,
        projectId: p.projectId,
        versionId: ctx.db.normalizeId("videoVersions", versionId)!,
        kind: method === "measurement" ? "render" : "critique",
        idempotencyKey: `fixture${++key}`,
        operationId: `fixture-operation-${key}`,
        attemptNumber: 1,
        inputHash: "fixture",
        request: "{}",
        state: "succeeded",
        stage: "done",
        fence: 1,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    return t.mutation(ref("recordEvidence"), {
      evidence: {
        jobId,
        versionId,
        artifact,
        artifactSha256,
        report,
        reportSha256,
        rubricHash: evidenceRubricHash,
        method,
        outcome,
        observation: "Synthetic deterministic fixture, not provider evidence",
        uncertainty,
        coverage: {
          startMs: 0,
          endMs: 1000,
          samplingFps: method === "measurement" ? null : 1,
          limitations: [],
        },
      },
    });
  }
  return { t, as, ...ids, p, ru, checkpoint, media, evidence };
}
async function proposal(
  f: Awaited<ReturnType<typeof fixture>>,
  limit = 2,
  noProgressLimit = 1,
  policyHash = rubricHash,
) {
  const base = await f.checkpoint();
  const ev = await f.evidence(
    base.version.versionId,
    "measurement",
    "fail",
    [],
    undefined,
    policyHash,
  );
  const l = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getLoop"), {
    projectId: f.p.projectId,
    language: "ru",
  });
  const args = {
    projectId: f.p.projectId,
    language: "ru",
    expectedLoopRevision: l.revisionId,
    idempotencyKey: "proposal",
    baseline: base.version.versionId,
    hypothesis: "Improve the exact hook",
    evidenceIds: [ev.evidenceId],
    changes: [
      {
        sceneIds: ["hook"],
        shotIds: ["shot"],
        description: "One specific change",
        expectedEffect: "More readable",
      },
    ],
    evaluation: {
      rubricHash: policyHash,
      workflowHash,
      successCriteria: ["Readable"],
      preserve: ["Truthfulness"],
    },
    iterationLimit: limit,
    noProgressLimit,
  };
  const result = await f.as.mutation(ref("propose"), args);
  return { base, ev, l, args, result };
}

test("human abandonment records actor/reason, clears invalidated pending without resetting bounds, and cannot be called by an unauthenticated agent", async () => {
  const f = await fixture(),
    p = await proposal(f, 2, 1);
  await f.t.run((ctx) => noteHumanWorkflowInput(ctx, f.p.projectId, "ru"));
  const current = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getLoop"), {
    loopId: p.l.loopId,
  });
  expect(current.pendingProposal).toMatchObject({
    invalidated: true,
    causes: ["human_input_changed"],
  });
  const args = {
    loopId: current.loopId,
    expectedLoopRevision: current.revisionId,
    idempotencyKey: "human-replan",
    reason: "The user changed the creative direction",
  };
  await expect(f.t.mutation(ref("abandonPending"), args)).rejects.toThrow();
  const abandoned = await f.as.mutation(ref("abandonPending"), args);
  expect(abandoned.state).toBe("paused");
  const row = await f.t.run((ctx) => ctx.db.get(p.result.proposalId));
  expect(row).toMatchObject({ state: "abandoned", abandonedBy: f.userId, rationale: args.reason });
  const after = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getLoop"), {
    loopId: current.loopId,
  });
  expect(after).toMatchObject({
    iteration: current.iteration,
    noProgress: current.noProgress,
    iterationLimit: current.iterationLimit,
    selectedCandidate: current.selectedCandidate,
    pendingProposalIds: [],
    pausedByHuman: true,
    pendingProposal: null,
  });
  expect(await f.as.mutation(ref("abandonPending"), args)).toEqual(abandoned);
  await expect(
    f.t.mutation(ref("agentResume"), {
      videoPrincipalId: f.userId,
      loopId: after.loopId,
      expectedLoopRevision: after.revisionId,
      idempotencyKey: "agent-resume",
    }),
  ).rejects.toThrow(/HUMAN_ACTION_REQUIRED/);
  await f.as.mutation(ref("resume"), {
    loopId: after.loopId,
    expectedLoopRevision: after.revisionId,
    idempotencyKey: "human-resume",
  });
});
test("initialization creates independent language loops and immutable pinned profile history", async () => {
  const f = await fixture(),
    initial = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getProfile"), {
      projectId: f.p.projectId,
    });
  const cp = await f.checkpoint();
  const changed = await f.as.mutation(ref("patchProfile"), {
    profileId: initial.profileId,
    expectedRevision: initial.revisionId,
    idempotencyKey: "profile",
    reason: "Explicit preference",
    operations: [{ op: "replace", path: "/name", value: "New name" }],
  });
  expect(changed.revisionId).not.toBe(initial.revisionId);
  expect(
    (
      await f.as.query(makeFunctionReference<"query">("videoWorkflow:getProfile"), {
        profileId: initial.profileId,
        revisionId: initial.revisionId,
      })
    ).document.name,
  ).toBe("farq.uz");
  const context = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getContext"), {
    projectId: f.p.projectId,
    language: "ru",
    versionId: cp.version.versionId,
    role: "writer",
    task: "write",
  });
  expect(context.sections.find((s: { name: string }) => s.name === "profile").content.name).toBe(
    "farq.uz",
  );
  expect(
    (
      await f.as.query(makeFunctionReference<"query">("videoWorkflow:getLoop"), {
        projectId: f.p.projectId,
        language: "uz",
      })
    ).iteration,
  ).toBe(0);
});
test("context bounds exact scene/shot; critic excludes author script and rationale", async () => {
  const f = await fixture();
  const asset = await f.media("c".repeat(64));
  const draft = await f.as.query(makeFunctionReference<"query">("video:getDraft"), {
    draftId: f.ru.draftId,
  });
  await f.as.mutation(core("patchTimeline"), {
    draftId: f.ru.draftId,
    expectedRevision: draft.timelineRevision,
    idempotencyKey: "context-clip",
    operations: [
      { op: "replace", path: "/durationFrames", value: 30 },
      {
        op: "add",
        path: "/tracksById/main",
        value: {
          kind: "visual",
          clipOrder: ["clip"],
          clipsById: {
            clip: {
              sceneId: "hook",
              shotId: "shot",
              startFrame: 0,
              durationFrames: 30,
              source: { kind: "asset", asset, sourceStartMs: 100, sourceEndMs: 1100 },
              layout: { x: 0, y: 0, width: 1, height: 1, fit: "cover" },
            },
          },
        },
      },
      { op: "replace", path: "/trackOrder", value: ["main"] },
    ],
  });
  await f.checkpoint();
  const args = {
    projectId: f.p.projectId,
    language: "ru",
    role: "critic",
    task: "independent media inspection",
    sceneIds: ["hook"],
    shotIds: ["shot"],
    maxBytes: 2048,
  };
  const result = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getContext"), args);
  expect(JSON.stringify(result)).not.toContain("Author intent");
  expect(JSON.stringify(result)).not.toContain("Author script");
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(2048);
  const writer = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getContext"), {
    ...args,
    role: "writer",
    maxBytes: 32768,
  });
  const projection = writer.sections.find((s: { name: string }) => s.name === "script").content
    .scenes[0];
  expect(projection.shotOrder).toEqual(["shot"]);
  expect(projection.shotContexts[0]).toMatchObject({
    plannedDurationMs: 1000,
    editHandlesMs: { before: 100, after: 200 },
    clips: [
      {
        durationMs: 1000,
        source: { sourceStartMs: 100, sourceEndMs: 1100 },
        layout: { fit: "cover" },
      },
    ],
  });
  expect(
    writer.sections.find((s: { name: string }) => s.name === "assets").content.registeredSources,
  ).toMatchObject([{ asset, sha256: "c".repeat(64) }]);
  await expect(
    f.as.query(makeFunctionReference<"query">("videoWorkflow:getContext"), {
      ...args,
      shotIds: ["missing"],
    }),
  ).rejects.toThrow("SCOPE_MISMATCH");
});
test("profile guards unknown, unregistered source, CAS and retries", async () => {
  const f = await fixture(),
    p = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getProfile"), {
      projectId: f.p.projectId,
    });
  const args = {
    profileId: p.profileId,
    expectedRevision: p.revisionId,
    idempotencyKey: "patch",
    reason: "name",
    operations: [{ op: "replace", path: "/name", value: "Revised" }],
  };
  const result = await f.as.mutation(ref("patchProfile"), args);
  expect(await f.as.mutation(ref("patchProfile"), args)).toEqual(result);
  await expect(
    f.as.mutation(ref("patchProfile"), { ...args, idempotencyKey: "stale" }),
  ).rejects.toThrow("REVISION_CONFLICT");
  await expect(
    f.as.mutation(ref("patchProfile"), {
      ...args,
      expectedRevision: result.revisionId,
      idempotencyKey: "unknown",
      operations: [
        {
          op: "replace",
          path: "/entries",
          value: [
            {
              key: "price",
              kind: "fact",
              statement: "Invented",
              status: "unknown",
              source: null,
              assets: [],
            },
          ],
        },
      ],
    }),
  ).rejects.toThrow("VALIDATION_ERROR");
});
test("proposal dedup/CAS, one pending slot, exact evidence and bounded rejection", async () => {
  const f = await fixture(),
    p = await proposal(f);
  expect(await f.as.mutation(ref("propose"), p.args)).toEqual(p.result);
  await expect(
    f.as.mutation(ref("propose"), {
      ...p.args,
      idempotencyKey: "concurrent",
      expectedLoopRevision: p.result.loopRevision,
    }),
  ).rejects.toThrow("PROPOSAL_PENDING");
  const candidate = await f.checkpoint(),
    ev = await f.evidence(candidate.version.versionId, "measurement", "fail");
  const result = await f.as.mutation(ref("select"), {
    loopId: p.l.loopId,
    expectedLoopRevision: p.result.loopRevision,
    idempotencyKey: "revert",
    proposalId: p.result.proposalId,
    candidate: candidate.version.versionId,
    evidenceIds: [ev.evidenceId],
    decision: "revert",
    rationale: "Readability regression",
  });
  expect(result).toMatchObject({
    state: "awaiting_human",
    noProgress: 1,
    stopReason: "no_progress",
    selectedCandidate: p.base.version.versionId,
    humanApproval: false,
  });
  expect(await f.t.run((ctx) => ctx.db.query("videoApprovals").take(1))).toEqual([]);
});
test("selection requires passing technical + independent video evidence, no uncertainty", async () => {
  const f = await fixture(),
    p = await proposal(f, 3, 2),
    candidate = await f.checkpoint(),
    tech = await f.evidence(candidate.version.versionId, "measurement"),
    bad = await f.evidence(candidate.version.versionId, "provider_video", "uncertain", [
      "Sparse sampling",
    ]);
  const args = {
    loopId: p.l.loopId,
    expectedLoopRevision: p.result.loopRevision,
    idempotencyKey: "select",
    proposalId: p.result.proposalId,
    candidate: candidate.version.versionId,
    evidenceIds: [p.ev.evidenceId, tech.evidenceId, bad.evidenceId],
    decision: "select",
    rationale: "Compare real bytes",
  };
  await expect(f.as.mutation(ref("select"), args)).rejects.toThrow("COMPARISON_REQUIRED");
  const good = await f.evidence(candidate.version.versionId, "provider_video");
  const result = await f.as.mutation(ref("select"), {
    ...args,
    evidenceIds: [p.ev.evidenceId, tech.evidenceId, good.evidenceId],
  });
  expect(result).toMatchObject({
    selectedCandidate: candidate.version.versionId,
    humanApproval: false,
    requiresHumanReview: true,
  });
});
test("new human direction invalidates acceptance even with refreshed CAS", async () => {
  const f = await fixture(),
    p = await proposal(f),
    candidate = await f.checkpoint(),
    ev = await f.evidence(candidate.version.versionId, "measurement", "fail");
  await f.t.run((ctx) => noteHumanWorkflowInput(ctx, f.p.projectId, "ru"));
  const l = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getLoop"), {
    loopId: p.l.loopId,
  });
  await expect(
    f.as.mutation(ref("select"), {
      loopId: l.loopId,
      expectedLoopRevision: l.revisionId,
      idempotencyKey: "decision",
      proposalId: p.result.proposalId,
      candidate: candidate.version.versionId,
      evidenceIds: [ev.evidenceId],
      decision: "revert",
      rationale: "Old plan",
    }),
  ).rejects.toThrow("HUMAN_INPUT_CHANGED");
});
test("human pause cannot be downgraded by agent pause/resume; new production blocked", async () => {
  const f = await fixture(),
    l = await f.as.query(makeFunctionReference<"query">("videoWorkflow:getLoop"), {
      projectId: f.p.projectId,
      language: "ru",
    });
  const paused = await f.as.mutation(ref("pause"), {
    loopId: l.loopId,
    expectedLoopRevision: l.revisionId,
    idempotencyKey: "pause",
    reason: "Human pause",
    runningJobs: "leave_running",
  });
  const again = await f.t.mutation(ref("agentPause"), {
    videoPrincipalId: f.userId,
    loopId: l.loopId,
    expectedLoopRevision: paused.loopRevision,
    idempotencyKey: "agentpause",
    reason: "Agent",
    runningJobs: "leave_running",
  });
  await expect(
    f.t.mutation(ref("agentResume"), {
      videoPrincipalId: f.userId,
      loopId: l.loopId,
      expectedLoopRevision: again.loopRevision,
      idempotencyKey: "resume",
    }),
  ).rejects.toThrow("HUMAN_ACTION_REQUIRED");
  await expect(
    f.t.run((ctx) =>
      assertVideoProductionAllowed(ctx, { workspaceId: f.workspaceId, projectId: f.p.projectId }),
    ),
  ).rejects.toThrow("LOOP_PAUSED");
});
test("untrusted caller cannot register evidence through gateway", async () => {
  const f = await fixture();
  process.env.AGENT_GATEWAY_SECRET = "workflow-fixture";
  try {
    const tokenId = await f.t.run((ctx) =>
      ctx.db.insert("mcpTokens", {
        userId: f.userId,
        name: "fixture",
        prefix: "fixture",
        tokenHash: "e".repeat(64),
        expiresAt: Date.now() + 60000,
      }),
    );
    const response = await f.t.fetch("/agent-gateway", {
      method: "POST",
      headers: { authorization: "Bearer workflow-fixture", "content-type": "application/json" },
      body: JSON.stringify({
        operation: "video",
        args: { tokenId, name: "recordEvidence", input: { evidence: { outcome: "pass" } } },
      }),
    });
    expect(response.status).toBe(400);
  } finally {
    delete process.env.AGENT_GATEWAY_SECRET;
  }
});
test("mock provider adapter report becomes real receipt and permits selection without pretending human approval", async () => {
  const f = await fixture(),
    actualRubricHash = await sha256Hex(
      canonical(resolvedCritiquePolicy({ rubric: "Fixture criterion" })),
    ),
    p = await proposal(f, 3, 2, actualRubricHash),
    candidate = await f.checkpoint();
  const bytes = new TextEncoder().encode(
      "Structural transport fixture, not codec/perception evidence",
    ),
    artifactSha256 = await sha256HexBytes(bytes),
    artifact = await f.media(artifactSha256);
  const modelReport = {
    findings: [],
    limitations: ["Model judgment is not human approval"],
    audioEvaluated: false,
    assessments: [
      {
        criterionId: "rubric",
        outcome: "pass",
        observation: "Mock provider explicitly observed criterion",
      },
    ],
    blockingUncertainty: [],
    coverageComplete: true,
  };
  const transport = (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(modelReport) }] } }],
        modelVersion: "gemini-fixture",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  const output = await critique(
    {
      kind: "critique",
      allowPaid: true,
      asset: artifact,
      modelId: "gemini-fixture",
      rubric: "Fixture criterion",
      brief: "Fixture",
      samplingFps: 1,
    },
    { bytes, durationMs: 1000, hasAudio: false, sha256: artifactSha256 },
    "synthetic-test-key",
    ["gemini-fixture"],
    transport,
  );
  const payload = JSON.parse(new TextDecoder().decode(output.artifacts[0]!.bytes));
  expect(payload.outcome).toBe("pass");
  expect(output.metadata.blockingUncertainty).toEqual([]);
  expect(
    await sha256Hex(
      canonical(
        resolvedCritiquePolicy({
          rubric: "Fixture criterion",
          criteria: [{ id: "easier", description: "Different criterion" }],
        }),
      ),
    ),
  ).not.toBe(actualRubricHash);
  const reportSha256 = await sha256HexBytes(output.artifacts[0]!.bytes),
    report = await f.media(reportSha256);
  const jobId = await f.t.run((ctx) =>
    ctx.db.insert("videoJobs", {
      workspaceId: f.workspaceId,
      principalId: f.userId,
      projectId: f.p.projectId,
      versionId: candidate.version.versionId,
      kind: "critique",
      idempotencyKey: "adapter-report",
      operationId: "adapter-report-operation",
      attemptNumber: 1,
      inputHash: "fixture",
      request: "{}",
      state: "succeeded",
      stage: "done",
      fence: 1,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
  const receipt = await f.t.mutation(ref("recordEvidence"), {
    evidence: {
      jobId,
      versionId: candidate.version.versionId,
      artifact,
      artifactSha256,
      report,
      reportSha256,
      rubricHash: actualRubricHash,
      method: "provider_video",
      outcome: payload.outcome,
      observation: "Mock transport through actual production adapter",
      uncertainty: output.metadata.blockingUncertainty,
      coverage: { startMs: 0, endMs: 1000, samplingFps: 1, limitations: modelReport.limitations },
    },
  });
  const technical = await f.evidence(
    candidate.version.versionId,
    "measurement",
    "pass",
    [],
    artifactSha256,
    actualRubricHash,
  );
  const selected = await f.as.mutation(ref("select"), {
    loopId: p.l.loopId,
    expectedLoopRevision: p.result.loopRevision,
    idempotencyKey: "adapter-select",
    proposalId: p.result.proposalId,
    candidate: candidate.version.versionId,
    evidenceIds: [p.ev.evidenceId, technical.evidenceId, receipt.evidenceId],
    decision: "select",
    rationale: "Explicit passing criteria, no blocking uncertainty",
  });
  expect(selected.selectedCandidate).toBe(candidate.version.versionId);
  expect(selected.humanApproval).toBe(false);
  expect(await f.t.run((ctx) => ctx.db.query("videoApprovals").take(1))).toEqual([]);
});
test("adapter rejects empty assessments and blocks wrong criterion IDs or missing coverage", async () => {
  const input = {
    kind: "critique" as const,
    allowPaid: true as const,
    asset: { assetId: "fixture", revisionId: "revision" },
    modelId: "gemini-fixture",
    rubric: "Required readability",
    brief: "Fixture",
    samplingFps: 1,
  };
  const modelReport = {
    findings: [],
    limitations: [],
    audioEvaluated: false,
    assessments: [{ criterionId: "wrong", outcome: "pass", observation: "Wrong criterion" }],
    blockingUncertainty: [],
    coverageComplete: true,
  };
  const transport = (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(modelReport) }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  const run = () =>
    critique(
      input,
      { bytes: new Uint8Array([1]), durationMs: 1000, hasAudio: false, sha256: "c".repeat(64) },
      "synthetic-test-key",
      ["gemini-fixture"],
      transport,
    );
  expect((await run()).metadata.outcome).toBe("uncertain");
  modelReport.assessments = [{ criterionId: "rubric", outcome: "pass", observation: "Observed" }];
  modelReport.coverageComplete = false;
  expect((await run()).metadata.outcome).toBe("uncertain");
  modelReport.assessments = [];
  await expect(run()).rejects.toThrow("CRITIQUE_INVALID");
});
