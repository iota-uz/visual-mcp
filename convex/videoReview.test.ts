/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
async function setup(partial = false) {
  const t = convexTest(schema, modules);
  const { userId, workspaceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "review@iota.uz",
      name: "Synthetic reviewer",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Synthetic",
      slug: "synthetic",
      createdBy: userId,
    });
    return { userId, workspaceId };
  });
  const as = t.withIdentity({ subject: `${userId}|session`, issuer: "convex" });
  const project = await as.mutation(api.video.createProject, {
    workspaceId,
    title: "Synthetic only",
    brief: { topic: "Test", direction: "Test" },
    languages: ["ru", "uz"],
    format: { width: 360, height: 640, fps: { numerator: 30, denominator: 1 } },
    idempotencyKey: "project",
  });
  const draft = project.drafts[0]!;
  const timeline = await as.mutation(api.video.patchTimeline, {
    draftId: draft.draftId,
    expectedRevision: draft.timelineRevision,
    idempotencyKey: "duration",
    operations: [{ op: "replace", path: "/durationFrames", value: 60 }],
  });
  const saved = await as.mutation(api.video.checkpoint, {
    draftId: draft.draftId,
    expectedProjectRevision: project.revisionId,
    expectedScriptRevision: draft.scriptRevision,
    expectedTimelineRevision: timeline.revisionId,
    label: "Synthetic",
    idempotencyKey: "version",
  });
  const versionId = saved.version.versionId;
  const sha256 = "a".repeat(64);
  const jobId = await t.run(async (ctx) => {
    const refs = [];
    for (const [kind, mimeType] of [
      ["video", "video/mp4"],
      ["image", "image/png"],
      ["data", "text/vtt"],
    ] as const) {
      const assetId = await ctx.db.insert("assets", {
        scope: "workspace",
        workspaceId,
        slug: kind,
        name: kind,
        tags: [],
        kind,
        searchText: kind,
        createdBy: userId,
        updatedAt: 0,
      });
      const revisionId = await ctx.db.insert("assetVersions", {
        assetId,
        revision: 1,
        objectKey: `synthetic/${kind}`,
        contentHash: sha256,
        mimeType,
        size: 10,
        originalFilename: kind,
        sourceType: "upload",
        createdBy: userId,
      });
      refs.push({ assetId, revisionId });
    }
    return ctx.db.insert("videoJobs", {
      workspaceId,
      principalId: userId,
      projectId: project.projectId,
      versionId,
      idempotencyKey: "render",
      operationId: "render-operation",
      attemptNumber: 1,
      inputHash: sha256,
      request: JSON.stringify({ kind: "render", mode: "final", versionId }),
      kind: "render",
      state: "succeeded",
      fence: 1,
      createdAt: 0,
      updatedAt: 0,
      stage: "saved",
      result: JSON.stringify({
        kind: "render",
        versionId,
        video: refs[0],
        poster: refs[1],
        captions: refs[2],
        sha256,
        partial,
        metadata: {
          width: 360,
          height: 640,
          durationMs: 2000,
          fps: { numerator: 30, denominator: 1 },
        },
      }),
    });
  });
  return { t, as, userId, project, draft, versionId, jobId, sha256 };
}
test("human approval is exact and historical, never approval of the newer draft", async () => {
  const s = await setup();
  const args = {
    jobId: s.jobId,
    versionId: s.versionId,
    language: s.draft.language,
    sha256: s.sha256,
    confirmedViewed: true as const,
    idempotencyKey: "approve",
  };
  await expect(s.t.mutation(api.videoReview.approve, args)).rejects.toThrow();
  await expect(
    s.as.mutation(api.videoReview.approve, { ...args, sha256: "b".repeat(64) }),
  ).rejects.toThrow("VALIDATION_ERROR");
  const approved = await s.as.mutation(api.videoReview.approve, args);
  expect(await s.as.mutation(api.videoReview.approve, args)).toEqual(approved);
  await s.as.mutation(api.video.patchScript, {
    draftId: s.draft.draftId,
    expectedRevision: s.draft.scriptRevision,
    idempotencyKey: "edit",
    operations: [{ op: "replace", path: "/premise", value: "Changed" }],
  });
  expect(
    await s.as.mutation(api.videoReview.approve, { ...args, idempotencyKey: "new-approval" }),
  ).toEqual(approved);
  const historical = await s.as.query(api.videoReview.renderMetadata, { jobId: s.jobId });
  expect(historical.stale).toBe(true);
  expect(historical.approval?.sha256).toBe(s.sha256);
  expect(historical.versionId).toBe(s.versionId);
});
test("partial cannot be approved and out-of-range feedback cannot be posted", async () => {
  const s = await setup(true);
  await expect(
    s.as.mutation(api.videoReview.approve, {
      jobId: s.jobId,
      versionId: s.versionId,
      language: s.draft.language,
      sha256: s.sha256,
      confirmedViewed: true,
      idempotencyKey: "partial",
    }),
  ).rejects.toThrow("HUMAN_ACTION_REQUIRED");
  await expect(
    s.as.mutation(api.videoReview.addComment, {
      target: { kind: "render", jobId: s.jobId },
      body: { text: "Beyond", startMs: 3000 },
      idempotencyKey: "invalid",
    }),
  ).rejects.toThrow("VALIDATION_ERROR");
});
test("durable feedback CAS and agent completion never resolves or moves human note", async () => {
  const s = await setup();
  const target = { kind: "render" as const, jobId: s.jobId };
  const draft = {
    target,
    body: { text: "Keep this", startMs: 400 },
    expectedRevision: 0,
    idempotencyKey: "draft",
  };
  expect(await s.as.mutation(api.videoReview.saveDraft, draft)).toEqual({ revision: 1 });
  expect(await s.as.mutation(api.videoReview.saveDraft, draft)).toEqual({ revision: 1 });
  await expect(
    s.as.mutation(api.videoReview.saveDraft, {
      ...draft,
      idempotencyKey: "conflict",
      body: { text: "Other" },
    }),
  ).rejects.toThrow("REVISION_CONFLICT");
  expect((await s.as.query(api.videoReview.getDraft, { target })).body.text).toBe("Keep this");
  const note = await s.as.mutation(api.videoReview.addComment, {
    target,
    body: draft.body,
    idempotencyKey: "note",
  });
  const completed = await s.t.mutation(internal.videoReview.agentSetCommentStatus, {
    videoPrincipalId: s.userId,
    commentId: note.commentId,
    expectedRevision: 1,
    idempotencyKey: "complete",
    status: "completed",
    summary: "Adjusted",
  });
  expect(completed.status).toBe("completed");
  await expect(
    s.t.mutation(internal.videoReview.agentSetCommentStatus, {
      videoPrincipalId: s.userId,
      commentId: note.commentId,
      expectedRevision: 2,
      idempotencyKey: "resolve-agent",
      status: "resolved",
    }),
  ).rejects.toThrow("HUMAN_ACTION_REQUIRED");
  const reanchor = {
    commentId: note.commentId,
    expectedRevision: 2,
    target,
    body: { ...draft.body, startMs: 600 },
    reason: "Exact correction",
    idempotencyKey: "move",
  };
  await expect(
    s.t.mutation(internal.videoReview.agentReanchorComment, {
      ...reanchor,
      videoPrincipalId: s.userId,
    }),
  ).rejects.toThrow("HUMAN_ACTION_REQUIRED");
  await s.as.mutation(api.videoReview.reanchorComment, reanchor);
  const history = await s.as.query(api.videoReview.anchorHistory, {
    commentId: note.commentId,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(history.page[0]?.previousBody.startMs).toBe(400);
  expect(history.page[0]?.body.startMs).toBe(600);
});
test("posting one saved feedback revision is atomic and reload-safe across fresh operation keys", async () => {
  const s = await setup();
  const target = { kind: "render" as const, jobId: s.jobId };
  const body = { text: "Exactly once human note", startMs: 400 };
  await s.as.mutation(api.videoReview.saveDraft, {
    target,
    body,
    expectedRevision: 0,
    idempotencyKey: "save",
  });
  const first = await s.as.mutation(api.videoReview.addComment, {
    target,
    body,
    draftRevision: 1,
    idempotencyKey: "post",
  });
  const second = await s.as.mutation(api.videoReview.addComment, {
    target,
    body,
    draftRevision: 1,
    idempotencyKey: "double-click",
  });
  expect(second.commentId).toBe(first.commentId);
  expect((await s.as.query(api.videoReview.getDraft, { target })).postedCommentId).toBe(
    first.commentId,
  );
  const page = await s.as.query(api.videoReview.comments, {
    projectId: s.project.projectId,
    target,
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(page.page).toHaveLength(1);
});
