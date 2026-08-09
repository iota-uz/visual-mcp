/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
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

describe("per-canvas storage quota (PLAN.md section 9/12.4: 250MB soft cap)", () => {
  const MB = 1024 * 1024;

  async function seedCanvas(t: ReturnType<typeof convexTest>) {
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Quota Target",
      kind: "html",
      createdBy,
    });
    return { canvasId, createdBy };
  }

  test("a render that would push a canvas over the cap is rejected with a clear message", async () => {
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
      size: 200 * MB,
      storageId: storageId1,
    });

    await expect(
      t.mutation(internal.canvases.recordRender, {
        canvasId,
        createdBy,
        relPath: "/output/b.png",
        type: "image",
        mimeType: "image/png",
        size: 60 * MB,
        storageId: storageId2,
      }),
    ).rejects.toThrow(/Canvas storage quota exceeded/);
  });

  test("re-rendering the same output_path does not double-count its own previous size", async () => {
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
      size: 200 * MB,
      storageId: storageId1,
    });

    // Same relPath, replacing the prior 200MB entry — total stays ~200MB,
    // well under the cap, even though naive addition (200 + 200) would trip it.
    await expect(
      t.mutation(internal.canvases.recordRender, {
        canvasId,
        createdBy,
        relPath: "/output/a.png",
        type: "image",
        mimeType: "image/png",
        size: 200 * MB,
        storageId: storageId2,
      }),
    ).resolves.toBeTruthy();
  });

  test("write_file is rejected once it would push a canvas over the cap", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedCanvas(t);
    const storageId1 = await seedStorage(t, "one");
    const storageId2 = await seedStorage(t, "two");

    await t.mutation(internal.canvases.upsertFile, {
      canvasId,
      relPath: "/output/a.bin",
      storageId: storageId1,
      size: 240 * MB,
      contentHash: "hash-a",
    });

    await expect(
      t.mutation(internal.canvases.upsertFile, {
        canvasId,
        relPath: "/output/b.bin",
        storageId: storageId2,
        size: 20 * MB,
        contentHash: "hash-b",
      }),
    ).rejects.toThrow(/Canvas storage quota exceeded/);
  });

  test("quota is scoped per canvas, not shared across a workspace", async () => {
    const t = convexTest(schema, modules);
    const { createdBy } = await seedCanvas(t);
    const workspaceId = await seedWorkspace(t, createdBy, "Shared WS");
    const canvasA = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "A",
      kind: "html",
      createdBy,
    });
    const canvasB = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "B",
      kind: "html",
      createdBy,
    });
    const storageId1 = await seedStorage(t, "one");
    const storageId2 = await seedStorage(t, "two");

    await t.mutation(internal.canvases.recordRender, {
      canvasId: canvasA.canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 240 * MB,
      storageId: storageId1,
    });

    // canvasB starts empty — its own 240MB render must succeed even though
    // canvasA (same workspace) is already near the per-canvas cap.
    await expect(
      t.mutation(internal.canvases.recordRender, {
        canvasId: canvasB.canvasId,
        createdBy,
        relPath: "/output/b.png",
        type: "image",
        mimeType: "image/png",
        size: 240 * MB,
        storageId: storageId2,
      }),
    ).resolves.toBeTruthy();
  });
});

describe("cache TTL sweep (PLAN.md section 9/12.4: /cache is ephemeral, 24h)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seedCanvas(t: ReturnType<typeof convexTest>) {
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Cache Sweep Target",
      kind: "html",
      createdBy,
    });
    return { canvasId, createdBy };
  }

  test("deletes /cache/ artifacts older than 24h, leaves fresh /cache/ and any-age /output/ alone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);

    const oldCacheStorage = await seedStorage(t, "old-cache");
    const oldOutputStorage = await seedStorage(t, "old-output");
    await t.mutation(internal.canvases.recordExecArtifacts, {
      canvasId,
      createdBy,
      artifacts: [
        {
          relPath: "/cache/stale.svg",
          type: "svg",
          mimeType: "image/svg+xml",
          size: 10,
          storageId: oldCacheStorage,
        },
        {
          relPath: "/output/keep.png",
          type: "image",
          mimeType: "image/png",
          size: 10,
          storageId: oldOutputStorage,
        },
      ],
    });

    // 25h later — past the 24h TTL.
    vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
    const freshCacheStorage = await seedStorage(t, "fresh-cache");
    await t.mutation(internal.canvases.recordExecArtifacts, {
      canvasId,
      createdBy,
      artifacts: [
        {
          relPath: "/cache/fresh.svg",
          type: "svg",
          mimeType: "image/svg+xml",
          size: 10,
          storageId: freshCacheStorage,
        },
      ],
    });

    const result = await t.mutation(internal.canvases.sweepCacheTtl, {});
    expect(result.deleted).toBe(1);

    const artifacts = await t.query(internal.canvases.listArtifactsForCanvas, { canvasId });
    const paths = artifacts.map((a) => a.path).sort();
    expect(paths).toEqual(["/cache/fresh.svg", "/output/keep.png"]);
  });

  test("deletes the underlying storage blob, not just the row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const storageId = await seedStorage(t, "expires-soon");

    await t.mutation(internal.canvases.recordExecArtifacts, {
      canvasId,
      createdBy,
      artifacts: [
        {
          relPath: "/cache/stale.svg",
          type: "svg",
          mimeType: "image/svg+xml",
          size: 10,
          storageId,
        },
      ],
    });

    vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
    await t.mutation(internal.canvases.sweepCacheTtl, {});

    const blob = await t.run((ctx) => ctx.storage.get(storageId));
    expect(blob).toBeNull();
  });
});
