import { ConvexError } from "convex/values";
import { canonical } from "../../packages/video/src/contracts";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256Hex } from "./hash";

export async function initializeVideoWorkflow(
  ctx: MutationCtx,
  args: {
    projectId: Id<"videoProjects">;
    workspaceId: Id<"workspaces">;
    languages: ("ru" | "uz")[];
  },
) {
  for (const language of args.languages) {
    const existing = await ctx.db
      .query("videoLoops")
      .withIndex("by_projectId_and_language", (q) =>
        q.eq("projectId", args.projectId).eq("language", language),
      )
      .unique();
    if (!existing)
      await ctx.db.insert("videoLoops", {
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        language,
        revisionId: await sha256Hex(`${args.projectId}:${language}:initial`),
        state: "idle",
        iteration: 0,
        noProgress: 0,
        iterationLimit: 5,
        noProgressLimit: 2,
        baseline: null,
        selectedCandidate: null,
        pendingProposalId: null,
        stopReason: null,
        evaluation: null,
        humanInputRevision: 0,
        pausedByHuman: false,
      });
  }
  const existing = await ctx.db
    .query("videoProfiles")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
    .unique();
  if (!existing) {
    const content = canonical({
      name: "farq.uz",
      brand: "farq.uz",
      language: null,
      versionId: null,
      sceneIds: [],
      entries: [],
    });
    const revisionId = await sha256Hex(content);
    const profileId = await ctx.db.insert("videoProfiles", {
      projectId: args.projectId,
      revisionId,
      content,
    });
    await ctx.db.insert("videoProfileRevisions", {
      profileId,
      revisionId,
      content,
      reason: "Initial empty profile; no facts inferred",
    });
  }
}
/** Same transactional admission gate for direct producer calls and broker-dispatched producers. */
export async function assertVideoProductionAllowed(
  ctx: QueryCtx | MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    projectId?: Id<"videoProjects">;
    versionId?: Id<"videoVersions">;
  },
) {
  const version = args.versionId ? await ctx.db.get(args.versionId) : null;
  const projectId = args.projectId ?? version?.projectId;
  if (!projectId) return;
  const project = await ctx.db.get(projectId);
  if (
    !project ||
    project.workspaceId !== args.workspaceId ||
    (version && version.projectId !== projectId)
  )
    throw new ConvexError({
      code: "NOT_FOUND_OR_FORBIDDEN",
      message: "Production scope mismatch",
      effect: "not_applied",
    });
  const loops = await ctx.db
    .query("videoLoops")
    .withIndex("by_projectId_and_language", (q) => q.eq("projectId", projectId))
    .take(2);
  const blocked = loops.find(
    (l) =>
      (!version || l.language === version.language) &&
      ["paused", "awaiting_human", "finished"].includes(l.state),
  );
  if (blocked)
    throw new ConvexError({
      code: blocked.state === "paused" ? "LOOP_PAUSED" : "HUMAN_ACTION_REQUIRED",
      message:
        blocked.stopReason ??
        "Production loop stopped; inspect loop and ask human before continuing",
      effect: "not_applied",
    });
}
/** Call in the same authenticated HITL mutation that changes human direction/feedback. */
export async function noteHumanWorkflowInput(
  ctx: MutationCtx,
  projectId: Id<"videoProjects">,
  language?: "ru" | "uz",
) {
  const loops = await ctx.db
    .query("videoLoops")
    .withIndex("by_projectId_and_language", (q) => q.eq("projectId", projectId))
    .take(2);
  for (const loop of loops)
    if (!language || loop.language === language)
      await ctx.db.patch(loop._id, {
        humanInputRevision: loop.humanInputRevision + 1,
        revisionId: await sha256Hex(`${loop.revisionId}:human:${loop.humanInputRevision + 1}`),
      });
}
