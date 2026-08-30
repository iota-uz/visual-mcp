/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seed(t: ReturnType<typeof convexTest>, published = true) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "owner@iota.uz",
      name: "Owner",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "osago",
      name: "Osago",
      createdBy: userId,
    });
    const canvasId = await ctx.db.insert("canvases", {
      workspaceId,
      slug: "screen",
      title: "Screen",
      kind: "canvas",
      visibility: published ? "public" : "private",
      publicSlug: published ? "public-screen" : undefined,
      draftRevision: 0,
      draftEditCount: 0,
      draftUpdatedAt: 0,
      draftIframeEntrypoints: [],
      storageBytesUsed: 0,
      createdBy: userId,
      updatedAt: 0,
    });
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId,
      version: 1,
      createdBy: userId,
      iframeEntrypoints: [],
      publishedAt: published ? 1 : undefined,
    });
    await ctx.db.patch(canvasId, {
      currentVersionId: versionId,
      publishedVersionId: published ? versionId : undefined,
    });
    return { workspaceId, canvasId, versionId };
  });
}

describe("component-driven static invalidation", () => {
  test("marks a directly dependent published canvas stale", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const component = await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "claim-card",
      name: "Claim card",
      contentHash: "v1",
      dependencyIds: [],
    });
    await t.mutation(internal.components.registerVersionUsages, {
      canvasId: seeded.canvasId,
      versionId: seeded.versionId,
      usages: [
        {
          entrypoint: "/src/screens/claim.html",
          workspaceSlug: "osago",
          componentSlug: "claim-card",
        },
      ],
    });
    const updated = await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "claim-card",
      name: "Claim card",
      contentHash: "v2",
      dependencyIds: [],
    });
    expect(updated).toMatchObject({
      componentId: component.componentId,
      generation: 2,
      affectedCanvases: 1,
    });
    await expect(t.run((ctx) => ctx.db.get(seeded.canvasId))).resolves.toMatchObject({
      staticRenderStatus: "stale",
    });
  });

  test("walks component dependencies transitively", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const base = await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "button",
      name: "Button",
      contentHash: "base-v1",
      dependencyIds: [],
    });
    const composed = await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "claim-card",
      name: "Claim card",
      contentHash: "card-v1",
      dependencyIds: [base.componentId],
    });
    await t.mutation(internal.components.registerVersionUsages, {
      canvasId: seeded.canvasId,
      versionId: seeded.versionId,
      usages: [
        {
          entrypoint: "/src/screens/claim.html",
          workspaceSlug: "osago",
          componentSlug: "claim-card",
        },
      ],
    });
    const updated = await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "button",
      name: "Button",
      contentHash: "base-v2",
      dependencyIds: [],
    });
    expect(updated.affectedCanvases).toBe(1);
    const parent = await t.run((ctx) => ctx.db.get(composed.componentId));
    expect(parent?.publishedGeneration).toBe(2);
  });

  test("does not fan out renders for an unpublished draft", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, false);
    await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "claim-card",
      name: "Claim card",
      contentHash: "v1",
      dependencyIds: [],
    });
    await t.mutation(internal.components.registerVersionUsages, {
      canvasId: seeded.canvasId,
      versionId: seeded.versionId,
      usages: [
        {
          entrypoint: "/src/screens/claim.html",
          workspaceSlug: "osago",
          componentSlug: "claim-card",
        },
      ],
    });
    const updated = await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "claim-card",
      name: "Claim card",
      contentHash: "v2",
      dependencyIds: [],
    });
    expect(updated.affectedCanvases).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(seeded.canvasId)))?.staticRenderStatus).toBeUndefined();
  });

  test("coalesces repeated publishes while static work is active", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const component = await t.mutation(internal.components.publish, {
      workspaceId: seeded.workspaceId,
      slug: "claim-card",
      name: "Claim card",
      contentHash: "v1",
      dependencyIds: [],
    });
    await t.mutation(internal.components.registerVersionUsages, {
      canvasId: seeded.canvasId,
      versionId: seeded.versionId,
      usages: [
        {
          entrypoint: "/src/screens/claim.html",
          workspaceSlug: "osago",
          componentSlug: "claim-card",
        },
      ],
    });
    const ids = await t.run(async (ctx) => ({
      embedId: await ctx.db.insert("canvasEmbeds", {
        canvasId: seeded.canvasId,
        versionId: seeded.versionId,
        cacheKey: "node-card",
        target: { type: "node", nodeId: "card" },
        clip: "frame",
        scale: 1,
        padding: 0,
        status: "updating",
        objectKey: "embeds/last-good.png",
        desiredGeneration: 1,
        completedGeneration: 1,
        attemptObjectKey: "embeds/attempt.png",
        workId: "active-embed-work",
        createdAt: 1,
        updatedAt: 1,
      }),
      recipeId: await ctx.db.insert("canvasRenderRecipes", {
        canvasId: seeded.canvasId,
        versionId: seeded.versionId,
        outputPath: "/output/card.png",
        entrypoint: "/src/screens/claim.html",
        format: "png",
        primary: true,
        status: "updating",
        desiredGeneration: 1,
        completedGeneration: 1,
        workId: "active-recipe-work",
        createdAt: 1,
        updatedAt: 1,
      }),
    }));

    for (const [contentHash, generation] of [
      ["v2", 2],
      ["v3", 3],
    ] as const) {
      const result = await t.mutation(internal.components.publish, {
        workspaceId: seeded.workspaceId,
        slug: "claim-card",
        name: "Claim card",
        contentHash,
        dependencyIds: [],
      });
      expect(result).toMatchObject({
        componentId: component.componentId,
        generation,
        queuedRenders: 0,
      });
    }

    const state = await t.run(async (ctx) => ({
      embed: await ctx.db.get(ids.embedId),
      recipe: await ctx.db.get(ids.recipeId),
    }));
    expect(state.embed).toMatchObject({
      status: "stale",
      desiredGeneration: 3,
      workId: "active-embed-work",
      objectKey: "embeds/last-good.png",
    });
    expect(state.recipe).toMatchObject({
      status: "stale",
      desiredGeneration: 3,
      workId: "active-recipe-work",
    });
  });
});
