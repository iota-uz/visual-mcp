/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const VALID_IDENTITY = {
  subject: "google-sub-123",
  issuer: "https://accounts.google.com",
  email: "person@iota.uz",
  emailVerified: true,
  name: "Person",
  hd: "iota.uz",
};

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

describe("canvases.rotateMySlug", () => {
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

  test("mints a new slug atomically, no unpublish step needed", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);
    await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "old-slug",
    });

    const asMember = t.withIdentity(VALID_IDENTITY);
    const { publicSlug } = await asMember.mutation(api.canvases.rotateMySlug, { canvasId });

    expect(publicSlug).not.toBe("old-slug");
    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.visibility).toBe("public");
    expect(canvas?.publicSlug).toBe(publicSlug);
  });

  test("the old slug stops resolving once rotated", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);
    await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "old-slug",
    });

    const asMember = t.withIdentity(VALID_IDENTITY);
    await asMember.mutation(api.canvases.rotateMySlug, { canvasId });

    const byOldSlug = await t.query(internal.canvases.resolvePublicArtifact, {
      publicSlug: "old-slug",
    });
    expect(byOldSlug).toBeNull();
  });

  test("rejects rotating a private canvas", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);
    const asMember = t.withIdentity(VALID_IDENTITY);
    await expect(asMember.mutation(api.canvases.rotateMySlug, { canvasId })).rejects.toThrow(
      /must be public/,
    );
  });

  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const canvasId = await seedCanvas(t);
    await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "old-slug",
    });
    await expect(t.mutation(api.canvases.rotateMySlug, { canvasId })).rejects.toThrow(
      /not signed in/i,
    );
  });
});

describe("canvases.listVersionsMine", () => {
  test("lists versions newest-first, flags the current one, resolves the author's email", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Versioned Canvas",
      kind: "canvas",
      createdBy,
    });
    const docStorageId = await seedStorage(t, "{}");

    await t.mutation(internal.canvases.putDoc, {
      canvasId,
      docStorageId,
      createdBy,
      note: "first pass",
      nodes: [],
    });
    const { versionId: v2Id } = await t.mutation(internal.canvases.putDoc, {
      canvasId,
      docStorageId,
      createdBy,
      note: "second pass",
      nodes: [],
    });

    const asMember = t.withIdentity(VALID_IDENTITY);
    const versions = await asMember.query(api.canvases.listVersionsMine, { canvasId });

    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      versionId: v2Id,
      note: "second pass",
      isCurrent: true,
      createdByEmail: "test@iota.uz",
    });
    expect(versions[1]).toMatchObject({ note: "first pass", isCurrent: false });
  });

  test("returns an empty list for a deleted/unknown canvas rather than throwing", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Soon Gone",
      kind: "canvas",
      createdBy,
    });
    await t.run((ctx) => ctx.db.delete(canvasId));

    const asMember = t.withIdentity(VALID_IDENTITY);
    const versions = await asMember.query(api.canvases.listVersionsMine, { canvasId });
    expect(versions).toEqual([]);
  });

  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Versioned Canvas",
      kind: "canvas",
      createdBy,
    });
    await expect(t.query(api.canvases.listVersionsMine, { canvasId })).rejects.toThrow(
      /not signed in/i,
    );
  });
});

