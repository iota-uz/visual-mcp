import { defineTable } from "convex/server";
import { v } from "convex/values";

export const workflowTables = {
  videoProfiles: defineTable({
    projectId: v.id("videoProjects"),
    revisionId: v.string(),
    content: v.string(),
  }).index("by_projectId", ["projectId"]),
  videoProfileRevisions: defineTable({
    profileId: v.id("videoProfiles"),
    revisionId: v.string(),
    content: v.string(),
    reason: v.string(),
  }).index("by_profileId_and_revisionId", ["profileId", "revisionId"]),
  videoLoops: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("videoProjects"),
    language: v.union(v.literal("ru"), v.literal("uz")),
    revisionId: v.string(),
    state: v.union(
      v.literal("idle"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("awaiting_human"),
      v.literal("finished"),
    ),
    iteration: v.number(),
    noProgress: v.number(),
    iterationLimit: v.number(),
    noProgressLimit: v.number(),
    baseline: v.union(v.id("videoVersions"), v.null()),
    selectedCandidate: v.union(v.id("videoVersions"), v.null()),
    pendingProposalId: v.union(v.id("videoLoopProposals"), v.null()),
    stopReason: v.union(v.string(), v.null()),
    evaluation: v.union(v.string(), v.null()),
    humanInputRevision: v.number(),
    pausedByHuman: v.boolean(),
  }).index("by_projectId_and_language", ["projectId", "language"]),
  videoLoopProposals: defineTable({
    loopId: v.id("videoLoops"),
    baseline: v.id("videoVersions"),
    referenceVersion: v.id("videoVersions"),
    humanInputRevision: v.number(),
    projectRevision: v.string(),
    hypothesis: v.string(),
    changes: v.string(),
    evidenceIds: v.array(v.id("videoWorkflowEvidence")),
    state: v.union(
      v.literal("proposed"),
      v.literal("selected"),
      v.literal("reverted"),
      v.literal("abandoned"),
    ),
    abandonedBy: v.optional(v.id("users")),
    abandonedAt: v.optional(v.number()),
    candidate: v.optional(v.id("videoVersions")),
    decisionEvidenceIds: v.optional(v.array(v.id("videoWorkflowEvidence"))),
    rationale: v.optional(v.string()),
  }).index("by_loopId", ["loopId"]),
  videoWorkflowEvidence: defineTable({
    projectId: v.id("videoProjects"),
    versionId: v.id("videoVersions"),
    jobId: v.id("videoJobs"),
    content: v.string(),
    contentHash: v.string(),
  })
    .index("by_jobId", ["jobId"])
    .index("by_versionId", ["versionId"]),
};
