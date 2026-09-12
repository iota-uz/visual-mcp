/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const VALID_IDENTITY = { subject: "test-user|session-abc", issuer: "convex" };

test("needsYou lists completed canvas comments and awaiting video loops", async () => {
  const t = convexTest(schema, modules);
  const asMember = t.withIdentity(VALID_IDENTITY);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "test@iota.uz",
      name: "Test",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "osago",
      name: "OSAGO",
      createdBy: userId,
    });
    const canvasId = await ctx.db.insert("canvases", {
      workspaceId,
      slug: "claims",
      title: "Claims map",
      kind: "canvas",
      visibility: "private",
      draftRevision: 0,
      draftEditCount: 0,
      draftUpdatedAt: Date.now(),
      draftIframeEntrypoints: [],
      storageBytesUsed: 0,
      updatedAt: Date.now(),
      createdBy: userId,
    });
    await ctx.db.insert("canvasComments", {
      canvasId,
      pageId: "home",
      body: "Fix the CTA",
      status: "completed",
      authorId: userId,
      authorKind: "human",
      completion: {
        summary: "Swapped the CTA",
        version: 1,
        draftRevision: 1,
        at: Date.now(),
        by: userId,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const projectId = await ctx.db.insert("videoProjects", {
      workspaceId,
      title: "Farq reel",
      brief: JSON.stringify({ topic: "osago", direction: "clear" }),
      format: JSON.stringify({
        width: 1080,
        height: 1920,
        fps: { numerator: 30, denominator: 1 },
      }),
      revisionId: "rev",
      createdBy: userId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("videoLoops", {
      workspaceId,
      projectId,
      language: "ru",
      revisionId: "loop",
      state: "awaiting_human",
      iteration: 1,
      noProgress: 0,
      iterationLimit: 3,
      noProgressLimit: 2,
      baseline: null,
      selectedCandidate: null,
      pendingProposalId: null,
      stopReason: null,
      evaluation: null,
      humanInputRevision: 0,
      pausedByHuman: false,
    });
    return canvasId as Id<"canvases">;
  });

  const inbox = await asMember.query(api.inbox.needsYou, {});
  expect(inbox.count).toBe(2);
  expect(inbox.items.map((item) => item.kind).sort()).toEqual(["comment", "loop"]);
  expect(inbox.items.find((item) => item.kind === "comment")?.href).toContain("comments=1");
  expect(inbox.items.find((item) => item.kind === "loop")?.href).toContain("production=1");
});
