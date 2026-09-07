/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ENV = { url: process.env.WORKER_URL, token: process.env.WORKER_TOKEN };
beforeEach(() => {
  delete process.env.WORKER_URL;
  delete process.env.WORKER_TOKEN;
});
afterEach(() => {
  if (ENV.url !== undefined) process.env.WORKER_URL = ENV.url;
  if (ENV.token !== undefined) process.env.WORKER_TOKEN = ENV.token;
});

const pageDoc = {
  version: 2,
  title: "Export me",
  world: { width: 800, height: 600 },
  lanes: [],
  stages: [],
  labels: [],
  nodes: [
    {
      id: "hero",
      kind: "native",
      shape: "card",
      rect: { x: 10, y: 20, w: 100, h: 80 },
      caption: { title: "Hero" },
      anchors: [],
    },
  ],
  groups: [],
  edges: [],
};
const file = {
  version: 3,
  defaultPageId: "overview",
  pages: [
    { id: "overview", title: "Overview", order: 0, doc: pageDoc },
    { id: "details", title: "Details", order: 1, doc: { ...pageDoc, title: "Details" } },
  ],
  prototype: { interactions: [] },
};

async function seed(t: ReturnType<typeof convexTest>) {
  const createdBy = await t.run((ctx) =>
    ctx.db.insert("users", { email: "person@iota.uz", name: "Person", lastSeenAt: 0 }),
  );
  const created = await t.mutation(internal.canvases.upsertByRef, {
    ref: "exports/flow",
    createdBy,
    kind: "canvas",
  });
  await t.mutation(internal.canvases.putDoc, {
    iframeEntrypoints: [],
    canvasId: created.canvasId,
    docStorageId: await t.run((ctx) =>
      ctx.storage.store(new Blob([JSON.stringify(file)], { type: "application/json" })),
    ),
    createdBy,
    nodes: [],
  });
  const subject = `${createdBy}|session-abc`;
  return {
    canvasId: created.canvasId,
    subject,
    asMember: t.withIdentity({ subject, issuer: "convex" }),
  };
}

const baseArgs = { clip: "frame" as const, scale: 1 as const, format: "png" as const };

describe("exports.requestMine", () => {
  test("requires a signed-in user", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seed(t);
    await expect(
      t.action(api.exports.requestMine, { canvasId, target: "canvas", ...baseArgs }),
    ).rejects.toThrow(/not signed in/i);
  });

  test("validates the target before touching the worker", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asMember } = await seed(t);
    await expect(
      asMember.action(api.exports.requestMine, { canvasId, target: "node", ...baseArgs }),
    ).rejects.toThrow("nodeId is required for target=node");
    await expect(
      asMember.action(api.exports.requestMine, {
        canvasId,
        target: "node",
        nodeId: "hero",
        ...baseArgs,
        clip: "content",
      }),
    ).rejects.toThrow("clip=content requires an iframe or image node");
    await expect(
      asMember.action(api.exports.requestMine, {
        canvasId,
        target: "canvas",
        pageId: "missing",
        ...baseArgs,
      }),
    ).rejects.toThrow("Unknown canvas page: missing");
    await expect(
      asMember.action(api.exports.requestMine, {
        canvasId,
        target: "node",
        nodeId: "ghost",
        ...baseArgs,
      }),
    ).rejects.toThrow("Unknown canvas node: ghost");
  });

  test("reports the missing worker with one exact message", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, asMember } = await seed(t);
    await expect(
      asMember.action(api.exports.requestMine, { canvasId, target: "canvas", ...baseArgs }),
    ).rejects.toThrow("render worker is not configured");
    await expect(
      asMember.action(api.exports.requestMine, {
        canvasId,
        target: "canvas",
        ...baseArgs,
        format: "pdf",
      }),
    ).rejects.toThrow("render worker is not configured");
  });

  test("serves a cached export for the same draft revision without a worker", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, subject, asMember } = await seed(t);
    const context = await t.query(internal.exports.contextMine, { canvasId, subject });
    const cacheKey = await sha256Hex(
      JSON.stringify({
        renderer: 1,
        draftRevision: context.draftRevision,
        pageIds: ["overview"],
        target: { type: "canvas" },
        clip: "frame",
        scale: 1,
        format: "png",
        theme: context.theme,
      }),
    );
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["png-bytes"], { type: "image/png" })),
    );
    await t.mutation(internal.exports.remember, {
      canvasId,
      draftRevision: context.draftRevision,
      cacheKey,
      storageId,
      mimeType: "image/png",
      size: 9,
      filename: "flow-overview.png",
    });

    const result = await asMember.action(api.exports.requestMine, {
      canvasId,
      target: "canvas",
      pageId: "overview",
      ...baseArgs,
    });
    expect(result).toMatchObject({
      status: "ok",
      cached: true,
      filename: "flow-overview.png",
      mimeType: "image/png",
      warnings: [],
    });
    expect(result.url).toEqual(expect.any(String));

    // A different scale is a different picture: no hit, so the worker is needed.
    await expect(
      asMember.action(api.exports.requestMine, {
        canvasId,
        target: "canvas",
        pageId: "overview",
        ...baseArgs,
        scale: 2,
      }),
    ).rejects.toThrow("render worker is not configured");
  });

  test("remember keeps the first blob when two identical renders race", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seed(t);
    const first = await t.run((ctx) => ctx.storage.store(new Blob(["a"])));
    const second = await t.run((ctx) => ctx.storage.store(new Blob(["b"])));
    const args = {
      canvasId,
      draftRevision: 0,
      cacheKey: "same",
      mimeType: "image/png" as const,
      size: 1,
      filename: "flow-overview.png",
    };
    expect(await t.mutation(internal.exports.remember, { ...args, storageId: first })).toBe(first);
    expect(await t.mutation(internal.exports.remember, { ...args, storageId: second })).toBe(first);
    const rows = await t.run((ctx) => ctx.db.query("canvasExports").collect());
    expect(rows).toHaveLength(1);
    expect(await t.run(async (ctx) => (await ctx.storage.get(second)) !== null)).toBe(false);
  });
});

describe("exports.sweep", () => {
  test("drops exports past the TTL, row and blob together", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seed(t);
    const [stale, fresh] = await t.run(async (ctx) => {
      const staleId = await ctx.storage.store(new Blob(["stale"]));
      const freshId = await ctx.storage.store(new Blob(["fresh"]));
      const row = {
        canvasId,
        draftRevision: 0,
        mimeType: "image/png" as const,
        size: 5,
        filename: "x.png",
      };
      await ctx.db.insert("canvasExports", {
        ...row,
        cacheKey: "stale",
        storageId: staleId,
        createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      });
      await ctx.db.insert("canvasExports", {
        ...row,
        cacheKey: "fresh",
        storageId: freshId,
        createdAt: Date.now(),
      });
      return [staleId, freshId] as Id<"_storage">[];
    });
    expect(await t.mutation(internal.exports.sweep, {})).toEqual({
      deleted: 1,
      truncated: false,
    });
    const rows = await t.run((ctx) => ctx.db.query("canvasExports").collect());
    expect(rows.map((row) => row.cacheKey)).toEqual(["fresh"]);
    expect(await t.run(async (ctx) => (await ctx.storage.get(stale)) !== null)).toBe(false);
    expect(await t.run(async (ctx) => (await ctx.storage.get(fresh)) !== null)).toBe(true);
  });
});
