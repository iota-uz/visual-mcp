import { expect, test, vi } from "vitest";
import { callVideoTool, VideoDomainError } from "../src/video/registry.js";

const row = {
  _id: "comment",
  projectId: "project",
  language: "ru",
  target: { kind: "render", jobId: "render" },
  body: { text: "Title overlaps", startMs: 10, endMs: 20 },
  authorId: "human",
  authorKind: "human",
  status: "open",
  revision: 2,
  createdAt: 0,
  workspaceId: "workspace",
};
test("video feedback reader preserves human authorship and exact immutable target", async () => {
  const result = await callVideoTool(
    "video_comment_get",
    { comment_id: "comment" },
    async () => row,
  );
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: {
      comment_id: "comment",
      workspace_id: "workspace",
      author_kind: "human",
      revision: 2,
      target: { kind: "render", jobId: "render" },
      completion: null,
    },
  });
});
test("comment CAS conflict steers to current comment read, never approval", async () => {
  const result = await callVideoTool(
    "video_comment_status",
    {
      comment_id: "comment",
      expected_revision: 1,
      idempotency_key: "key",
      status: "completed",
      summary: "Moved title",
    },
    async () => {
      throw new VideoDomainError("REVISION_CONFLICT", "Comment changed");
    },
  );
  expect(result.structuredContent).toMatchObject({
    ok: false,
    error: {
      recovery: {
        kind: "refresh_then_recompute",
        read: { tool: "video_comment_get", arguments: { comment_id: "comment" } },
      },
    },
  });
});
test("comment list cursor binds target and project filters", async () => {
  const call = Object.assign(
    vi.fn(async () => ({ page: [row, row], isDone: true, continueCursor: "" })),
    { snapshotPrincipal: "test" },
  );
  const result = await callVideoTool(
    "video_comment_list",
    { project_id: "project", limit: 1 },
    call,
  );
  const data = (result.structuredContent as { data: { next_cursor: string } }).data;
  const changed = await callVideoTool(
    "video_comment_list",
    { project_id: "other", limit: 1, cursor: data.next_cursor },
    call,
  );
  expect(changed.structuredContent).toMatchObject({
    ok: false,
    error: { code: "CURSOR_MISMATCH" },
  });
  expect(call).toHaveBeenCalledTimes(1);
});
