import { defineTable } from "convex/server";
import { v } from "convex/values";
export const reviewTarget = v.union(
  v.object({ kind: v.literal("render"), jobId: v.id("videoJobs") }),
  v.object({
    kind: v.literal("script"),
    draftId: v.id("videoDrafts"),
    revisionId: v.string(),
    sceneId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("timeline"),
    draftId: v.id("videoDrafts"),
    revisionId: v.string(),
    clipId: v.optional(v.string()),
  }),
);
export const reviewRegion = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});
export const feedbackBody = v.object({
  text: v.string(),
  startMs: v.optional(v.number()),
  endMs: v.optional(v.number()),
  region: v.optional(reviewRegion),
});
export const videoReviewTables = {
  videoCommentAnchors: defineTable({
    commentId: v.id("videoComments"),
    previousTarget: reviewTarget,
    previousBody: feedbackBody,
    target: reviewTarget,
    body: feedbackBody,
    actorId: v.id("users"),
    reason: v.string(),
    createdAt: v.number(),
  }).index("by_commentId_and_createdAt", ["commentId", "createdAt"]),
  videoFeedbackDrafts: defineTable({
    submittedRevision: v.optional(v.number()),
    submittedCommentId: v.optional(v.id("videoComments")),
    principalId: v.id("users"),
    targetKey: v.string(),
    target: reviewTarget,
    body: feedbackBody,
    revision: v.number(),
    updatedAt: v.number(),
  }).index("by_principalId_and_targetKey", ["principalId", "targetKey"]),
  videoComments: defineTable({
    projectId: v.id("videoProjects"),
    language: v.union(v.literal("ru"), v.literal("uz")),
    target: reviewTarget,
    targetKey: v.string(),
    body: feedbackBody,
    authorId: v.id("users"),
    authorKind: v.union(v.literal("human"), v.literal("agent")),
    status: v.union(v.literal("open"), v.literal("completed"), v.literal("resolved")),
    revision: v.number(),
    createdAt: v.number(),
    completion: v.optional(
      v.object({ summary: v.string(), resultTarget: v.optional(reviewTarget), at: v.number() }),
    ),
  })
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_targetKey_and_createdAt", ["targetKey", "createdAt"]),
  videoCommentReplies: defineTable({
    commentId: v.id("videoComments"),
    body: v.string(),
    authorId: v.id("users"),
    authorKind: v.union(v.literal("human"), v.literal("agent")),
    createdAt: v.number(),
  }).index("by_commentId_and_createdAt", ["commentId", "createdAt"]),
  videoApprovals: defineTable({
    jobId: v.id("videoJobs"),
    versionId: v.id("videoVersions"),
    language: v.union(v.literal("ru"), v.literal("uz")),
    sha256: v.string(),
    principalId: v.id("users"),
    createdAt: v.number(),
  }).index("by_jobId_and_principalId", ["jobId", "principalId"]),
};
