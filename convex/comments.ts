/**
 * Canvas comments: the human → agent → human loop.
 *
 * A person pins a comment to a node or to a spot on a Page, an agent reads
 * the open ones over MCP, edits the canvas, and marks the comment
 * `completed` with a summary and the revision it landed in. Only a person
 * then marks it `resolved` — `completed` is the agent's claim, `resolved`
 * is the confirmation, and collapsing the two would let an agent close
 * feedback about its own work.
 *
 * Both doors (the SPA session and an MCP token) end up in the same helpers
 * below, so the lifecycle rules cannot drift between them; the callers
 * differ only in the `actorKind` they pass and in who authenticated them.
 */

import { describeCommentAnchor } from "@visual-canvas/canvas/comment-anchor.js";
import { VC_ID_PATTERN } from "@visual-canvas/canvas/vc-id.js";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireIotaIdentity, requireUserId } from "./lib/auth";

export const CommentStatusValidator = v.union(
  v.literal("open"),
  v.literal("completed"),
  v.literal("resolved"),
);
export type CommentStatus = "open" | "completed" | "resolved";

/** Which door the caller came through. Not a permission level by itself. */
export type ActorKind = "human" | "agent";

const ActorKindValidator = v.union(v.literal("human"), v.literal("agent"));
const PointValidator = v.object({ x: v.number(), y: v.number() });

/** Bounded so one runaway canvas cannot make every read unbounded. */
const MAX_COMMENTS_READ = 500;
const MAX_REPLIES_READ = 200;
const MAX_BODY = 4_000;

