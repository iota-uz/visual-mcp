/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedCanvasWithNode(t: ReturnType<typeof convexTest>) {
  const createdBy = await t.run((ctx) =>
    ctx.db.insert("users", { email: "human@iota.uz", name: "Human", lastSeenAt: 0 }),
  );
  const { canvasId } = await t.mutation(internal.canvases.upsertByRef, {
    ref: "osago/claims",
    createdBy,
    kind: "canvas",
  });
  await t.run((ctx) =>
    ctx.db.insert("canvasDraftNodes", {
      canvasId,
      pageId: "overview",
      nodeId: "intake",
      title: "Intake",
      searchText: "Intake",
    }),
  );
  const asHuman = t.withIdentity({ subject: `${createdBy}|session-abc`, issuer: "convex" });
  return { canvasId, createdBy, asHuman };
}

/** The agent's door: the tool layer authenticates and passes its principal. */
async function agentUser(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ctx.db.insert("users", { email: "agent@iota.uz", name: "Agent", lastSeenAt: 0 }),
  );
}

describe("canvas comments", () => {
  test("a comment pins to the node id, never to a copy of its rect", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);

    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      nodeId: "intake",
      point: { x: 10, y: 20 },
      body: "  Make the CTA the primary action  ",
    });

    expect(thread.status).toBe("open");
    expect(thread.node_id).toBe("intake");
    expect(thread.author_kind).toBe("human");
    // Trimmed, and no point: a node comment travels with the node, so a
    // stored coordinate could only ever go stale.
    expect(thread.body).toBe("Make the CTA the primary action");
    expect(thread.point).toBeUndefined();
  });

  test("a comment on empty page space keeps its world point", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      point: { x: 640, y: 120 },
      body: "This whole lane needs a summary card",
    });
    expect(thread.point).toEqual({ x: 640, y: 120 });
    expect(thread.node_id).toBeUndefined();
  });

  test("a node id that is not on the page is refused", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    await expect(
      asHuman.mutation(api.comments.createMine, {
        canvasId,
        pageId: "overview",
        nodeId: "intakee",
        body: "typo'd anchor",
      }),
    ).rejects.toThrow(/node_not_found/);
  });

  test("an empty body is not a comment", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    await expect(
      asHuman.mutation(api.comments.createMine, { canvasId, pageId: "overview", body: "   " }),
    ).rejects.toThrow(/must not be empty/);
  });

  test("completing stamps the revision the agent actually edited", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      nodeId: "intake",
      body: "Make the CTA primary",
    });
    // A checkpoint and a couple of draft edits, so version and revision are
    // distinguishable numbers rather than both being zero.
    const docStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["{}"])));
    await t.mutation(internal.canvases.putDoc, {
      canvasId,
      docStorageId,
      createdBy: actorId,
      iframeEntrypoints: [],
      nodes: [],
    });

    const completed = await t.mutation(internal.comments.complete, {
      commentId: thread.comment_id as Id<"canvasComments">,
      summary: "Swapped the CTA to primary and moved it above the fold",
      actorId,
    });

    expect(completed.status).toBe("completed");
    expect(completed.completion?.summary).toMatch(/Swapped the CTA/);
    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    const current = canvas?.currentVersionId
      ? await t.run((ctx) => ctx.db.get(canvas.currentVersionId as Id<"canvasVersions">))
      : null;
    expect(completed.completion?.version).toBe(current?.version);
    expect(completed.completion?.draft_revision).toBe(canvas?.draftRevision);
  });

  test("completing without a summary is refused — the summary is the point", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      body: "Tighten the spacing",
    });
    await expect(
      t.mutation(internal.comments.complete, {
        commentId: thread.comment_id as Id<"canvasComments">,
        summary: "",
        actorId,
      }),
    ).rejects.toThrow(/must not be empty/);
    const still = await t.run((ctx) => ctx.db.get(thread.comment_id as Id<"canvasComments">));
    expect(still?.status).toBe("open");
  });

  test("an agent may complete a person's comment but never resolve it", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      body: "Rename the stage",
    });
    await t.mutation(internal.comments.complete, {
      commentId: thread.comment_id as Id<"canvasComments">,
      summary: "Renamed it to Intake",
      actorId,
    });

    await expect(
      t.mutation(internal.comments.setStatus, {
        commentId: thread.comment_id as Id<"canvasComments">,
        status: "resolved",
        actorId,
        actorKind: "agent",
      }),
    ).rejects.toThrow(/resolve_requires_human/);
  });

  test("an agent may resolve a note an agent left", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const thread = await t.mutation(internal.comments.create, {
      canvasId,
      pageId: "overview",
      body: "TODO: the payout lane still needs a decision node",
      authorId: actorId,
      authorKind: "agent",
    });

    const resolved = await t.mutation(internal.comments.setStatus, {
      commentId: thread.comment_id as Id<"canvasComments">,
      status: "resolved",
      actorId,
      actorKind: "agent",
    });
    expect(resolved.status).toBe("resolved");
  });

  test("the person confirms, and reopening keeps the summary that was rejected", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      body: "Rename the stage",
    });
    const commentId = thread.comment_id as Id<"canvasComments">;
    await t.mutation(internal.comments.complete, {
      commentId,
      summary: "Renamed it to Intake",
      actorId,
    });

    const resolved = await asHuman.mutation(api.comments.setStatusMine, {
      commentId,
      status: "resolved",
    });
    expect(resolved.status).toBe("resolved");

    const reopened = await asHuman.mutation(api.comments.setStatusMine, {
      commentId,
      status: "open",
    });
    expect(reopened.status).toBe("open");
    expect(reopened.resolved_at).toBeUndefined();
    // "Not yet", not "that never happened": the next attempt has to improve
    // on what the last one claimed.
    expect(reopened.completion?.summary).toBe("Renamed it to Intake");
  });

  test("completing a completed comment needs a reopen first", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      body: "Rename the stage",
    });
    const commentId = thread.comment_id as Id<"canvasComments">;
    await t.mutation(internal.comments.complete, { commentId, summary: "Renamed", actorId });
    await expect(
      t.mutation(internal.comments.complete, { commentId, summary: "Renamed again", actorId }),
    ).rejects.toThrow(/comment_not_open/);
  });

  test("replies stay in the thread and do not change its status", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      body: "Which lane should this sit in?",
    });
    const commentId = thread.comment_id as Id<"canvasComments">;
    await t.mutation(internal.comments.reply, {
      commentId,
      body: "The automation lane — it is a system step.",
      authorId: actorId,
      authorKind: "agent",
    });
    const withHumanReply = await asHuman.mutation(api.comments.replyMine, {
      commentId,
      body: "Agreed.",
    });

    expect(withHumanReply.status).toBe("open");
    expect(withHumanReply.replies.map((reply) => reply.author_kind)).toEqual(["agent", "human"]);
    expect(withHumanReply.updated_at).toBeGreaterThanOrEqual(thread.created_at);
  });

  test("listing filters by page, node and status, and counts what is open", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const actorId = await agentUser(t);
    const onNode = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      nodeId: "intake",
      body: "On the node",
    });
    await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      point: { x: 1, y: 2 },
      body: "On the page",
    });
    await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "second",
      point: { x: 1, y: 2 },
      body: "On another page",
    });
    await t.mutation(internal.comments.complete, {
      commentId: onNode.comment_id as Id<"canvasComments">,
      summary: "Done",
      actorId,
    });

    const openOnOverview = await t.query(internal.comments.list, {
      canvasId,
      pageId: "overview",
      status: "open",
    });
    expect(openOnOverview.map((thread) => thread.body)).toEqual(["On the page"]);

    const onIntake = await t.query(internal.comments.list, {
      canvasId,
      nodeId: "intake",
      status: "all",
    });
    expect(onIntake).toHaveLength(1);
    expect(onIntake[0]?.status).toBe("completed");

    expect(await t.query(internal.comments.openCount, { canvasId })).toBe(2);
  });

  test("comments are never anonymous: every entry point needs a session", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      body: "Signed-in only",
    });
    const commentId = thread.comment_id as Id<"canvasComments">;

    await expect(t.query(api.comments.listMine, { canvasId })).rejects.toThrow(/Not signed in/);
    await expect(
      t.mutation(api.comments.createMine, { canvasId, pageId: "overview", body: "anon" }),
    ).rejects.toThrow(/Not signed in/);
    await expect(t.mutation(api.comments.replyMine, { commentId, body: "anon" })).rejects.toThrow(
      /Not signed in/,
    );
    await expect(
      t.mutation(api.comments.setStatusMine, { commentId, status: "resolved" }),
    ).rejects.toThrow(/Not signed in/);
    await expect(t.mutation(api.comments.deleteMine, { commentId })).rejects.toThrow(
      /Not signed in/,
    );
  });

  test("a comment on a node that was deleted keeps its thread", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      nodeId: "intake",
      body: "About the node that is about to go",
    });
    await t.run(async (ctx) => {
      const node = await ctx.db
        .query("canvasDraftNodes")
        .withIndex("by_canvas_page_node", (q) =>
          q.eq("canvasId", canvasId).eq("pageId", "overview").eq("nodeId", "intake"),
        )
        .unique();
      if (node) await ctx.db.delete(node._id);
    });

    // Deleting the node must not delete the conversation about it; the
    // reader shows it as an orphan instead, and the anchor is still on the
    // row if the node comes back through an undo.
    const [still] = await t.query(internal.comments.list, { canvasId, status: "all" });
    expect(still?.node_id).toBe("intake");
    expect(still?.comment_id).toBe(thread.comment_id);
  });

  test("purging a canvas takes its comments and replies with it", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asHuman } = await seedCanvasWithNode(t);
    const thread = await asHuman.mutation(api.comments.createMine, {
      canvasId,
      pageId: "overview",
      body: "Goes away with the canvas",
    });
    await asHuman.mutation(api.comments.replyMine, {
      commentId: thread.comment_id as Id<"canvasComments">,
      body: "So does this",
    });

    await t.mutation(internal.canvases.removeByRef, {
      ref: "osago/claims",
      target: "canvas",
      purge: true,
    });

    expect(await t.run((ctx) => ctx.db.query("canvasComments").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("canvasCommentReplies").collect())).toHaveLength(0);
  });
});
