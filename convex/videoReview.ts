import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { z } from "zod";
import { canonical, durationMsForFrames, Format, Timeline } from "../packages/video/src/contracts";
import { RenderEngine } from "../packages/video/src/media";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireIotaIdentity, requireUserId } from "./lib/auth";
import { sha256HexBytes } from "./lib/hash";
import { presignObject } from "./lib/objectStore";
import { feedbackBody, reviewTarget } from "./lib/videoReviewSchema";
import { noteHumanWorkflowInput } from "./lib/videoWorkflow";

type Target = Infer<typeof reviewTarget>;
type Body = Infer<typeof feedbackBody>;
const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message, effect: "not_applied" });
};
async function principal(ctx: QueryCtx | MutationCtx, agentId?: Id<"users">) {
  const id = agentId ?? (await requireUserId(ctx, await requireIotaIdentity(ctx)));
  if (!(await ctx.db.get(id))) fail("NOT_FOUND_OR_FORBIDDEN", "Principal unavailable");
  return id;
}
const Ref = z.object({ assetId: z.string(), revisionId: z.string() });
const RenderResult = z.object({
  engine: RenderEngine.optional(),
  kind: z.literal("render"),
  versionId: z.string(),
  video: Ref,
  poster: Ref,
  captions: Ref,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  partial: z.boolean(),
  metadata: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    durationMs: z.number().positive(),
    fps: Format.shape.fps,
  }),
});

