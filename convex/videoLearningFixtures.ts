import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

export const FIXTURE_CASES = [
  "false-critic",
  "stale-base",
  "pending-proposal",
  "iteration-bound",
  "human-pause",
] as const;
export const FIXTURE_CONFIG = {
  version: "workflow-contract-v1",
  cases: FIXTURE_CASES,
  limits: { rounds: 1, noProgress: 1 },
  coverage: "actual-domain-state-transitions-only",
  expected: {
    "false-critic": "COMPARISON_REQUIRED",
    "stale-base": "STALE_BASE",
    "pending-proposal": "PROPOSAL_PENDING",
    "iteration-bound": "awaiting_human",
    "human-pause": "HUMAN_ACTION_REQUIRED",
  },
} as const;

/** All setup/domain writes roll back with the internal sentinel; caller persists only the report. */
export const exercise = internalMutation({
  args: { principalId: v.id("users"), caseId: v.string(), nonce: v.string() },
  handler: async (ctx, args): Promise<never> => {
    if (
      !(await ctx.db.get(args.principalId)) ||
      !FIXTURE_CASES.includes(args.caseId as (typeof FIXTURE_CASES)[number])
    )
      throw new ConvexError({ code: "FIXTURE_SETUP_INVALID" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Rolled-back offline fixture",
      slug: `fixture-${args.nonce}`,
      createdBy: args.principalId,
    });
    const call = (name: string, input: Record<string, unknown>) =>
      ctx.runMutation(makeFunctionReference<"mutation">(name), {
        ...input,
        videoPrincipalId: args.principalId,
      });
    const p: {
      projectId: Id<"videoProjects">;
      revisionId: string;
      drafts: { draftId: Id<"videoDrafts">; scriptRevision: string; timelineRevision: string }[];
    } = await call("video:agentCreateProject", {
      workspaceId,
      idempotencyKey: "fixture-create",
      title: "Contract fixture",
      brief: { topic: "Synthetic contract only", direction: "No creative/perception claim" },
      languages: ["ru"],
      format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
    });
    const draft = p.drafts[0];
    if (!draft) throw new ConvexError({ code: "FIXTURE_NO_DRAFT" });
    const scene = {
      purpose: "Fixture",
      narration: "Fixture",
      onScreenText: [],
      visual: {
        description: "Fixture",
        shot: "static",
        motion: "none",
        keyframeOrder: [],
        keyframesById: {},
      },
      shotOrder: [],
      shotsById: {},
      claims: [],
    };
    const patched: { revisionId: string } = await call("video:agentPatchScript", {
      draftId: draft.draftId,
      expectedRevision: draft.scriptRevision,
      idempotencyKey: "fixture-script",
      operations: [
        { op: "add", path: "/scenesById/hook", value: scene },
        { op: "replace", path: "/sceneOrder", value: ["hook"] },
      ],
    });
    let sequence = 0;
    async function checkpoint() {
      const cp: { version: { versionId: Id<"videoVersions"> } } = await call(
        "video:agentCheckpoint",
        {
          draftId: draft!.draftId,
          expectedProjectRevision: p.revisionId,
          expectedScriptRevision: patched.revisionId,
          expectedTimelineRevision: draft!.timelineRevision,
          idempotencyKey: `fixture-checkpoint${++sequence}`,
          label: "Structural fixture",
        },
      );
      return cp.version.versionId;
    }
    const base = await checkpoint(),
      rubricHash = "a".repeat(64),
      workflowHash = "b".repeat(64);
    async function evidence(versionId: Id<"videoVersions">, outcome: "fail" | "uncertain") {
      const assetId = await ctx.db.insert("assets", {
        scope: "workspace",
        workspaceId,
        slug: `fixture-${++sequence}`,
        name: "Structural fixture, no media bytes",
        tags: [],
        kind: "image",
        searchText: "fixture",
        createdBy: args.principalId,
        updatedAt: 0,
      });
      const revisionId = await ctx.db.insert("assetVersions", {
        assetId,
        revision: 1,
        objectKey: `not-an-upload/${args.nonce}/${sequence}`,
        contentHash: "c".repeat(64),
        mimeType: "video/mp4",
        size: 1,
        originalFilename: "structural-fixture",
        sourceType: "upload",
        createdBy: args.principalId,
      });
      const jobId = await ctx.db.insert("videoJobs", {
        workspaceId,
        principalId: args.principalId,
        projectId: p.projectId,
        versionId,
        kind: "render",
        state: "succeeded",
        fence: 1,
        idempotencyKey: `fixture-evidence${sequence}`,
        operationId: `fixture-evidence-operation-${sequence}`,
        attemptNumber: 1,
        inputHash: "fixture",
        request: "{}",
        stage: "fixture",
        createdAt: 0,
        updatedAt: 0,
      });
      const receipt: { evidenceId: Id<"videoWorkflowEvidence"> } = await ctx.runMutation(
        makeFunctionReference<"mutation">("videoWorkflow:recordEvidence"),
        {
          evidence: {
            jobId,
            versionId,
            artifact: { assetId, revisionId },
            artifactSha256: "c".repeat(64),
            report: { assetId, revisionId },
            reportSha256: "c".repeat(64),
            rubricHash,
            method: "measurement",
            outcome,
            observation: "Structural fixture, no media observation",
            uncertainty: outcome === "uncertain" ? ["Fixture deliberately uncertain"] : [],
            coverage: {
              startMs: 0,
              endMs: 1000,
              samplingFps: null,
              limitations: ["No real media bytes or decoder executed"],
            },
          },
        },
      );
      return receipt.evidenceId;
    }
    const before = await evidence(base, "fail");
    const l = await ctx.db
      .query("videoLoops")
      .withIndex("by_projectId_and_language", (q) =>
        q.eq("projectId", p.projectId).eq("language", "ru"),
      )
      .unique();
    if (!l) throw new ConvexError({ code: "FIXTURE_NO_LOOP" });
    const proposalArgs = {
      projectId: p.projectId,
      language: "ru",
      expectedLoopRevision: l.revisionId,
      idempotencyKey: "fixture-proposal",
      baseline: base,
      hypothesis: "One contract change",
      evidenceIds: [before],
      changes: [
        {
          sceneIds: ["hook"],
          shotIds: [],
          description: "Fixture change",
          expectedEffect: "State transition",
        },
      ],
      evaluation: {
        rubricHash,
        workflowHash,
        successCriteria: ["Contract guard"],
        preserve: ["Selected reference"],
      },
      iterationLimit: 1,
      noProgressLimit: 1,
    };
    async function rejected(name: string, input: Record<string, unknown>) {
      try {
        await call(name, input);
        return "unexpected_success";
      } catch (error) {
        if (
          error instanceof ConvexError &&
          typeof error.data === "object" &&
          error.data !== null &&
          "code" in error.data
        )
          return String(error.data.code);
        return "unexpected_error";
      }
    }
    let observed: string;
    if (args.caseId === "stale-base") {
      await checkpoint();
      observed = await rejected("videoWorkflow:agentPropose", proposalArgs);
    } else if (args.caseId === "human-pause") {
      const paused: { loopRevision: string } = await ctx.runMutation(
        makeFunctionReference<"mutation">("videoWorkflow:agentPause"),
        {
          videoPrincipalId: args.principalId,
          loopId: l._id,
          expectedLoopRevision: l.revisionId,
          idempotencyKey: "pause",
          reason: "Fixture",
          runningJobs: "leave_running",
        },
      );
      // Simulate the server-owned human pause flag; caller cannot supply it to an agent handler.
      await ctx.db.patch(l._id, { pausedByHuman: true });
      observed = await rejected("videoWorkflow:agentResume", {
        loopId: l._id,
        expectedLoopRevision: paused.loopRevision,
        idempotencyKey: "resume",
      });
    } else {
      const proposed: { proposalId: Id<"videoLoopProposals">; loopRevision: string } = await call(
        "videoWorkflow:agentPropose",
        proposalArgs,
      );
      if (args.caseId === "pending-proposal")
        observed = await rejected("videoWorkflow:agentPropose", {
          ...proposalArgs,
          expectedLoopRevision: proposed.loopRevision,
          idempotencyKey: "second",
        });
      else {
        const candidate = await checkpoint(),
          uncertain = await evidence(candidate, "uncertain"),
          decision = {
            loopId: l._id,
            expectedLoopRevision: proposed.loopRevision,
            idempotencyKey: "decision",
            proposalId: proposed.proposalId,
            candidate,
            evidenceIds: [before, uncertain],
            rationale: "Fixture cannot establish superiority",
          };
        if (args.caseId === "false-critic")
          observed = await rejected("videoWorkflow:agentSelect", {
            ...decision,
            decision: "select",
          });
        else {
          const result: { state: string; selectedCandidate: Id<"videoVersions"> } = await call(
            "videoWorkflow:agentSelect",
            { ...decision, decision: "revert" },
          );
          observed = result.selectedCandidate === base ? result.state : "selected_reference_lost";
        }
      }
    }
    const expected = FIXTURE_CONFIG.expected[args.caseId as (typeof FIXTURE_CASES)[number]];
    throw new ConvexError({
      code: "INTERNAL_FIXTURE_ROLLBACK",
      nonce: args.nonce,
      caseId: args.caseId,
      report: {
        caseId: args.caseId,
        outcome: observed === expected ? "pass" : "fail",
        expected,
        observed,
        coverage: FIXTURE_CONFIG.coverage,
        workspaceRolledBack: true,
      },
    });
  },
});
