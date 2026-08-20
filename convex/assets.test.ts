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

  test("archive hides an asset and blocks new resolution while pinned bindings keep working", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        googleSub: "archive-user",
        email: "archive@iota.uz",
        name: "Archive",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "archive-ws",
        name: "Archive WS",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "bound",
        title: "Bound",
        kind: "canvas",
        visibility: "private",
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId });
      return { userId, workspaceId, canvasId, versionId };
    });
    const asset = await t.mutation(internal.assets.commitAssetVersion, {
      scope: "workspace",
      ownerUserId: seeded.userId,
      workspaceId: seeded.workspaceId,
      workspaceSlug: "archive-ws",
      slug: "logo",
      name: "Logo",
      tags: [],
      kind: "image",
      sourceObjectKey: "source/logo",
      deliveryObjectKey: "delivery/logo",
      previewObjectKey: "delivery/logo",
      contentHash: "logo-hash",
      mimeType: "image/png",
      size: 42,
      originalFilename: "logo.png",
      sourceType: "upload",
    });
    await t.run((ctx) =>
      ctx.db.insert("canvasVersionAssets", {
        canvasId: seeded.canvasId,
        versionId: seeded.versionId,
        logicalPath: "/assets/logo.png",
        assetId: asset.assetId,
        assetVersionId: asset.versionId,
      }),
    );
    const ref = "asset://workspace/archive-ws/logo@1";
    const archived = await t.mutation(internal.assets.archiveByRef, {
      assetRef: ref,
      userId: seeded.userId,
    });
    expect(archived).toMatchObject({ mode: "archived", reversible: true });
    expect(
      await t.query(internal.assets.listInternal, {
        userId: seeded.userId,
        scope: "workspace",
        workspaceSlug: "archive-ws",
        limit: 50,
      }),
    ).toHaveLength(0);
    await expect(
      t.query(internal.assets.resolveRef, { ref, userId: seeded.userId }),
    ).rejects.toThrow("Asset not found");
    const binding = await t.run((ctx) =>
      ctx.db
        .query("canvasVersionAssets")
        .withIndex("by_version_path", (q) =>
          q.eq("versionId", seeded.versionId).eq("logicalPath", "/assets/logo.png"),
        )
        .unique(),
    );
    expect(binding?.assetVersionId).toBe(asset.versionId);
    expect(await t.run((ctx) => ctx.db.get(asset.versionId))).not.toBeNull();

    const restored = await t.mutation(internal.assets.restoreByRef, {
      assetRef: ref,
      userId: seeded.userId,
    });
    expect(restored).toEqual({ assetRef: ref, mode: "restored" });
    expect(
      await t.query(internal.assets.listInternal, {
        userId: seeded.userId,
        scope: "workspace",
        workspaceSlug: "archive-ws",
        limit: 50,
      }),
    ).toHaveLength(1);
    expect(
      await t.query(internal.assets.resolveRef, { ref, userId: seeded.userId }),
    ).toMatchObject({ assetVersionId: asset.versionId, assetRef: ref });
    expect(
      await t.mutation(internal.assets.restoreByRef, {
        assetRef: ref,
        userId: seeded.userId,
      }),
    ).toEqual({ assetRef: ref, mode: "restored" });
  });

  test("moves personal to workspace and back without changing immutable versions", async () => {
    const t = convexTest(schema, modules);
    const { userId, workspaceId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        googleSub: "move-user",
        email: "move@iota.uz",
        name: "Move",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "move-ws",
        name: "Move WS",
        createdBy: userId,
      });
      return { userId, workspaceId };
    });
    const asset = await t.mutation(internal.assets.commitAssetVersion, {
      scope: "personal",
      ownerUserId: userId,
      slug: "mark",
      name: "Mark",
      tags: [],
      kind: "svg",
      sourceObjectKey: "source/mark",
      deliveryObjectKey: "delivery/mark",
      previewObjectKey: "delivery/mark",
      contentHash: "mark-hash",
      mimeType: "image/svg+xml",
      size: 9,
      originalFilename: "mark.svg",
      sourceType: "upload",
    });
    const personalRef = "asset://personal/mark@1";
    const intoWorkspace = await t.mutation(internal.assets.moveByRef, {
      assetRef: personalRef,
      userId,
      destinationScope: "workspace",
      destinationWorkspaceSlug: "move-ws",
    });
    expect(intoWorkspace).toEqual({
      previousAssetRef: personalRef,
      assetRef: "asset://workspace/move-ws/mark@1",
    });
    await expect(t.query(internal.assets.resolveRef, { ref: personalRef, userId })).rejects.toThrow(
      "Asset not found",
    );
    const resolved = await t.query(internal.assets.resolveRef, {
      ref: intoWorkspace.assetRef,
      userId,
    });
    expect(resolved.assetVersionId).toBe(asset.versionId);
    const back = await t.mutation(internal.assets.moveByRef, {
      assetRef: intoWorkspace.assetRef,
      userId,
      destinationScope: "personal",
    });
    expect(back.assetRef).toBe(personalRef);
    expect((await t.run((ctx) => ctx.db.get(asset.versionId)))?.deliveryObjectKey).toBe(
      "delivery/mark",
    );
    expect(workspaceId).toBeDefined();
  });

  test("refuses destination collisions and refs belonging to another user or workspace", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        googleSub: "owner",
        email: "owner@iota.uz",
        name: "Owner",
        lastSeenAt: 0,
      });
      const other = await ctx.db.insert("users", {
        googleSub: "other",
        email: "other@iota.uz",
        name: "Other",
        lastSeenAt: 0,
      });
      const workspace = await ctx.db.insert("workspaces", {
        slug: "one",
        name: "One",
        createdBy: owner,
      });
      await ctx.db.insert("workspaces", { slug: "two", name: "Two", createdBy: owner });
      return { owner, other, workspace };
    });
    const base = {
      slug: "logo",
      name: "Logo",
      tags: [],
      kind: "image" as const,
      sourceObjectKey: "source/logo",
      deliveryObjectKey: "delivery/logo",
      previewObjectKey: "delivery/logo",
      contentHash: "hash",
      mimeType: "image/png",
      size: 10,
      originalFilename: "logo.png",
      sourceType: "upload" as const,
    };
    await t.mutation(internal.assets.commitAssetVersion, {
      ...base,
      scope: "personal",
      ownerUserId: ids.owner,
    });
    await t.mutation(internal.assets.commitAssetVersion, {
      ...base,
      scope: "workspace",
      ownerUserId: ids.owner,
      workspaceId: ids.workspace,
      workspaceSlug: "one",
    });
    await expect(
      t.mutation(internal.assets.moveByRef, {
        assetRef: "asset://workspace/one/logo@1",
        userId: ids.owner,
        destinationScope: "personal",
      }),
    ).rejects.toThrow("already exists");
    await expect(
      t.mutation(internal.assets.archiveByRef, {
        assetRef: "asset://personal/logo@1",
        userId: ids.other,
      }),
    ).rejects.toThrow("Asset not found");
    await expect(
      t.mutation(internal.assets.restoreByRef, {
        assetRef: "asset://personal/logo@1",
        userId: ids.other,
      }),
    ).rejects.toThrow("Asset not found");
    await expect(
      t.mutation(internal.assets.restoreByRef, {
        assetRef: "asset://workspace/two/logo@1",
        userId: ids.owner,
      }),
    ).rejects.toThrow("Asset not found");
    await expect(
      t.mutation(internal.assets.archiveByRef, {
        assetRef: "asset://workspace/two/logo@1",
        userId: ids.owner,
      }),
    ).rejects.toThrow("Asset not found");
  });
});