async function registeredRender(ctx: QueryCtx | MutationCtx, jobId: Id<"videoJobs">) {
  const job = await ctx.db.get(jobId);
  if (
    !job ||
    job.kind !== "render" ||
    job.state !== "succeeded" ||
    !job.result ||
    !job.versionId ||
    !job.projectId
  )
    return fail("ASSET_NOT_READY", "A durably saved render is required");
  const parsed = RenderResult.safeParse(JSON.parse(job.result));
  if (!parsed.success || parsed.data.versionId !== job.versionId)
    return fail("ASSET_NOT_READY", "Render metadata is incomplete");
  const result = parsed.data;
  const version = await ctx.db.get(job.versionId);
  const project = await ctx.db.get(job.projectId);
  if (
    !version ||
    !project ||
    version.projectId !== project._id ||
    project.workspaceId !== job.workspaceId ||
    !(await ctx.db.get(project.workspaceId))
  )
    return fail("NOT_FOUND_OR_FORBIDDEN", "Render unavailable");
  async function asset(ref: z.infer<typeof Ref>, mime: string) {
    const id = ctx.db.normalizeId("assets", ref.assetId);
    const revisionId = ctx.db.normalizeId("assetVersions", ref.revisionId);
    const item = id ? await ctx.db.get(id) : null;
    const revision = revisionId ? await ctx.db.get(revisionId) : null;
    if (
      !item ||
      item.workspaceId !== project!.workspaceId ||
      item.archivedAt !== undefined ||
      !revision ||
      revision.assetId !== item._id ||
      revision.mimeType !== mime
    )
      return fail("NOT_FOUND_OR_FORBIDDEN", "Pinned render asset unavailable");
    return revision;
  }
  const video = await asset(result.video, "video/mp4");
  const poster = await asset(result.poster, "image/png");
  const captions = await asset(result.captions, "text/vtt");
  if (video.contentHash !== result.sha256)
    return fail("ASSET_NOT_READY", "Rendered hash does not match registered bytes");
  const draft = await ctx.db.get(version.draftId);
  const stale =
    !draft ||
    draft.scriptRevision !== version.scriptRevision ||
    draft.timelineRevision !== version.timelineRevision ||
    project.revisionId !== version.projectRevision;
  const request = JSON.parse(job.request) as {
    mode?: string;
    range?: { startFrame: number; endFrame: number };
  };
  const manifest = JSON.parse(version.manifest) as { timeline: unknown };
  const timeline = Timeline.parse(manifest.timeline);
  const frameCount = request.range
    ? request.range.endFrame - request.range.startFrame
    : timeline.durationFrames;
  const videoDurationMs = durationMsForFrames(frameCount, timeline.fps);
  return {
    job,
    result,
    version,
    project,
    video,
    poster,
    captions,
    stale,
    approvable: !result.partial && request.mode !== "analysis_proxy",
    frameCount,
    videoDurationMs,
  };
}
async function scope(ctx: QueryCtx | MutationCtx, target: Target) {
  if (target.kind === "render") {
    const render = await registeredRender(ctx, target.jobId);
    return {
      projectId: render.project._id,
      workspaceId: render.project.workspaceId,
      language: render.version.language,
      durationMs: render.videoDurationMs,
    };
  }
  const draft = await ctx.db.get(target.draftId);
  const project = draft ? await ctx.db.get(draft.projectId) : null;
  const revision = await ctx.db
    .query("videoDocumentRevisions")
    .withIndex("by_draftId_and_revisionId", (q) =>
      q.eq("draftId", target.draftId).eq("revisionId", target.revisionId),
    )
    .unique();
  if (
    !draft ||
    !project ||
    !revision ||
    revision.kind !== target.kind ||
    !(await ctx.db.get(project.workspaceId))
  )
    return fail("NOT_FOUND_OR_FORBIDDEN", "Target revision unavailable");
  const document = JSON.parse(revision.content) as {
    scenesById?: Record<string, unknown>;
    tracksById?: Record<string, { clipsById: Record<string, unknown> }>;
  };
  if (target.kind === "script" && target.sceneId && !document.scenesById?.[target.sceneId])
    fail("VALIDATION_ERROR", "Scene does not exist in this revision");
  if (
    target.kind === "timeline" &&
    target.clipId &&
    !Object.values(document.tracksById ?? {}).some((track) =>
      Object.hasOwn(track.clipsById, target.clipId!),
    )
  )
    fail("VALIDATION_ERROR", "Clip does not exist in this revision");
  return {
    projectId: project._id,
    workspaceId: project.workspaceId,
    language: draft.language,
    durationMs: null,
  };
}
function validateBody(body: Body, duration: number | null, allowEmpty = false) {
  if (duration !== null && body.startMs !== undefined && body.startMs >= duration)
    fail("VALIDATION_ERROR", "Anchor must point inside the video, not at its exclusive end");
  if ((!allowEmpty && !body.text.trim()) || body.text.length > 16000)
    fail("VALIDATION_ERROR", "Feedback needs 1–16000 characters");
  for (const value of [body.startMs, body.endMs])
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 0 || duration === null || value > duration)
    )
      fail("VALIDATION_ERROR", "Feedback time is outside this render");
  if (body.endMs !== undefined && (body.startMs === undefined || body.endMs <= body.startMs))
    fail("VALIDATION_ERROR", "End must be after the anchor time");
  if (body.region) {
    const r = body.region;
    if (
      body.startMs === undefined ||
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width <= 0 ||
      r.height <= 0 ||
      r.x + r.width > 1 ||
      r.y + r.height > 1
    )
      fail("VALIDATION_ERROR", "Region must fit inside the anchored video frame");
  }
}
async function once<T>(
  ctx: MutationCtx,
  userId: Id<"users">,
  workspaceId: Id<"workspaces">,
  tool: string,
  key: string,
  args: unknown,
  perform: () => Promise<T>,
): Promise<T> {
  if (!key || key.length > 200) fail("VALIDATION_ERROR", "Operation key needs 1–200 characters");
  const inputHash = await sha256HexBytes(new TextEncoder().encode(canonical(args)));
  const previous = await ctx.db
    .query("videoOperations")
    .withIndex("by_principalId_and_workspaceId_and_tool_and_key", (q) =>
      q.eq("principalId", userId).eq("workspaceId", workspaceId).eq("tool", tool).eq("key", key),
    )
    .unique();
  if (previous) {
    if (previous.inputHash !== inputHash)
      fail("IDEMPOTENCY_CONFLICT", "This key belongs to another operation");
    return JSON.parse(previous.result) as T;
  }
  const result = await perform();
  await ctx.db.insert("videoOperations", {
    principalId: userId,
    workspaceId,
    tool,
    key,
    inputHash,
    result: canonical(result),
  });
  return result;
}

