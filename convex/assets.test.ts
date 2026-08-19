/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("Asset Library bindings", () => {
  test("pins an immutable asset revision into a new canvas snapshot", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        googleSub: "asset-test",
        email: "asset@iota.uz",
        name: "Asset",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "osago",
        name: "OSAGO",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "flow",
        title: "Flow",
        kind: "canvas",
        visibility: "private",
        createdBy: userId,
        updatedAt: 0,
      });
      const docStorageId = await ctx.storage.store(new Blob(["{}"], { type: "application/json" }));
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
        docStorageId,
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId });
      return { userId, workspaceId, canvasId };
    });
    const asset = await t.mutation(internal.assets.commitAssetVersion, {
      scope: "workspace",
      ownerUserId: seeded.userId,
      workspaceId: seeded.workspaceId,
      workspaceSlug: "osago",
      slug: "logo",
      name: "Logo",
      tags: ["brand"],
      kind: "svg",
      sourceObjectKey: "blobs/source",
      deliveryObjectKey: "blobs/delivery",
      previewObjectKey: "blobs/delivery",
      contentHash: "hash",
      mimeType: "image/svg+xml",
      size: 123,
      originalFilename: "logo.svg",
      sourceType: "upload",
    });
    const bound = await t.mutation(internal.canvases.bindAssetAndVersion, {
      canvasId: seeded.canvasId,
      logicalPath: "/assets/logo.svg",
      assetId: asset.assetId,
      assetVersionId: asset.versionId,
      expectedVersion: 1,
      createdBy: seeded.userId,
    });
    expect(bound.version).toBe(2);
    const snapshot = await t.run((ctx) =>
      ctx.db
        .query("canvasVersionAssets")
        .withIndex("by_version_path", (q) =>
          q.eq("versionId", bound.versionId).eq("logicalPath", "/assets/logo.svg"),
        )
        .unique(),
    );
    expect(snapshot?.assetVersionId).toBe(asset.versionId);
  });
});
