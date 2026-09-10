import { Language } from "@visual-canvas/video";
import { z } from "zod";
import { continuation, type Definition, pageResult, snapshotQuery } from "./registry.js";

const id = z.string().min(1).max(200);
const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("render"), jobId: id }).strict(),
  z
    .object({ kind: z.literal("script"), draftId: id, revisionId: id, sceneId: id.optional() })
    .strict(),
  z
    .object({ kind: z.literal("timeline"), draftId: id, revisionId: id, clipId: id.optional() })
    .strict(),
]);
const body = z
  .object({
    text: z.string().min(1).max(16000),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().positive().optional(),
    region: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .strict()
      .optional(),
  })
  .strict();
const status = z.enum(["open", "completed", "resolved"]),
  write = { comment_id: id, expected_revision: z.number().int().positive(), idempotency_key: id };
const page = {
  cursor: z.string().max(16000).optional(),
  limit: z.number().int().min(1).max(100).default(20),
};
const obj = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
const comment = z
  .object({
    comment_id: id,
    project_id: id,
    language: Language,
    target,
    body,
    author_id: id,
    author_kind: z.enum(["human", "agent"]),
    status,
    revision: z.number(),
    created_at: z.string(),
    completion: z
      .object({ summary: z.string(), resultTarget: target.optional(), at: z.number() })
      .strict()
      .nullable(),
  })
  .strict();
function present(raw: unknown) {
  const row = obj(raw);
  return {
    comment_id: row._id,
    project_id: row.projectId,
    language: row.language,
    target: row.target,
    body: row.body,
    author_id: row.authorId,
    author_kind: row.authorKind,
    status: row.status,
    revision: row.revision,
    created_at: new Date(z.number().parse(row.createdAt)).toISOString(),
    completion: row.completion ?? null,
  };
}
const changed = z
  .object({ comment_id: id, revision: z.number(), status: status.optional() })
  .strict();
function result(raw: unknown) {
  const row = obj(raw);
  return {
    comment_id: row.commentId,
    revision: row.revision,
    ...(row.status ? { status: row.status } : {}),
  };
}
export const reviewDefinitions: Definition[] = [
  {
    name: "video_comment_create",
    readOnly: false,
    description:
      "Leave an agent-labeled comment on an exact script/timeline revision or registered render. Render time/region anchors refer to its actual media. Does not impersonate human feedback or approve a result. Old targets stay pinned after later edits.",
    input: z.object({ target, body, idempotency_key: id }).strict(),
    output: changed,
    run: async (i, call) =>
      result(
        await call("createComment", {
          target: i.target,
          body: i.body,
          idempotencyKey: i.idempotency_key,
        }),
      ),
  },
  {
    name: "video_comment_get",
    readOnly: true,
    description:
      "Read one current comment and revision before replying, changing status or reanchoring. Human versus agent authorship and exact target remain explicit. Use video_comment_replies for bounded thread history.",
    input: z.object({ comment_id: id }).strict(),
    output: comment.extend({ workspace_id: id }),
    run: async (i, call) => {
      const row = obj(await call("getVideoComment", { commentId: i.comment_id }));
      return { ...present(row), workspace_id: row.workspaceId };
    },
  },
  {
    name: "video_comment_list",
    readOnly: true,
    description:
      "Read frozen project feedback, optionally for one exact target. All statuses are returned; completed is an agent report, not human verification. Snapshot cap100/4MiB; narrow target if exceeded. Keep filters/page size; restart on snapshot expiry.",
    input: z.object({ project_id: id, target: target.optional(), ...page }).strict(),
    output: z
      .object({
        items: z.array(comment),
        complete: z.boolean(),
        next_cursor: z.string().nullable(),
      })
      .strict(),
    run: async (i, call) =>
      pageResult(
        await snapshotQuery(
          call,
          "listComments",
          {
            projectId: i.project_id,
            ...(i.target ? { target: i.target } : {}),
            paginationOpts: { numItems: i.limit, cursor: continuation(i, "video_comment_list") },
          },
          i,
          "video_comment_list",
        ),
        present,
        i,
        "video_comment_list",
      ),
  },
  {
    name: "video_comment_status",
    readOnly: false,
    description:
      "Change a comment status with CAS. completed records agent work and optional exact resultTarget; it is not approval. Agents cannot resolve/reopen human-authored feedback as the human. Read the current revision after conflicts, never overwrite silently.",
    input: z
      .object({
        ...write,
        status,
        summary: z.string().max(16000).optional(),
        result_target: target.optional(),
      })
      .strict(),
    output: changed,
    run: async (i, call) =>
      result(
        await call("setCommentStatus", {
          commentId: i.comment_id,
          expectedRevision: i.expected_revision,
          idempotencyKey: i.idempotency_key,
          status: i.status,
          ...(i.summary ? { summary: i.summary } : {}),
          ...(i.result_target ? { resultTarget: i.result_target } : {}),
        }),
      ),
  },
  {
    name: "video_comment_reanchor",
    readOnly: false,
    description:
      "Move an agent-owned comment to an exact new target with updated time/region anchors, a reason and current revision. Preserve body.text exactly; reanchor cannot rewrite the original note or move a human note. Previous anchor history is retained.",
    input: z.object({ ...write, target, body, reason: z.string().min(1).max(2000) }).strict(),
    output: changed,
    run: async (i, call) =>
      result(
        await call("reanchorComment", {
          commentId: i.comment_id,
          expectedRevision: i.expected_revision,
          idempotencyKey: i.idempotency_key,
          target: i.target,
          body: i.body,
          reason: i.reason,
        }),
      ),
  },
  {
    name: "video_comment_reply",
    readOnly: false,
    description:
      "Append an agent-labeled reply without changing the original feedback or inventing a human decision. Reuse the same idempotency key for transport recovery.",
    input: z
      .object({ comment_id: id, body: z.string().min(1).max(16000), idempotency_key: id })
      .strict(),
    output: z.object({ reply_id: id }).strict(),
    run: async (i, call) => ({
      reply_id: obj(
        await call("addReply", {
          commentId: i.comment_id,
          body: i.body,
          idempotencyKey: i.idempotency_key,
        }),
      ).replyId,
    }),
  },
  {
    name: "video_comment_replies",
    readOnly: true,
    description:
      "Read bounded newest-first replies for one comment. Separate human and agent authorship; follow cursor for older replies rather than assuming a truncated thread is complete.",
    input: z.object({ comment_id: id, ...page }).strict(),
    output: z
      .object({
        items: z.array(
          z
            .object({
              reply_id: id,
              comment_id: id,
              body: z.string(),
              author_id: id,
              author_kind: z.enum(["human", "agent"]),
              created_at: z.string(),
            })
            .strict(),
        ),
        complete: z.boolean(),
        next_cursor: z.string().nullable(),
      })
      .strict(),
    run: async (i, call) =>
      pageResult(
        await snapshotQuery(
          call,
          "getVideoCommentReplies",
          {
            commentId: i.comment_id,
            paginationOpts: { numItems: i.limit, cursor: continuation(i, "video_comment_replies") },
          },
          i,
          "video_comment_replies",
        ),
        (value) => {
          const row = obj(value);
          return {
            reply_id: row._id,
            comment_id: row.commentId,
            body: row.body,
            author_id: row.authorId,
            author_kind: row.authorKind,
            created_at: new Date(z.number().parse(row.createdAt)).toISOString(),
          };
        },
        i,
        "video_comment_replies",
      ),
  },
];