function requireBody(text: string, label: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${label} must not be empty.`);
  if (trimmed.length > MAX_BODY) {
    throw new Error(`${label} must be at most ${MAX_BODY} characters.`);
  }
  return trimmed;
}

async function loadCanvas(ctx: QueryCtx, canvasId: Id<"canvases">): Promise<Doc<"canvases">> {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas || canvas.archivedAt !== undefined) throw new Error(`Unknown canvas: ${canvasId}`);
  return canvas;
}

function shape(
  comment: Doc<"canvasComments">,
  replies: Doc<"canvasCommentReplies">[],
  nodeTitle?: string,
) {
  return {
    comment_id: comment._id as string,
    canvas_id: comment.canvasId as string,
    page_id: comment.pageId,
    node_id: comment.nodeId,
    node_title: nodeTitle,
    point: comment.point,
    local: comment.local,
    el: comment.el,
    role: comment.role,
    name: comment.name,
    where: describeCommentAnchor({
      nodeId: comment.nodeId,
      nodeTitle,
      local: comment.local,
      point: comment.point,
      el: comment.el,
      role: comment.role,
      name: comment.name,
    }),
    body: comment.body,
    status: comment.status,
    author_kind: comment.authorKind,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    completion: comment.completion
      ? {
          summary: comment.completion.summary,
          version: comment.completion.version,
          draft_revision: comment.completion.draftRevision,
          at: comment.completion.at,
        }
      : undefined,
    resolved_at: comment.resolvedAt,
    replies: replies.map((reply) => ({
      reply_id: reply._id as string,
      body: reply.body,
      author_kind: reply.authorKind,
      created_at: reply.createdAt,
    })),
  };
}
export type CommentThread = ReturnType<typeof shape>;

async function nodeTitlesFor(
  ctx: QueryCtx,
  canvasId: Id<"canvases">,
  comments: Doc<"canvasComments">[],
): Promise<Map<string, string>> {
  const needed = [
    ...new Set(
      comments
        .filter((comment) => comment.nodeId)
        .map((comment) => `${comment.pageId}:${comment.nodeId}`),
    ),
  ];
  if (needed.length === 0) return new Map();
  const rows = await ctx.db
    .query("canvasDraftNodes")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
    .take(1_001);
  const titles = new Map<string, string>();
  for (const row of rows) {
    if (row.entity !== "node") continue;
    titles.set(`${row.pageId}:${row.entityId}`, row.title);
  }
  return titles;
}

async function readThreads(
  ctx: QueryCtx,
  canvasId: Id<"canvases">,
  comments: Doc<"canvasComments">[],
): Promise<CommentThread[]> {
  const titles = await nodeTitlesFor(ctx, canvasId, comments);
  return await Promise.all(
    comments.map(async (comment) =>
      shape(
        comment,
        await ctx.db
          .query("canvasCommentReplies")
          .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
          .take(MAX_REPLIES_READ),
        comment.nodeId ? titles.get(`${comment.pageId}:${comment.nodeId}`) : undefined,
      ),
    ),
  );
}

interface ListArgs {
  canvasId: Id<"canvases">;
  pageId?: string;
  nodeId?: string;
  status?: CommentStatus | "all";
  limit?: number;
}

/**
 * Newest last, so a thread reads top to bottom. Status and anchor filtering
 * happens after the index read rather than through more indexes: a canvas's
 * comments are a short list, and the combinations an agent asks for
 * (page + status, node + status) would otherwise need one index each.
 */
async function listThreads(ctx: QueryCtx, args: ListArgs): Promise<CommentThread[]> {
  const rows = await ctx.db
    .query("canvasComments")
    .withIndex("by_canvas_created", (q) => q.eq("canvasId", args.canvasId))
    .take(MAX_COMMENTS_READ);
  const status = args.status ?? "all";
  const filtered = rows.filter(
    (row) =>
      (args.pageId === undefined || row.pageId === args.pageId) &&
      (args.nodeId === undefined || row.nodeId === args.nodeId) &&
      (status === "all" || row.status === status),
  );
  const limited = args.limit ? filtered.slice(0, args.limit) : filtered;
  return await readThreads(ctx, args.canvasId, limited);
}

async function countOpen(ctx: QueryCtx, canvasId: Id<"canvases">): Promise<number> {
  const open = await ctx.db
    .query("canvasComments")
    .withIndex("by_canvas_status", (q) => q.eq("canvasId", canvasId).eq("status", "open"))
    .take(MAX_COMMENTS_READ);
  return open.length;
}

const LocalValidator = v.object({ x: v.number(), y: v.number() });
const MAX_NAME = 120;
const MAX_ROLE = 40;

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return n > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, n));
}

function normalizeLocal(
  local: { x: number; y: number } | undefined,
): { x: number; y: number } | undefined {
  if (!local) return undefined;
  return {
    x: Math.round(clampUnit(local.x) * 10_000) / 10_000,
    y: Math.round(clampUnit(local.y) * 10_000) / 10_000,
  };
}

function normalizeEl(el: string | undefined): string | undefined {
  const trimmed = el?.trim();
  if (!trimmed) return undefined;
  if (!VC_ID_PATTERN.test(trimmed)) {
    throw new Error(`invalid_el: "${trimmed}" is not a data-vc-id (lowercase slug).`);
  }
  return trimmed;
}

function normalizeRole(role: string | undefined): string | undefined {
  const trimmed = role?.trim().toLowerCase();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_ROLE ? trimmed.slice(0, MAX_ROLE) : trimmed;
}

function normalizeName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_NAME ? trimmed.slice(0, MAX_NAME) : trimmed;
}

type CommentAnchor = {
  nodeId?: string;
  point?: { x: number; y: number };
  local?: { x: number; y: number };
  el?: string;
  role?: string;
  name?: string;
};

function resolveAnchor(args: CommentAnchor): CommentAnchor {
  if (args.nodeId) {
    return {
      nodeId: args.nodeId,
      point: undefined,
      local: normalizeLocal(args.local),
      el: normalizeEl(args.el),
      role: normalizeRole(args.role),
      name: normalizeName(args.name),
    };
  }
  return {
    nodeId: undefined,
    point: args.point,
    local: undefined,
    el: undefined,
    role: undefined,
    name: undefined,
  };
}

interface CreateArgs {
  canvasId: Id<"canvases">;
  pageId: string;
  nodeId?: string;
  point?: { x: number; y: number };
  local?: { x: number; y: number };
  el?: string;
  role?: string;
  name?: string;
  body: string;
  authorId: Id<"users">;
  authorKind: ActorKind;
}

/**
 * The node search index, which is a cache of the document rather than the
 * document itself. It is only written by the draft save path, so a canvas
 * whose last write was a checkpoint can legitimately have no rows at all —
 * and rejecting a real node id because the cache is cold would be worse
 * than accepting a typo. Hence: reject only when the index can positively
 * say this page has other nodes and not this one.
 */
async function nodeIsMissing(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  pageId: string,
  nodeId: string,
): Promise<boolean> {
  const indexed = await ctx.db
    .query("canvasDraftNodes")
    .withIndex("by_canvas", (q) => q.eq("canvasId", canvasId))
    .take(1_001);
  const onPage = indexed.filter((row) => row.pageId === pageId && row.entity === "node");
  if (onPage.length === 0) return false;
  return !onPage.some((row) => row.entityId === nodeId);
}

/**
 * `pageId` is trusted from the caller — both callers hold the resolved
 * CanvasFile when they ask, and re-reading the doc blob here would turn
 * every comment into a storage fetch. The MCP tool checks `nodeId` against
 * that file exactly; this is the backstop for the SPA path.
 */
async function createComment(ctx: MutationCtx, args: CreateArgs): Promise<CommentThread> {
  await loadCanvas(ctx, args.canvasId);
  const body = requireBody(args.body, "Comment body");
  if (args.nodeId && (await nodeIsMissing(ctx, args.canvasId, args.pageId, args.nodeId))) {
    throw new Error(
      `node_not_found: "${args.nodeId}" is not a node on page "${args.pageId}" of this canvas.`,
    );
  }
  const now = Date.now();
  const anchor = resolveAnchor(args);
  const id = await ctx.db.insert("canvasComments", {
    canvasId: args.canvasId,
    pageId: args.pageId,
    nodeId: anchor.nodeId,
    // A world point on a node would go stale the moment the node moved.
    // `el` is the control; `local` paints the pin and is the fallback.
    point: anchor.point,
    local: anchor.local,
    el: anchor.el,
    role: anchor.role,
    name: anchor.name,
    body,
    status: "open",
    authorId: args.authorId,
    authorKind: args.authorKind,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Comment insert did not land.");
  const titles = await nodeTitlesFor(ctx, args.canvasId, [created]);
  return shape(
    created,
    [],
    created.nodeId ? titles.get(`${created.pageId}:${created.nodeId}`) : undefined,
  );
}

async function reanchorComment(
  ctx: MutationCtx,
  args: {
    commentId: Id<"canvasComments">;
    nodeId?: string;
    point?: { x: number; y: number };
    local?: { x: number; y: number };
    el?: string;
    role?: string;
    name?: string;
  },
): Promise<CommentThread> {
  const comment = await loadComment(ctx, args.commentId);
  if (args.nodeId && (await nodeIsMissing(ctx, comment.canvasId, comment.pageId, args.nodeId))) {
    throw new Error(
      `node_not_found: "${args.nodeId}" is not a node on page "${comment.pageId}" of this canvas.`,
    );
  }
  if (!args.nodeId && !args.point) {
    throw new Error("reanchor_needs_target: pass a node_id (with optional local) or a page point.");
  }
  const anchor = resolveAnchor(args);
  await ctx.db.patch(comment._id, {
    nodeId: anchor.nodeId,
    point: anchor.point,
    local: anchor.local,
    el: anchor.el,
    role: anchor.role,
    name: anchor.name,
    updatedAt: Date.now(),
  });
  return presentThread(ctx, await loadComment(ctx, comment._id));
}

async function loadComment(
  ctx: QueryCtx,
  commentId: Id<"canvasComments">,
): Promise<Doc<"canvasComments">> {
  const comment = await ctx.db.get(commentId);
  if (!comment) throw new Error(`comment_not_found: ${commentId}`);
  return comment;
}

async function presentThread(
  ctx: QueryCtx,
  comment: Doc<"canvasComments">,
): Promise<CommentThread> {
  const titles = await nodeTitlesFor(ctx, comment.canvasId, [comment]);
  return shape(
    comment,
    await repliesOf(ctx, comment._id),
    comment.nodeId ? titles.get(`${comment.pageId}:${comment.nodeId}`) : undefined,
  );
}

async function addReply(
  ctx: MutationCtx,
  args: {
    commentId: Id<"canvasComments">;
    body: string;
    authorId: Id<"users">;
    authorKind: ActorKind;
  },
): Promise<CommentThread> {
  const comment = await loadComment(ctx, args.commentId);
  const body = requireBody(args.body, "Reply body");
  const now = Date.now();
  await ctx.db.insert("canvasCommentReplies", {
    commentId: comment._id,
    canvasId: comment.canvasId,
    body,
    authorId: args.authorId,
    authorKind: args.authorKind,
    createdAt: now,
  });
  await ctx.db.patch(comment._id, { updatedAt: now });
  return presentThread(ctx, await loadComment(ctx, comment._id));
}

/**
 * The agent's half of the loop. The version and draft revision are read
 * from the canvas row here rather than accepted as arguments: a caller
 * reporting which revision it edited is reporting what it believes, and the
 * point of the field is to let a person go and look.
 */
async function completeComment(
  ctx: MutationCtx,
  args: {
    commentId: Id<"canvasComments">;
    summary: string;
    actorId: Id<"users">;
  },
): Promise<CommentThread> {
  const comment = await loadComment(ctx, args.commentId);
  if (comment.status !== "open") {
    throw new Error(
      `comment_not_open: this comment is "${comment.status}". Reopen it before completing it again.`,
    );
  }
  const summary = requireBody(args.summary, "Completion summary");
  const canvas = await loadCanvas(ctx, comment.canvasId);
  // The checkpoint number a reader sees in the UI, plus the draft revision
  // that moves between checkpoints — together they name the exact state the
  // agent is claiming to have produced.
  const currentVersion = canvas.currentVersionId ? await ctx.db.get(canvas.currentVersionId) : null;
  const now = Date.now();
  await ctx.db.patch(comment._id, {
    status: "completed",
    completion: {
      summary,
      version: currentVersion?.version ?? 0,
      draftRevision: canvas.draftRevision,
      at: now,
      by: args.actorId,
    },
    resolvedAt: undefined,
    resolvedBy: undefined,
    updatedAt: now,
  });
  return presentThread(ctx, await loadComment(ctx, comment._id));
}

async function repliesOf(ctx: QueryCtx, commentId: Id<"canvasComments">) {
  return await ctx.db
    .query("canvasCommentReplies")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .take(MAX_REPLIES_READ);
}

/**
 * Confirming or reopening. The one rule that is not a state check: an agent
 * may resolve a note an agent wrote, and never a person's feedback. That is
 * the whole reason `completed` and `resolved` are separate states, so it is
 * enforced here rather than left to the tool descriptions.
 */
async function setCommentStatus(
  ctx: MutationCtx,
  args: {
    commentId: Id<"canvasComments">;
    status: "resolved" | "open";
    actorId: Id<"users">;
    actorKind: ActorKind;
  },
): Promise<CommentThread> {
  const comment = await loadComment(ctx, args.commentId);
  const now = Date.now();
  if (args.status === "resolved") {
    if (comment.status === "resolved") throw new Error("comment_already_resolved");
    if (args.actorKind === "agent" && comment.authorKind === "human") {
      throw new Error(
        "resolve_requires_human: an agent may mark a comment completed with a summary, " +
          "but only the person who asked can confirm it is resolved.",
      );
    }
    await ctx.db.patch(comment._id, {
      status: "resolved",
      resolvedAt: now,
      resolvedBy: args.actorId,
      updatedAt: now,
    });
  } else {
    if (comment.status === "open") throw new Error("comment_already_open");
    // The previous completion stays on the row: reopening says "not yet",
    // not "that never happened", and the summary is what the next attempt
    // has to improve on.
    await ctx.db.patch(comment._id, {
      status: "open",
      resolvedAt: undefined,
      resolvedBy: undefined,
      updatedAt: now,
    });
  }
  return presentThread(ctx, await loadComment(ctx, comment._id));
}

/* --- MCP-facing (the tool layer authenticates and passes the principal) --- */

export const create = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    pageId: v.string(),
    nodeId: v.optional(v.string()),
    point: v.optional(PointValidator),
    local: v.optional(LocalValidator),
    el: v.optional(v.string()),
    role: v.optional(v.string()),
    name: v.optional(v.string()),
    body: v.string(),
    authorId: v.id("users"),
    authorKind: ActorKindValidator,
  },
  handler: async (ctx, args) => createComment(ctx, args),
});

export const reanchor = internalMutation({
  args: {
    commentId: v.id("canvasComments"),
    nodeId: v.optional(v.string()),
    point: v.optional(PointValidator),
    local: v.optional(LocalValidator),
    el: v.optional(v.string()),
    role: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => reanchorComment(ctx, args),
});

export const list = internalQuery({
  args: {
    canvasId: v.id("canvases"),
    pageId: v.optional(v.string()),
    nodeId: v.optional(v.string()),
    status: v.optional(v.union(CommentStatusValidator, v.literal("all"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => listThreads(ctx, args),
});

/** String → Id, so the tool layer can answer a bad id with guidance. */
export const resolveId = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => ctx.db.normalizeId("canvasComments", args.id),
});

export const openCount = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => countOpen(ctx, args.canvasId),
});

export const reply = internalMutation({
  args: {
    commentId: v.id("canvasComments"),
    body: v.string(),
    authorId: v.id("users"),
    authorKind: ActorKindValidator,
  },
  handler: async (ctx, args) => addReply(ctx, args),
});

export const complete = internalMutation({
  args: {
    commentId: v.id("canvasComments"),
    summary: v.string(),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => completeComment(ctx, args),
});

export const setStatus = internalMutation({
  args: {
    commentId: v.id("canvasComments"),
    status: v.union(v.literal("resolved"), v.literal("open")),
    actorId: v.id("users"),
    actorKind: ActorKindValidator,
  },
  handler: async (ctx, args) => setCommentStatus(ctx, args),
});

/* --- SPA-facing. Comments are never anonymous: `/s/:slug` readers get
       none of this, which is why there is no public query here. --- */

export const listMine = query({
  args: {
    canvasId: v.id("canvases"),
    pageId: v.optional(v.string()),
    status: v.optional(v.union(CommentStatusValidator, v.literal("all"))),
  },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    return listThreads(ctx, args);
  },
});

export const createMine = mutation({
  args: {
    canvasId: v.id("canvases"),
    pageId: v.string(),
    nodeId: v.optional(v.string()),
    point: v.optional(PointValidator),
    local: v.optional(LocalValidator),
    el: v.optional(v.string()),
    role: v.optional(v.string()),
    name: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const authorId = await requireUserId(ctx, identity);
    return createComment(ctx, { ...args, authorId, authorKind: "human" });
  },
});

export const reanchorMine = mutation({
  args: {
    commentId: v.id("canvasComments"),
    nodeId: v.optional(v.string()),
    point: v.optional(PointValidator),
    local: v.optional(LocalValidator),
    el: v.optional(v.string()),
    role: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    await requireUserId(ctx, identity);
    return reanchorComment(ctx, args);
  },
});

export const replyMine = mutation({
  args: { commentId: v.id("canvasComments"), body: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const authorId = await requireUserId(ctx, identity);
    return addReply(ctx, { ...args, authorId, authorKind: "human" });
  },
});

export const setStatusMine = mutation({
  args: {
    commentId: v.id("canvasComments"),
    status: v.union(v.literal("resolved"), v.literal("open")),
  },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const actorId = await requireUserId(ctx, identity);
    return setCommentStatus(ctx, { ...args, actorId, actorKind: "human" });
  },
});

export const deleteMine = mutation({
  args: { commentId: v.id("canvasComments") },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    await requireUserId(ctx, identity);
    const comment = await loadComment(ctx, args.commentId);
    for (const reply of await repliesOf(ctx, comment._id)) await ctx.db.delete(reply._id);
    await ctx.db.delete(comment._id);
    return { deleted: true };
  },
});
