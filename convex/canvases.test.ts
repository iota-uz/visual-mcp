/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      googleSub: "bootstrap:test@iota.uz",
      email: "test@iota.uz",
      name: "Test User",
      lastSeenAt: 0,
    }),
  );
}

async function seedWorkspace(
  t: ReturnType<typeof convexTest>,
  createdBy: Id<"users">,
  name = "Workspace",
): Promise<Id<"workspaces">> {
  const { workspaceId } = await t.mutation(internal.workspaces.create, { name, createdBy });
  return workspaceId;
}

async function seedStorage(
  t: ReturnType<typeof convexTest>,
  contents = "x",
): Promise<Id<"_storage">> {
  return t.run((ctx) => ctx.storage.store(new Blob([contents], { type: "text/plain" })));
}

describe("canvases.create", () => {
  test("appends -2 on slug collision within the same workspace", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);

    const first = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Checkout Flow",
      kind: "html",
      createdBy,
    });
    const second = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Checkout Flow",
      kind: "html",
      createdBy,
    });

    expect(first.slug).toBe("checkout-flow");
    expect(second.slug).toBe("checkout-flow-2");
  });

  test("the same title in a different workspace does not collide", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const ws1 = await seedWorkspace(t, createdBy, "WS1");
    const ws2 = await seedWorkspace(t, createdBy, "WS2");

    const a = await t.mutation(internal.canvases.create, {
      workspaceId: ws1,
      title: "Diagram",
      kind: "canvas",
      createdBy,
    });
    const b = await t.mutation(internal.canvases.create, {
      workspaceId: ws2,
      title: "Diagram",
      kind: "canvas",
      createdBy,
    });

    expect(a.slug).toBe("diagram");
    expect(b.slug).toBe("diagram");
  });
});

describe("canvases.publish", () => {
  async function seedCanvas(t: ReturnType<typeof convexTest>) {
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Share Me",
      kind: "html",
      createdBy,
    });
    return canvasId;
  }

  test("requires newPublicSlug on the first publish", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);
    await expect(
      t.mutation(internal.canvases.publish, { canvasId, visibility: "public" }),
    ).rejects.toThrow(/newPublicSlug is required/);
  });

  test("publishing then unpublishing clears publicSlug, revoking the old link", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);

    const published = await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "abc123",
    });
    expect(published.visibility).toBe("public");
    expect(published.publicSlug).toBe("abc123");

    const unpublished = await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "private",
    });
    expect(unpublished.visibility).toBe("private");
    expect(unpublished.publicSlug).toBeUndefined();

    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.publicSlug).toBeUndefined();
  });

  test("re-publishing without a new slug keeps the existing publicSlug", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);
    await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "first-slug",
    });
    const again = await t.mutation(internal.canvases.publish, { canvasId, visibility: "public" });
    expect(again.publicSlug).toBe("first-slug");
  });

  test("rotating the public slug replaces the old one, invalidating it", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);
    await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "old-slug",
    });
    // Rotation goes through unpublish -> publish with a fresh slug, since
    // `publish` only mints a new slug when the canvas doesn't already have one.
    await t.mutation(internal.canvases.publish, { canvasId, visibility: "private" });
    const rotated = await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "new-slug",
    });
    expect(rotated.publicSlug).toBe("new-slug");

    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.publicSlug).toBe("new-slug");
  });
});

describe("artifact primary/supporting role inference", () => {
  async function seedCanvas(t: ReturnType<typeof convexTest>) {
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Render Target",
      kind: "html",
      createdBy,
    });
    return { canvasId, createdBy };
  }

  test("the first-ever artifact for a canvas becomes primary", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const storageId = await seedStorage(t);

    const result = await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId,
    });

    expect(result.artifact.role).toBe("primary");
  });

  test("a second, distinct artifact becomes supporting", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const storageId1 = await seedStorage(t, "one");
    const storageId2 = await seedStorage(t, "two");

    await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId: storageId1,
    });
    const second = await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/b.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId: storageId2,
    });

    expect(second.artifact.role).toBe("supporting");
  });

  test("re-rendering the current primary artifact keeps it primary (regression: canvas must always keep exactly one primary artifact)", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const storageId1 = await seedStorage(t, "one");
    const storageId2 = await seedStorage(t, "one-again");

    await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId: storageId1,
    });
    const rerendered = await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 12,
      storageId: storageId2,
    });

    expect(rerendered.artifact.role).toBe("primary");

    const artifacts = await t.query(internal.canvases.listArtifactsForCanvas, { canvasId });
    const primaries = artifacts.filter((a) => a.role === "primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.path).toBe("/output/a.png");
  });

  test("recordExecArtifacts no-ops (no new version) when nothing was uploaded", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const before = await t.run((ctx) => ctx.db.get(canvasId));

    const result = await t.mutation(internal.canvases.recordExecArtifacts, {
      canvasId,
      createdBy,
      artifacts: [],
    });

    expect(result.version).toBeNull();
    expect(result.artifacts).toEqual([]);
    const after = await t.run((ctx) => ctx.db.get(canvasId));
    expect(after?.currentVersionId).toBe(before?.currentVersionId);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});
