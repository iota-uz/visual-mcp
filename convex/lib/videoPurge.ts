import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Hard-delete one video project and its language drafts, versions, jobs,
 * comments and loop records. Shared library assets stay. The original Reels
 * archive, if any, is unlinked rather than erased.
 */
export async function purgeVideoProject(ctx: MutationCtx, projectId: Id<"videoProjects">) {
  const project = await ctx.db.get(projectId);
  if (project) {
    // Workspace-promoted definitions remain reusable; only project-local data is owned here.
    for (;;) {
      const actions = await ctx.db
        .query("characterActions")
        .withIndex("by_workspaceId_and_scope_and_projectId", (q) =>
          q
            .eq("workspaceId", project.workspaceId)
            .eq("scope", "project")
            .eq("projectId", projectId),
        )
        .take(16);
      if (!actions.length) break;
      for (const action of actions) await ctx.db.delete(action._id);
    }
  }
  for (;;) {
    const comments = await ctx.db
      .query("videoComments")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", projectId))
      .take(32);
    if (comments.length === 0) break;
    for (const comment of comments) {
      for (;;) {
        const replies = await ctx.db
          .query("videoCommentReplies")
          .withIndex("by_commentId_and_createdAt", (q) => q.eq("commentId", comment._id))
          .take(32);
        if (replies.length === 0) break;
        for (const reply of replies) await ctx.db.delete(reply._id);
      }
      for (;;) {
        const anchors = await ctx.db
          .query("videoCommentAnchors")
          .withIndex("by_commentId_and_createdAt", (q) => q.eq("commentId", comment._id))
          .take(32);
        if (anchors.length === 0) break;
        for (const anchor of anchors) await ctx.db.delete(anchor._id);
      }
      await ctx.db.delete(comment._id);
    }
  }

  const jobStates = [
    "queued",
    "running",
    "cancel_requested",
    "cancelled",
    "succeeded",
    "failed",
    "outcome_unknown",
  ] as const;
  for (const state of jobStates) {
    for (;;) {
      const jobs = await ctx.db
        .query("videoJobs")
        .withIndex("by_projectId_and_state", (q) => q.eq("projectId", projectId).eq("state", state))
        .take(16);
      if (jobs.length === 0) break;
      for (const job of jobs) {
        for (;;) {
          const effects = await ctx.db
            .query("videoJobEffects")
            .withIndex("by_jobId_and_callId", (q) => q.eq("jobId", job._id))
            .take(32);
          if (effects.length === 0) break;
          for (const effect of effects) await ctx.db.delete(effect._id);
        }
        const approvals = await ctx.db
          .query("videoApprovals")
          .withIndex("by_jobId_and_principalId", (q) => q.eq("jobId", job._id))
          .take(16);
        for (const approval of approvals) await ctx.db.delete(approval._id);
        const evaluations = await ctx.db
          .query("videoEvaluations")
          .withIndex("by_jobId", (q) => q.eq("jobId", job._id))
          .take(8);
        for (const evaluation of evaluations) await ctx.db.delete(evaluation._id);
        const evidence = await ctx.db
          .query("videoWorkflowEvidence")
          .withIndex("by_jobId", (q) => q.eq("jobId", job._id))
          .take(16);
        for (const row of evidence) await ctx.db.delete(row._id);
        await ctx.db.delete(job._id);
      }
    }
  }

  const loops = await ctx.db
    .query("videoLoops")
    .withIndex("by_projectId_and_language", (q) => q.eq("projectId", projectId))
    .take(8);
  for (const loop of loops) {
    const proposals = await ctx.db
      .query("videoLoopProposals")
      .withIndex("by_loopId", (q) => q.eq("loopId", loop._id))
      .take(32);
    for (const proposal of proposals) await ctx.db.delete(proposal._id);
    await ctx.db.delete(loop._id);
  }

  const profiles = await ctx.db
    .query("videoProfiles")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(8);
  for (const profile of profiles) {
    const revisions = await ctx.db
      .query("videoProfileRevisions")
      .withIndex("by_profileId_and_revisionId", (q) => q.eq("profileId", profile._id))
      .take(32);
    for (const revision of revisions) await ctx.db.delete(revision._id);
    await ctx.db.delete(profile._id);
  }

  for (const status of ["proposed", "supported", "rejected", "superseded"] as const) {
    const memories = await ctx.db
      .query("videoMemories")
      .withIndex("by_projectId_and_status", (q) =>
        q.eq("projectId", projectId).eq("status", status),
      )
      .take(32);
    for (const memory of memories) {
      const revisions = await ctx.db
        .query("videoMemoryRevisions")
        .withIndex("by_memoryId_and_revisionId", (q) => q.eq("memoryId", memory._id))
        .take(16);
      for (const revision of revisions) await ctx.db.delete(revision._id);
      await ctx.db.delete(memory._id);
    }
  }

  const publications = await ctx.db
    .query("videoPublications")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(32);
  for (const publication of publications) {
    const metrics = await ctx.db
      .query("videoMetrics")
      .withIndex("by_publicationId", (q) => q.eq("publicationId", publication._id))
      .take(32);
    for (const metric of metrics) await ctx.db.delete(metric._id);
    const revisions = await ctx.db
      .query("videoPublicationRevisions")
      .withIndex("by_publicationId_and_revisionId", (q) => q.eq("publicationId", publication._id))
      .take(16);
    for (const revision of revisions) await ctx.db.delete(revision._id);
    await ctx.db.delete(publication._id);
  }

  const drafts = await ctx.db
    .query("videoDrafts")
    .withIndex("by_projectId_and_language", (q) => q.eq("projectId", projectId))
    .take(8);
  for (const draft of drafts) {
    for (;;) {
      const revisions = await ctx.db
        .query("videoDocumentRevisions")
        .withIndex("by_draftId_and_revisionId", (q) => q.eq("draftId", draft._id))
        .take(32);
      if (revisions.length === 0) break;
      for (const revision of revisions) await ctx.db.delete(revision._id);
    }
    await ctx.db.delete(draft._id);
  }

  for (;;) {
    const versions = await ctx.db
      .query("videoVersions")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", projectId))
      .take(32);
    if (versions.length === 0) break;
    for (const version of versions) {
      const evidence = await ctx.db
        .query("videoWorkflowEvidence")
        .withIndex("by_versionId", (q) => q.eq("versionId", version._id))
        .take(16);
      for (const row of evidence) await ctx.db.delete(row._id);
      await ctx.db.delete(version._id);
    }
  }

  const migrations = await ctx.db
    .query("videoMigrations")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(8);
  for (const migration of migrations) {
    await ctx.db.patch(migration._id, { projectId: undefined });
  }

  await ctx.db.delete(projectId);
}
