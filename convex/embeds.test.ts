/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedPublishedCanvas(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "owner@iota.uz",
      name: "Owner",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "workspace",
      name: "Workspace",
      createdBy: userId,
    });
    const canvasId = await ctx.db.insert("canvases", {
      workspaceId,
      slug: "flow",
      title: "Flow",
      kind: "canvas",
      visibility: "public",
      publicSlug: "public-flow",
      draftRevision: 3,
      draftEditCount: 1,
      draftUpdatedAt: 3,
      draftIframeEntrypoints: [],
      storageBytesUsed: 0,
      createdBy: userId,
      updatedAt: 3,
    });
    const publishedDocStorageId = await ctx.storage.store(
      new Blob([JSON.stringify({ marker: "published" })]),
    );
    const draftDocStorageId = await ctx.storage.store(
      new Blob([JSON.stringify({ marker: "draft" })]),
    );
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId,
      version: 6,
      createdBy: userId,
      docStorageId: publishedDocStorageId,
      iframeEntrypoints: [],
      publishedAt: 1,
    });
    await ctx.db.patch(canvasId, {
      currentVersionId: versionId,
      publishedVersionId: versionId,
      draftDocStorageId,
    });
    return { canvasId, versionId, publishedDocStorageId };
  });
}

describe("published embed context and cache", () => {
  test("uses immutable published storage and reports newer draft changes", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedPublishedCanvas(t);
    const context = await t.query(internal.embeds.resolvePublicContext, {
      publicSlug: "public-flow",
    });
    expect(context).toMatchObject({
      version: 6,
      versionId: seeded.versionId,
      docStorageId: seeded.publishedDocStorageId,
      unpublishedChanges: true,
    });
  });

  test("cache lookup is revoked immediately with the share slug", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedPublishedCanvas(t);
    await t.run((ctx) =>
      ctx.db.insert("canvasEmbeds", {
        canvasId: seeded.canvasId,
        versionId: seeded.versionId,
        cacheKey: "key",
        status: "ready",
        objectKey: "embeds/object.png",
        contentHash: "abc",
        size: 100,
        width: 10,
        height: 10,
        downscaled: false,
        renderStartedAt: 1,
        renderDurationMs: 50,
        createdAt: 1,
      }),
    );
    await expect(
      t.query(internal.embeds.getReady, {
        publicSlug: "public-flow",
        versionId: seeded.versionId,
        cacheKey: "key",
      }),
    ).resolves.toMatchObject({ objectKey: "embeds/object.png", contentHash: "abc" });

    await t.run((ctx) =>
      ctx.db.patch(seeded.canvasId, { visibility: "private", publicSlug: undefined }),
    );
    await expect(
      t.query(internal.embeds.getReady, {
        publicSlug: "public-flow",
        versionId: seeded.versionId,
        cacheKey: "key",
      }),
    ).resolves.toBeNull();
  });

  test("keeps a pinned published version while unpinned resolution advances", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedPublishedCanvas(t);
    const version7 = await t.run(async (ctx) => {
      const canvas = await ctx.db.get(seeded.canvasId);
      if (!canvas) throw new Error("missing canvas");
      const docStorageId = await ctx.storage.store(new Blob([JSON.stringify({ marker: "v7" })]));
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId: seeded.canvasId,
        version: 7,
        createdBy: canvas.createdBy,
        docStorageId,
        iframeEntrypoints: [],
        publishedAt: 2,
      });
      await ctx.db.patch(seeded.canvasId, {
        currentVersionId: versionId,
        publishedVersionId: versionId,
        draftEditCount: 0,
      });
      return { versionId, docStorageId };
    });

    await expect(
      t.query(internal.embeds.resolvePublicContext, { publicSlug: "public-flow", version: 6 }),
    ).resolves.toMatchObject({ version: 6, docStorageId: seeded.publishedDocStorageId });
    await expect(
      t.query(internal.embeds.resolvePublicContext, { publicSlug: "public-flow" }),
    ).resolves.toMatchObject({ version: 7, docStorageId: version7.docStorageId });
  });
});