const targetArgs = { target: reviewTarget };
export const getDraft = query({
  args: targetArgs,
  handler: async (ctx, args) => {
    const userId = await principal(ctx);
    await scope(ctx, args.target);
    const saved = await ctx.db
      .query("videoFeedbackDrafts")
      .withIndex("by_principalId_and_targetKey", (q) =>
        q.eq("principalId", userId).eq("targetKey", canonical(args.target)),
      )
      .unique();
    return saved
      ? {
          revision: saved.revision,
          body: saved.body,
          postedCommentId:
            saved.submittedRevision === saved.revision ? (saved.submittedCommentId ?? null) : null,
        }
      : { revision: 0, body: { text: "" } as Body, postedCommentId: null };
  },
});
export const saveDraft = mutation({
  args: {
    ...targetArgs,
    body: feedbackBody,
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await principal(ctx);
    const targetScope = await scope(ctx, args.target);
    validateBody(args.body, targetScope.durationMs, true);
    return once(
      ctx,
      userId,
      targetScope.workspaceId,
      "review.saveDraft",
      args.idempotencyKey,
      args,
      async () => {
        const targetKey = canonical(args.target);
        const saved = await ctx.db
          .query("videoFeedbackDrafts")
          .withIndex("by_principalId_and_targetKey", (q) =>
            q.eq("principalId", userId).eq("targetKey", targetKey),
          )
          .unique();
        if ((saved?.revision ?? 0) !== args.expectedRevision)
          fail(
            "REVISION_CONFLICT",
            "Feedback draft changed in another tab; retain and compare your text",
          );
        const revision = args.expectedRevision + 1;
        if (saved)
          await ctx.db.patch(saved._id, { body: args.body, revision, updatedAt: Date.now() });
        else
          await ctx.db.insert("videoFeedbackDrafts", {
            principalId: userId,
            targetKey,
            target: args.target,
            body: args.body,
            revision,
            updatedAt: Date.now(),
          });
        return { revision };
      },
    );
  },
});

