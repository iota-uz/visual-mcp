import { defineTable } from "convex/server";
import { v } from "convex/values";

export const learningTables = {
  videoMemories: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("videoProjects"),
    profileId: v.optional(v.id("videoProfiles")),
    language: v.union(v.literal("ru"), v.literal("uz")),
    revisionId: v.string(),
    content: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("supported"),
      v.literal("rejected"),
      v.literal("superseded"),
    ),
    validation: v.optional(v.string()),
  })
    .index("by_workspaceId_and_status", ["workspaceId", "status"])
    .index("by_projectId_and_status", ["projectId", "status"]),
  videoMemoryRevisions: defineTable({
    memoryId: v.id("videoMemories"),
    revisionId: v.string(),
    content: v.string(),
    status: v.string(),
    validation: v.optional(v.string()),
  }).index("by_memoryId_and_revisionId", ["memoryId", "revisionId"]),
  videoEvaluations: defineTable({
    workspaceId: v.id("workspaces"),
    jobId: v.id("videoJobs"),
    request: v.string(),
    report: v.string(),
    reportHash: v.string(),
  }).index("by_jobId", ["jobId"]),
  videoPublications: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("videoProjects"),
    language: v.union(v.literal("ru"), v.literal("uz")),
    platform: v.string(),
    externalPostId: v.string(),
    revisionId: v.string(),
    content: v.string(),
  })
    .index("by_workspaceId_and_platform_and_externalPostId", [
      "workspaceId",
      "platform",
      "externalPostId",
    ])
    .index("by_projectId", ["projectId"]),
  videoPublicationRevisions: defineTable({
    publicationId: v.id("videoPublications"),
    revisionId: v.string(),
    content: v.string(),
  }).index("by_publicationId_and_revisionId", ["publicationId", "revisionId"]),
  videoMetrics: defineTable({
    workspaceId: v.id("workspaces"),
    projectId: v.id("videoProjects"),
    publicationId: v.id("videoPublications"),
    publicationRevision: v.string(),
    language: v.union(v.literal("ru"), v.literal("uz")),
    identityHash: v.string(),
    content: v.string(),
    groupKey: v.string(),
  })
    .index("by_workspaceId_and_identityHash", ["workspaceId", "identityHash"])
    .index("by_projectId", ["projectId"])
    .index("by_publicationId", ["publicationId"]),
};