describe("canvases.putDoc + searchNodes (PLAN.md section 4/9: canvasNodes search index)", () => {
  async function seedCanvasDocCanvas(t: ReturnType<typeof convexTest>) {
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Onboarding Flow",
      kind: "canvas",
      createdBy,
    });
    return { canvasId, createdBy };
  }

  test("re-putting a doc deletes the previous version's canvasNodes, not just adds new ones", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvasDocCanvas(t);
    const docStorageId = await seedStorage(t, "{}");

    await t.mutation(internal.canvases.putDoc, {
      canvasId,
      docStorageId,
      createdBy,
      nodes: [{ nodeId: "n1", title: "Sign In Screen", searchText: "sign in screen auth" }],
    });
    await t.mutation(internal.canvases.putDoc, {
      canvasId,
      docStorageId,
      createdBy,
      nodes: [{ nodeId: "n1", title: "Sign In Screen v2", searchText: "sign in screen auth v2" }],
    });

    const rows = await t.run((ctx) => ctx.db.query("canvasNodes").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Sign In Screen v2");
  });

  test("searchNodes finds a node by its searchText and resolves the parent canvas", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvasDocCanvas(t);
    const docStorageId = await seedStorage(t, "{}");
    await t.mutation(internal.canvases.putDoc, {
      canvasId,
      docStorageId,
      createdBy,
      nodes: [
        {
          nodeId: "checkout",
          title: "Checkout",
          eyebrow: "Payments",
          searchText: "checkout payments europrotocol",
        },
      ],
    });

    const asMember = t.withIdentity(VALID_IDENTITY);
    const results = await asMember.query(api.canvases.searchNodes, { query: "europrotocol" });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      canvasId,
      canvasTitle: "Onboarding Flow",
      nodeId: "checkout",
      nodeTitle: "Checkout",
      nodeEyebrow: "Payments",
    });
  });

  test("searchNodes returns nothing for a blank query and rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const asMember = t.withIdentity(VALID_IDENTITY);
    expect(await asMember.query(api.canvases.searchNodes, { query: "   " })).toEqual([]);
    await expect(t.query(api.canvases.searchNodes, { query: "anything" })).rejects.toThrow(
      /not signed in/i,
    );
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

describe("recordRender thumbnail handling (PLAN.md section 8)", () => {
  async function seedCanvas(t: ReturnType<typeof convexTest>) {
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Thumbnail Target",
      kind: "html",
      createdBy,
    });
    return { canvasId, createdBy };
  }

  test("a primary render's thumbnail is set on the canvas", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const storageId = await seedStorage(t, "full-size");
    const thumbnailStorageId = await seedStorage(t, "thumb");

    await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId,
      thumbnailStorageId,
    });

    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.thumbnailId).toBe(thumbnailStorageId);
  });

  test("a superseded thumbnail is deleted, not left as an orphaned blob", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const storageId1 = await seedStorage(t, "full-size-1");
    const thumb1 = await seedStorage(t, "thumb-1");
    const storageId2 = await seedStorage(t, "full-size-2");
    const thumb2 = await seedStorage(t, "thumb-2");

    await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId: storageId1,
      thumbnailStorageId: thumb1,
    });
    await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/a.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId: storageId2,
      thumbnailStorageId: thumb2,
    });

    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.thumbnailId).toBe(thumb2);
    expect(await t.run((ctx) => ctx.storage.get(thumb1))).toBeNull();
  });

  test("a thumbnail from a supporting (non-primary) render is discarded, not wired to the canvas", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const primaryStorageId = await seedStorage(t, "primary");

    await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/primary.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId: primaryStorageId,
    });

    const supportingStorageId = await seedStorage(t, "supporting");
    const supportingThumb = await seedStorage(t, "supporting-thumb");
    await t.mutation(internal.canvases.recordRender, {
      canvasId,
      createdBy,
      relPath: "/output/other.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      storageId: supportingStorageId,
      thumbnailStorageId: supportingThumb,
    });

    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.thumbnailId).toBeUndefined();
    expect(await t.run((ctx) => ctx.storage.get(supportingThumb))).toBeNull();
  });

  test("thumbnails are excluded from the storage quota counter", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const storageId = await seedStorage(t, "full-size");
    const thumbnailStorageId = await seedStorage(t, "thumb");

    // recordRender's args carry a `size` for the primary artifact only —
    // there is no thumbnail size argument, so the counter has nothing to
    // add for it regardless of the thumbnail blob's actual byte length.
    await expect(
      t.mutation(internal.canvases.recordRender, {
        canvasId,
        createdBy,
        relPath: "/output/a.png",
        type: "image",
        mimeType: "image/png",
        size: 10,
        storageId,
        thumbnailStorageId,
      }),
    ).resolves.toBeTruthy();

    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.storageBytesUsed).toBe(10);
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

  test("re-rendering the same output_path accumulates against the quota — the superseded blob is kept for version history, not freed", async () => {
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
      size: 150 * MB,
      storageId: storageId1,
    });

    // Same relPath — the `artifacts` table still shows one current row, but
    // PLAN.md section 1 keeps the first render's blob alive forever via the
    // superseded canvasVersions row, so a second 150MB render to the same
    // path is 300MB of real storage, not a 150MB replace. This is exactly
    // the "agent loop re-rendering the same output_path" scenario the quota
    // exists to catch (PLAN.md section 9/12.4) — a quota computed only from
    // current `artifacts`/`canvasFiles` rows would miss it entirely.
    await expect(
      t.mutation(internal.canvases.recordRender, {
        canvasId,
        createdBy,
        relPath: "/output/a.png",
        type: "image",
        mimeType: "image/png",
        size: 150 * MB,
        storageId: storageId2,
      }),
    ).rejects.toThrow(/Canvas storage quota exceeded/);
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

  test("releases the deleted blob's bytes from the canvas's running storage total", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvas(t);
    const cacheStorage = await seedStorage(t, "expires-soon");
    const outputStorage = await seedStorage(t, "stays");
    const MB = 1024 * 1024;

    await t.mutation(internal.canvases.recordExecArtifacts, {
      canvasId,
      createdBy,
      artifacts: [
        {
          relPath: "/cache/stale.svg",
          type: "svg",
          mimeType: "image/svg+xml",
          size: 30 * MB,
          storageId: cacheStorage,
        },
        {
          relPath: "/output/keep.png",
          type: "image",
          mimeType: "image/png",
          size: 20 * MB,
          storageId: outputStorage,
        },
      ],
    });

    vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
    await t.mutation(internal.canvases.sweepCacheTtl, {});

    // Only the 30MB /cache/ blob was actually deleted — the running total
    // should drop by exactly that much, leaving the 20MB /output/ blob's
    // contribution intact.
    const canvas = await t.run((ctx) => ctx.db.get(canvasId));
    expect(canvas?.storageBytesUsed).toBe(20 * MB);
  });
});