const createArgs = {
  ...targetArgs,
  body: feedbackBody,
  idempotencyKey: v.string(),
  draftRevision: v.optional(v.number()),
};
async function createComment(
  ctx: MutationCtx,
  args: { target: Target; body: Body; idempotencyKey: string; draftRevision?: number },
  agentId?: Id<"users">,
) {
  const userId = await principal(ctx, agentId);
  const targetScope = await scope(ctx, args.target);
  validateBody(args.body, targetScope.durationMs);
  return once(
    ctx,
    userId,
    targetScope.workspaceId,
    "review.createComment",
    args.idempotencyKey,
    args,
    async () => {
      const savedDraft =
        args.draftRevision === undefined
          ? null
          : await ctx.db
              .query("videoFeedbackDrafts")
              .withIndex("by_principalId_and_targetKey", (q) =>
                q.eq("principalId", userId).eq("targetKey", canonical(args.target)),
              )
              .unique();
      if (args.draftRevision !== undefined) {
        if (
          agentId ||
          !savedDraft ||
          savedDraft.revision !== args.draftRevision ||
          canonical(savedDraft.body) !== canonical(args.body)
        )
          return fail("REVISION_CONFLICT", "Post the exact saved human draft revision");
        if (savedDraft.submittedRevision === args.draftRevision && savedDraft.submittedCommentId)
          return { commentId: savedDraft.submittedCommentId, revision: 1, status: "open" as const };
      }
      const commentId = await ctx.db.insert("videoComments", {
        projectId: targetScope.projectId,
        language: targetScope.language,
        target: args.target,
        targetKey: canonical(args.target),
        body: args.body,
        authorId: userId,
        authorKind: agentId ? "agent" : "human",
        status: "open",
        revision: 1,
        createdAt: Date.now(),
      });
      if (savedDraft)
        await ctx.db.patch(savedDraft._id, {
          submittedRevision: savedDraft.revision,
          submittedCommentId: commentId,
        });
      if (!agentId) await noteHumanWorkflowInput(ctx, targetScope.projectId, targetScope.language);
      return { commentId, revision: 1, status: "open" as const };
    },
  );
}
export const addComment = mutation({
  args: createArgs,
  handler: (ctx, args) => createComment(ctx, args),
});
export const agentCreateComment = internalMutation({
  args: { ...createArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => createComment(ctx, args, videoPrincipalId),
});
const listArgs = {
  projectId: v.id("videoProjects"),
  target: v.optional(reviewTarget),
  paginationOpts: paginationOptsValidator,
};
async function listComments(
  ctx: QueryCtx,
  args: {
    projectId: Id<"videoProjects">;
    target?: Target;
    paginationOpts: Infer<typeof paginationOptsValidator>;
  },
  agentId?: Id<"users">,
) {
  await principal(ctx, agentId);
  const project = await ctx.db.get(args.projectId);
  if (!project || !(await ctx.db.get(project.workspaceId)))
    fail("NOT_FOUND_OR_FORBIDDEN", "Project unavailable");
  if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
    fail("VALIDATION_ERROR", "Page size must be 1–100");
  if (args.target && (await scope(ctx, args.target)).projectId !== args.projectId)
    fail("NOT_FOUND_OR_FORBIDDEN", "Target belongs to another project");
  const rows = args.target
    ? ctx.db
        .query("videoComments")
        .withIndex("by_targetKey_and_createdAt", (q) => q.eq("targetKey", canonical(args.target)))
    : ctx.db
        .query("videoComments")
        .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId));
  return rows.order("desc").paginate(args.paginationOpts);
}
export const comments = query({ args: listArgs, handler: (ctx, args) => listComments(ctx, args) });
export const agentListComments = internalQuery({
  args: { ...listArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => listComments(ctx, args, videoPrincipalId),
});

const updateArgs = {
  commentId: v.id("videoComments"),
  expectedRevision: v.number(),
  idempotencyKey: v.string(),
};
const statusArgs = {
  ...updateArgs,
  status: v.union(v.literal("open"), v.literal("completed"), v.literal("resolved")),
  summary: v.optional(v.string()),
  resultTarget: v.optional(reviewTarget),
};
type StatusArgs = {
  commentId: Id<"videoComments">;
  expectedRevision: number;
  idempotencyKey: string;
  status: "open" | "completed" | "resolved";
  summary?: string;
  resultTarget?: Target;
};
async function changeStatus(ctx: MutationCtx, args: StatusArgs, agentId?: Id<"users">) {
  const userId = await principal(ctx, agentId);
  const comment = await ctx.db.get(args.commentId);
  if (!comment) return fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
  const targetScope = await scope(ctx, comment.target);
  return once(
    ctx,
    userId,
    targetScope.workspaceId,
    "review.commentStatus",
    args.idempotencyKey,
    args,
    async () => {
      if (comment.revision !== args.expectedRevision)
        fail("REVISION_CONFLICT", "Comment changed; read the current revision");
      if (
        args.status !== "completed" &&
        (comment.authorId !== userId || (agentId && comment.authorKind === "human"))
      )
        fail(
          "HUMAN_ACTION_REQUIRED",
          "Only the note author may resolve or reopen it; agent completion is not human resolution",
        );
      if (args.status === "completed" && comment.status === "resolved")
        fail("VALIDATION_ERROR", "A resolved note cannot be completed again");
      if (args.status === "completed" && (!args.summary?.trim() || args.summary.length > 16000))
        fail("VALIDATION_ERROR", "Completion requires a bounded explanation");
      if (args.resultTarget) {
        const result = await scope(ctx, args.resultTarget);
        if (result.projectId !== comment.projectId || result.language !== comment.language)
          fail(
            "VALIDATION_ERROR",
            "Completion target must belong to the same project and language",
          );
      }
      const revision = comment.revision + 1;
      if (!agentId) await noteHumanWorkflowInput(ctx, comment.projectId, comment.language);
      await ctx.db.patch(comment._id, {
        status: args.status,
        revision,
        ...(args.status === "completed"
          ? {
              completion: {
                summary: args.summary!,
                ...(args.resultTarget ? { resultTarget: args.resultTarget } : {}),
                at: Date.now(),
              },
            }
          : {}),
      });
      return { commentId: comment._id, revision, status: args.status };
    },
  );
}
export const setCommentStatus = mutation({
  args: statusArgs,
  handler: (ctx, args) => changeStatus(ctx, args),
});
export const agentSetCommentStatus = internalMutation({
  args: { ...statusArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => changeStatus(ctx, args, videoPrincipalId),
});
const reanchorArgs = {
  ...updateArgs,
  target: reviewTarget,
  body: feedbackBody,
  reason: v.string(),
};
async function reanchor(
  ctx: MutationCtx,
  args: {
    commentId: Id<"videoComments">;
    expectedRevision: number;
    idempotencyKey: string;
    target: Target;
    body: Body;
    reason: string;
  },
  agentId?: Id<"users">,
) {
  const userId = await principal(ctx, agentId);
  const comment = await ctx.db.get(args.commentId);
  if (!comment) return fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
  await scope(ctx, comment.target);
  const destination = await scope(ctx, args.target);
  validateBody(args.body, destination.durationMs);
  if (destination.projectId !== comment.projectId || destination.language !== comment.language)
    fail("VALIDATION_ERROR", "Reanchor must retain project and language");
  if (!args.reason.trim() || args.reason.length > 2000 || args.body.text !== comment.body.text)
    fail("VALIDATION_ERROR", "Reanchor needs a reason and must preserve the original note text");
  return once(
    ctx,
    userId,
    destination.workspaceId,
    "review.reanchor",
    args.idempotencyKey,
    args,
    async () => {
      if (comment.revision !== args.expectedRevision)
        fail("REVISION_CONFLICT", "Comment changed; compare the current anchor");
      if (agentId && comment.authorKind === "human")
        fail(
          "HUMAN_ACTION_REQUIRED",
          "An agent can suggest a new target in its completion, but cannot move a human note",
        );
      if (comment.authorId !== userId)
        fail("HUMAN_ACTION_REQUIRED", "Only the note author may move its anchor");
      await ctx.db.insert("videoCommentAnchors", {
        commentId: comment._id,
        previousTarget: comment.target,
        previousBody: comment.body,
        target: args.target,
        body: args.body,
        actorId: userId,
        reason: args.reason,
        createdAt: Date.now(),
      });
      if (!agentId) await noteHumanWorkflowInput(ctx, comment.projectId, comment.language);
      const revision = comment.revision + 1;
      await ctx.db.patch(comment._id, {
        target: args.target,
        targetKey: canonical(args.target),
        body: args.body,
        revision,
        status: "open",
      });
      return { commentId: comment._id, revision };
    },
  );
}
export const reanchorComment = mutation({
  args: reanchorArgs,
  handler: (ctx, args) => reanchor(ctx, args),
});
export const agentReanchorComment = internalMutation({
  args: { ...reanchorArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => reanchor(ctx, args, videoPrincipalId),
});
export const anchorHistory = query({
  args: { commentId: v.id("videoComments"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await principal(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
    await scope(ctx, comment.target);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      fail("VALIDATION_ERROR", "Page size must be 1–100");
    return ctx.db
      .query("videoCommentAnchors")
      .withIndex("by_commentId_and_createdAt", (q) => q.eq("commentId", args.commentId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

const replyArgs = {
  commentId: v.id("videoComments"),
  body: v.string(),
  idempotencyKey: v.string(),
};
async function reply(
  ctx: MutationCtx,
  args: { commentId: Id<"videoComments">; body: string; idempotencyKey: string },
  agentId?: Id<"users">,
) {
  const userId = await principal(ctx, agentId);
  const comment = await ctx.db.get(args.commentId);
  if (!comment) return fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
  const s = await scope(ctx, comment.target);
  if (!args.body.trim() || args.body.length > 16000)
    fail("VALIDATION_ERROR", "Reply needs 1–16000 characters");
  return once(ctx, userId, s.workspaceId, "review.reply", args.idempotencyKey, args, async () => {
    if (!agentId) await noteHumanWorkflowInput(ctx, s.projectId, s.language);
    return {
      replyId: await ctx.db.insert("videoCommentReplies", {
        commentId: args.commentId,
        body: args.body,
        authorId: userId,
        authorKind: agentId ? "agent" : "human",
        createdAt: Date.now(),
      }),
    };
  });
}
export const addReply = mutation({ args: replyArgs, handler: (ctx, args) => reply(ctx, args) });
export const agentAddReply = internalMutation({
  args: { ...replyArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => reply(ctx, args, videoPrincipalId),
});
export const replies = query({
  args: { commentId: v.id("videoComments"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await principal(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
    await scope(ctx, comment.target);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      fail("VALIDATION_ERROR", "Page size must be 1–100");
    return ctx.db
      .query("videoCommentReplies")
      .withIndex("by_commentId_and_createdAt", (q) => q.eq("commentId", args.commentId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
export const agentGetComment = internalQuery({
  args: { commentId: v.id("videoComments"), videoPrincipalId: v.id("users") },
  handler: async (ctx, args) => {
    await principal(ctx, args.videoPrincipalId);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
    const targetScope = await scope(ctx, comment.target);
    return { ...comment, workspaceId: targetScope.workspaceId };
  },
});
export const agentReplies = internalQuery({
  args: {
    commentId: v.id("videoComments"),
    videoPrincipalId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await principal(ctx, args.videoPrincipalId);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
    await scope(ctx, comment.target);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      fail("VALIDATION_ERROR", "Page size must be 1–100");
    return ctx.db
      .query("videoCommentReplies")
      .withIndex("by_commentId_and_createdAt", (q) => q.eq("commentId", args.commentId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const renderMetadata = query({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    const userId = await principal(ctx);
    const r = await registeredRender(ctx, args.jobId);
    const approval = await ctx.db
      .query("videoApprovals")
      .withIndex("by_jobId_and_principalId", (q) =>
        q.eq("jobId", args.jobId).eq("principalId", userId),
      )
      .unique();
    return {
      jobId: args.jobId,
      projectId: r.project._id,
      versionId: r.version._id,
      language: r.version.language,
      sha256: r.result.sha256,
      ...r.result.metadata,
      frameCount: r.frameCount,
      videoDurationMs: r.videoDurationMs,
      containerDurationMs: r.result.metadata.durationMs,
      engine: r.result.engine ?? null,
      partial: r.result.partial,
      stale: r.stale,
      approvable: r.approvable,
      approval: approval ? { createdAt: approval.createdAt, sha256: approval.sha256 } : null,
    };
  },
});
export const previewData = internalQuery({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    await principal(ctx);
    const r = await registeredRender(ctx, args.jobId);
    return { video: r.video.objectKey, poster: r.poster.objectKey, captions: r.captions.objectKey };
  },
});
export const preview = action({
  args: { jobId: v.id("videoJobs") },
  handler: async (
    ctx,
    args,
  ): Promise<{ videoUrl: string; posterUrl: string; captionsUrl: string; expiresAt: number }> => {
    await requireIotaIdentity(ctx);
    const keys: { video: string; poster: string; captions: string } = await ctx.runQuery(
      internal.videoReview.previewData,
      args,
    );
    const [videoUrl, posterUrl, captionsUrl] = await Promise.all(
      [keys.video, keys.poster, keys.captions].map((key) => presignObject(key, "GET", 900)),
    );
    return {
      videoUrl: videoUrl!,
      posterUrl: posterUrl!,
      captionsUrl: captionsUrl!,
      expiresAt: Date.now() + 900000,
    };
  },
});
export const approve = mutation({
  args: {
    jobId: v.id("videoJobs"),
    versionId: v.id("videoVersions"),
    language: v.union(v.literal("ru"), v.literal("uz")),
    sha256: v.string(),
    idempotencyKey: v.string(),
    confirmedViewed: v.literal(true),
  },
  handler: async (ctx, args) => {
    const userId = await principal(ctx);
    const r = await registeredRender(ctx, args.jobId);
    if (
      r.version._id !== args.versionId ||
      r.version.language !== args.language ||
      r.result.sha256 !== args.sha256
    )
      fail("VALIDATION_ERROR", "Approval must name this exact language, version and MP4 hash");
    return once(
      ctx,
      userId,
      r.project.workspaceId,
      "review.approve",
      args.idempotencyKey,
      args,
      async () => {
        if (!r.approvable)
          fail("HUMAN_ACTION_REQUIRED", "Partial or analysis proxy renders cannot be approved");
        const existing = await ctx.db
          .query("videoApprovals")
          .withIndex("by_jobId_and_principalId", (q) =>
            q.eq("jobId", args.jobId).eq("principalId", userId),
          )
          .unique();
        if (existing) return { approvalId: existing._id };
        return {
          approvalId: await ctx.db.insert("videoApprovals", {
            jobId: args.jobId,
            versionId: args.versionId,
            language: args.language,
            sha256: args.sha256,
            principalId: userId,
            createdAt: Date.now(),
          }),
        };
      },
    );
  },
});
