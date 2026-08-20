/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const VALID_IDENTITY = {
  subject: "test-user|session-abc",
  issuer: "convex",
};

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return t.run((ctx) =>
    ctx.db.insert("users", {
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

describe("viewer artifact selection", () => {
  test("an HTML canvas opens its HTML artifact when a PNG is primary", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const createdBy = await ctx.db.insert("users", {
        email: "viewer@iota.uz",
        name: "Viewer",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "viewer-ws",
        name: "Viewer WS",
        createdBy,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "interactive-flow",
        title: "Interactive flow",
        kind: "html",
        visibility: "public",
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: 2,
        draftIframeEntrypoints: [],
        storageBytesUsed: 0,
        publicSlug: "interactive-flow-public",
        createdBy,
        updatedAt: 2,
      });
      const htmlStorageId = await ctx.storage.store(
        new Blob(["<button>Interactive</button>"], { type: "text/html" }),
      );
      const htmlVersionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy,
        entryStorageId: htmlStorageId,
        iframeEntrypoints: [],
      });
      await ctx.db.insert("artifacts", {
        canvasId,
        versionId: htmlVersionId,
        relPath: "/output/index.html",
        type: "source",
        role: "supporting",
        mimeType: "text/html",
        size: 28,
        storageId: htmlStorageId,
      });

      const pngStorageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
      const pngVersionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 2,
        createdBy,
        entryStorageId: pngStorageId,
        iframeEntrypoints: [],
      });
      await ctx.db.insert("artifacts", {
        canvasId,
        versionId: pngVersionId,
        relPath: "/output/index.png",
        type: "image",
        role: "primary",
        mimeType: "image/png",
        size: 3,
        storageId: pngStorageId,
      });
      await ctx.db.patch(canvasId, {
        currentVersionId: pngVersionId,
        publishedVersionId: pngVersionId,
        draftEntryStorageId: pngStorageId,
        thumbnailId: pngStorageId,
      });
      return { htmlStorageId };
    });

    const expectedHtmlUrl = await t.run((ctx) => ctx.storage.getUrl(seeded.htmlStorageId));
    const publicCanvas = await t.query(api.canvases.getPublic, {
      publicSlug: "interactive-flow-public",
    });
    expect(publicCanvas?.entry_url).toBe(expectedHtmlUrl);
    if (publicCanvas?.entry_public_url) {
      expect(publicCanvas.entry_public_url).toMatch(/\/output\/index\.html$/);
    }

    const rawEntry = await t.query(internal.canvases.resolvePublicArtifact, {
      publicSlug: "interactive-flow-public",
    });
    expect(rawEntry?.storageId).toBe(seeded.htmlStorageId);
    expect(rawEntry?.relPath).toBe("/output/index.html");
    expect(rawEntry?.mimeType).toBe("text/html");
  });
});

describe("reactive canvas resources", () => {
  test("iframe revisions stay stable for geometry and only change for the edited entrypoint", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Realtime canvas",
      kind: "canvas",
      createdBy,
    });
    const firstVersion = await t.run(async (ctx) => {
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy,
        iframeEntrypoints: [],
      });
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/src/screens/runtime.html",
        storageId: await ctx.storage.store(new Blob(["one"])),
        size: 3,
        contentHash: "same-hash",
      });
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/src/screens/untouched.html",
        storageId: await ctx.storage.store(new Blob(["untouched"])),
        size: 9,
        contentHash: "untouched-hash",
      });
      await ctx.db.patch(versionId, {
        iframeEntrypoints: ["/src/screens/runtime.html", "/src/screens/untouched.html"],
      });
      for (const [relPath, body, contentHash] of [
        ["/src/screens/runtime.html", "one", "same-hash"],
        ["/src/screens/untouched.html", "untouched", "untouched-hash"],
        ["/src/__canvas.html", "generated preview", "unrelated-generated-file"],
      ] as const) {
        await ctx.db.insert("canvasFiles", {
          canvasId,
          relPath,
          storageId: await ctx.storage.store(new Blob([body])),
          size: body.length,
          contentHash,
        });
      }
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/src/__canvas.html",
        storageId: await ctx.storage.store(new Blob(["generated preview"])),
        size: 17,
        contentHash: "unrelated-generated-file",
      });
      await ctx.db.patch(canvasId, {
        currentVersionId: versionId,
        draftIframeEntrypoints: ["/src/screens/runtime.html", "/src/screens/untouched.html"],
      });
      return versionId;
    });
    const first = await t.query(internal.canvases.get, { canvasId });

    const secondVersion = await t.run(async (ctx) => {
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 2,
        createdBy,
        iframeEntrypoints: [],
      });
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/src/screens/runtime.html",
        storageId: await ctx.storage.store(new Blob(["one"])),
        size: 3,
        contentHash: "same-hash",
      });
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/src/screens/untouched.html",
        storageId: await ctx.storage.store(new Blob(["untouched"])),
        size: 9,
        contentHash: "untouched-hash",
      });
      await ctx.db.patch(versionId, {
        iframeEntrypoints: ["/src/screens/runtime.html", "/src/screens/untouched.html"],
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId });
      return versionId;
    });
    const geometryOnly = await t.query(internal.canvases.get, { canvasId });
    expect(geometryOnly?.iframe_revisions).toEqual(first?.iframe_revisions);

    await t.run(async (ctx) => {
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 3,
        createdBy,
        iframeEntrypoints: [],
      });
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/src/screens/runtime.html",
        storageId: await ctx.storage.store(new Blob(["two"])),
        size: 3,
        contentHash: "different-hash",
      });
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/src/screens/untouched.html",
        storageId: await ctx.storage.store(new Blob(["untouched"])),
        size: 9,
        contentHash: "untouched-hash",
      });
      await ctx.db.patch(versionId, {
        iframeEntrypoints: ["/src/screens/runtime.html", "/src/screens/untouched.html"],
      });
      const runtimeFile = await ctx.db
        .query("canvasFiles")
        .withIndex("by_canvas_relPath", (q) =>
          q.eq("canvasId", canvasId).eq("relPath", "/src/screens/runtime.html"),
        )
        .unique();
      if (!runtimeFile) throw new Error("missing draft runtime fixture");
      await ctx.db.patch(runtimeFile._id, {
        storageId: await ctx.storage.store(new Blob(["two"])),
        contentHash: "different-hash",
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId });
    });
    const changed = await t.query(internal.canvases.get, { canvasId });
    expect(changed?.iframe_revisions?.["/src/screens/runtime.html"]).not.toBe(
      geometryOnly?.iframe_revisions?.["/src/screens/runtime.html"],
    );
    expect(changed?.iframe_revisions?.["/src/screens/untouched.html"]).toBe(
      geometryOnly?.iframe_revisions?.["/src/screens/untouched.html"],
    );
    expect(firstVersion).not.toBe(secondVersion);
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

  test("keeps the public canvas pinned while the durable draft changes", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const workspaceId = await seedWorkspace(t, createdBy);
    const { canvasId } = await t.mutation(internal.canvases.create, {
      workspaceId,
      title: "Pinned public canvas",
      kind: "canvas",
      createdBy,
    });
    const firstDoc = await seedStorage(t, JSON.stringify({ version: 3, marker: "published" }));
    const firstEntry = await seedStorage(t, "first entry");
    const initial = await t.mutation(internal.canvases.commitSaveContent, {
      canvasId,
      expectedVersion: 0,
      createdBy,
      changes: [],
      doc: {
        storageId: firstDoc,
        contentHash: "doc-one",
        entryStorageId: firstEntry,
        entrySize: 11,
        entryContentHash: "entry-one",
        iframeEntrypoints: [],
        imagePaths: [],
        nodes: [],
      },
    });
    expect(initial).toMatchObject({ version: 1, draftRevision: 1 });
    const published = await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
      newPublicSlug: "pinned-public-canvas",
    });
    expect(published.version).toBe(2);
    const before = await t.query(api.canvases.getPublic, {
      publicSlug: "pinned-public-canvas",
    });

    const secondDoc = await seedStorage(t, JSON.stringify({ version: 3, marker: "draft" }));
    const secondEntry = await seedStorage(t, "second entry");
    const edited = await t.mutation(internal.canvases.commitSaveContent, {
      canvasId,
      expectedVersion: 2,
      expectedDraftRevision: 1,
      createdBy,
      changes: [],
      doc: {
        storageId: secondDoc,
        contentHash: "doc-two",
        entryStorageId: secondEntry,
        entrySize: 12,
        entryContentHash: "entry-two",
        iframeEntrypoints: [],
        imagePaths: [],
        nodes: [],
      },
    });
    expect(edited).toMatchObject({ version: 2, draftRevision: 2, dirty: true });
    const draft = await t.query(internal.canvases.get, { canvasId });
    const stillPublic = await t.query(api.canvases.getPublic, {
      publicSlug: "pinned-public-canvas",
    });
    const social = await t.query(internal.canvases.resolvePublicSocialMetadata, {
      publicSlug: "pinned-public-canvas",
    });
    expect(draft?.doc_url).not.toBe(before?.doc_url);
    expect(stillPublic?.doc_url).toBe(before?.doc_url);
    expect(social?.version).toBe(2);

    const republished = await t.mutation(internal.canvases.publish, {
      canvasId,
      visibility: "public",
    });
    expect(republished.version).toBe(3);
    const after = await t.query(api.canvases.getPublic, {
      publicSlug: "pinned-public-canvas",
    });
    expect(after?.doc_url).toBe(draft?.doc_url);
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
      iframeEntrypoints: [],
      canvasId,
      docStorageId,
      createdBy,
      note: "first pass",
      nodes: [],
    });
    const { versionId: v2Id } = await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
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

  test("re-putting a doc preserves historical canvasNodes for pinned embeds", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvasDocCanvas(t);
    const docStorageId = await seedStorage(t, "{}");

    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId,
      docStorageId,
      createdBy,
      nodes: [
        {
          pageId: "overview",
          nodeId: "n1",
          title: "Sign In Screen",
          searchText: "sign in screen auth",
        },
      ],
    });
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId,
      docStorageId,
      createdBy,
      nodes: [
        {
          pageId: "overview",
          nodeId: "n1",
          title: "Sign In Screen v2",
          searchText: "sign in screen auth v2",
        },
      ],
    });

    const rows = await t.run((ctx) => ctx.db.query("canvasNodes").collect());
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.title)).toEqual(["Sign In Screen", "Sign In Screen v2"]);
  });

  test("searchNodes finds a node by its searchText and resolves the parent canvas", async () => {
    const t = convexTest(schema, modules);
    const { canvasId, createdBy } = await seedCanvasDocCanvas(t);
    const docStorageId = await seedStorage(t, "{}");
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId,
      docStorageId,
      createdBy,
      nodes: [
        {
          pageId: "overview",
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

describe("canvases.patchNodeRectMine", () => {
  test("coalesces optimistic geometry into the durable draft", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "person@iota.uz",
        name: "Person",
        lastSeenAt: 0,
      }),
    );
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "layout/optimistic",
      createdBy,
      kind: "canvas",
    });
    const pageDoc = {
      version: 2,
      title: "Layout",
      world: { width: 800, height: 600 },
      lanes: [
        {
          id: "lane",
          label: "Lane",
          role: "primary",
          rect: { x: 0, y: 0, w: 800, h: 600 },
        },
      ],
      stages: [{ id: "stage", index: 0, label: "Stage", rect: { x: 0, y: 0, w: 800, h: 600 } }],
      labels: [],
      nodes: [
        {
          id: "node",
          kind: "native",
          shape: "note",
          laneId: "lane",
          stageId: "stage",
          rect: { x: 10, y: 20, w: 100, h: 80 },
          caption: { title: "Node" },
          anchors: [{ id: "right", side: "right", offset: 0.5 }],
        },
      ],
      edges: [],
    };
    const doc = {
      version: 3,
      defaultPageId: "overview",
      pages: [{ id: "overview", title: "Overview", order: 0, doc: pageDoc }],
      prototype: { interactions: [] },
    };
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId: await seedStorage(t, JSON.stringify(doc)),
      createdBy,
      nodes: [{ pageId: "overview", nodeId: "node", title: "Node", searchText: "Node" }],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify(doc), { status: 200 }));

    const asMember = t.withIdentity({ subject: `${createdBy}|session-abc`, issuer: "convex" });
    await expect(
      asMember.action(api.canvases.patchNodeRectMine, {
        canvasId: created.canvasId,
        nodeId: "node",
        rect: { x: 30, y: 40, w: 120, h: 90 },
        expectedVersion: 1,
      }),
    ).resolves.toEqual({ version: 1, draftRevision: 1, dirty: true });

    const current = await t.query(internal.canvases.get, { canvasId: created.canvasId });
    expect(current?.version).toBe(1);
    expect(current?.draft_revision).toBe(1);
    expect(current?.dirty).toBe(true);
    const versions = await t.run((ctx) =>
      ctx.db
        .query("canvasVersions")
        .withIndex("by_canvas_version", (q) => q.eq("canvasId", created.canvasId))
        .collect(),
    );
    expect(versions).toHaveLength(1);
    await expect(
      asMember.action(api.canvases.patchNodeRectMine, {
        canvasId: created.canvasId,
        nodeId: "node",
        rect: { x: 50, y: 60, w: 120, h: 90 },
        expectedVersion: 1,
        expectedDraftRevision: 0,
      }),
    ).rejects.toThrow(/expected draft_revision 0, current 1/);

    for (let draftRevision = 1; draftRevision <= 25; draftRevision += 1) {
      await asMember.action(api.canvases.patchNodeRectMine, {
        canvasId: created.canvasId,
        nodeId: "node",
        rect: { x: 50 + draftRevision, y: 60, w: 120, h: 90 },
        expectedVersion: 1,
        expectedDraftRevision: draftRevision,
      });
    }
    const coalesced = await t.query(internal.canvases.get, { canvasId: created.canvasId });
    expect(coalesced).toMatchObject({
      version: 1,
      draft_revision: 26,
      draft_edit_count: 26,
      dirty: true,
    });
    const retainedVersions = await t.run((ctx) =>
      ctx.db
        .query("canvasVersions")
        .withIndex("by_canvas_version", (q) => q.eq("canvasId", created.canvasId))
        .collect(),
    );
    expect(retainedVersions).toHaveLength(1);
    fetchSpy.mockRestore();
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

/* ------------------------------------------------------------------------
 * v2 surface: ref-addressed upsert, delete, restore
 * ---------------------------------------------------------------------- */

describe("canvases.upsertByRef (the idempotent create)", () => {
  test("a slug ref creates the workspace and the canvas together", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);

    const result = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/fast-settlement",
      createdBy,
      title: "Fast Settlement",
      kind: "html",
    });

    expect(result.created).toBe(true);
    expect(result.workspaceSlug).toBe("osago");
    expect(result.canvasSlug).toBe("fast-settlement");
    expect(result.title).toBe("Fast Settlement");
  });

  test("re-calling the same ref updates instead of minting a duplicate", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);

    const first = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/fast-settlement",
      createdBy,
      title: "Fast Settlement",
      kind: "html",
    });
    const second = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/fast-settlement",
      createdBy,
      title: "Fast Settlement v2",
    });

    expect(second.created).toBe(false);
    expect(second.canvasId).toBe(first.canvasId);
    expect(second.title).toBe("Fast Settlement v2");
    // The v1 bug this replaces: a retried create left behind `osago-2`.
    expect(second.workspaceSlug).toBe("osago");
    const workspaces = await t.query(internal.workspaces.list, {});
    expect(workspaces).toHaveLength(1);
  });

  test("the slug stays put when the title changes", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);

    await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/fast-settlement",
      createdBy,
      title: "Original",
    });
    const renamed = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/fast-settlement",
      createdBy,
      title: "Completely Different Name",
    });

    expect(renamed.canvasSlug).toBe("fast-settlement");
  });

  test('mode "create" refuses to touch an existing canvas', async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);

    await t.mutation(internal.canvases.upsertByRef, { ref: "osago/report", createdBy });
    await expect(
      t.mutation(internal.canvases.upsertByRef, {
        ref: "osago/report",
        createdBy,
        mode: "create",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  test('mode "update" refuses to create a missing canvas', async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    await expect(
      t.mutation(internal.canvases.upsertByRef, {
        ref: "osago/nope",
        createdBy,
        mode: "update",
      }),
    ).rejects.toThrow(/no canvas at/i);
  });

  test("expected_version mismatch is refused, so a concurrent write is caught", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    await t.mutation(internal.canvases.upsertByRef, { ref: "osago/report", createdBy });

    await expect(
      t.mutation(internal.canvases.upsertByRef, {
        ref: "osago/report",
        createdBy,
        expectedVersion: 7,
      }),
    ).rejects.toThrow(/expected_version 7/);
  });

  test("flags an upsert that lands on another author's canvas", async () => {
    const t = convexTest(schema, modules);
    const author = await seedUser(t);
    const other = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "other@iota.uz",
        name: "Other",
        lastSeenAt: 0,
      }),
    );

    await t.mutation(internal.canvases.upsertByRef, { ref: "osago/report", createdBy: author });
    const second = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy: other,
    });

    expect(second.overwroteOtherAuthor).toBe(true);
  });

  test("a bad ref explains the two accepted forms instead of leaking a validator error", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    await expect(
      t.mutation(internal.canvases.upsertByRef, { ref: "a/b/c", createdBy }),
    ).rejects.toThrow(/too many "\/" segments/);
  });
});

describe("canvases.removeByRef", () => {
  test("soft-archive hides a canvas from listings but keeps its bytes", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy,
    });

    const result = await t.mutation(internal.canvases.removeByRef, {
      ref: "osago/report",
      target: "canvas",
    });

    expect(result.archived).toBe(true);
    const listed = await t.query(internal.canvases.list, { workspaceId: created.workspaceId });
    expect(listed).toHaveLength(0);
  });

  test("purge deletes the canvas's version blobs, not just its artifacts", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy,
      kind: "canvas",
    });

    // A version blob (doc) that the quota never counted and no sweep touches
    // — exactly the thing a naive delete orphans forever.
    const docStorageId = await seedStorage(t, "{}");
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId,
      createdBy,
      nodes: [],
    });

    await t.mutation(internal.canvases.removeByRef, {
      ref: "osago/report",
      target: "canvas",
      purge: true,
    });

    const blobStillThere = await t.run((ctx) => ctx.storage.getUrl(docStorageId));
    expect(blobStillThere).toBeNull();
    const versionsLeft = await t.run((ctx) => ctx.db.query("canvasVersions").collect());
    expect(versionsLeft).toHaveLength(0);
  });

  test("purging a workspace removes every canvas inside it", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    await t.mutation(internal.canvases.upsertByRef, { ref: "junk/one", createdBy });
    await t.mutation(internal.canvases.upsertByRef, { ref: "junk/two", createdBy });

    const result = await t.mutation(internal.canvases.removeByRef, {
      ref: "junk",
      target: "workspace",
      purge: true,
    });

    expect(result.canvases_deleted).toBe(2);
    const workspaces = await t.query(internal.workspaces.list, {});
    expect(workspaces).toHaveLength(0);
  });

  test("deleting a file reclaims its bytes from the quota counter", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy,
    });
    const storageId = await seedStorage(t, "hello world");
    await t.mutation(internal.canvases.upsertFile, {
      canvasId: created.canvasId,
      relPath: "/src/index.html",
      storageId,
      size: 11,
      contentHash: "h1",
    });

    const before = await t.run(
      async (ctx) => (await ctx.db.get(created.canvasId))?.storageBytesUsed,
    );
    expect(before).toBe(11);

    const result = await t.mutation(internal.canvases.removeByRef, {
      ref: "osago/report",
      target: "file",
      path: "/src/index.html",
    });

    expect(result.bytes_reclaimed).toBe(11);
    const after = await t.run(
      async (ctx) => (await ctx.db.get(created.canvasId))?.storageBytesUsed,
    );
    expect(after).toBe(0);
  });
});

describe("canvases.upsertFile storage accounting", () => {
  test("overwriting a source file releases the superseded blob instead of leaking it", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy,
    });

    const firstBlob = await seedStorage(t, "v1");
    await t.mutation(internal.canvases.upsertFile, {
      canvasId: created.canvasId,
      relPath: "/src/index.html",
      storageId: firstBlob,
      size: 100,
      contentHash: "h1",
    });

    const secondBlob = await seedStorage(t, "v2");
    await t.mutation(internal.canvases.upsertFile, {
      canvasId: created.canvasId,
      relPath: "/src/index.html",
      storageId: secondBlob,
      size: 100,
      contentHash: "h2",
    });

    // v1 charged both writes forever, so an agent iterating on one file could
    // exhaust a 250MB canvas by re-saving it.
    const used = await t.run(async (ctx) => (await ctx.db.get(created.canvasId))?.storageBytesUsed);
    expect(used).toBe(100);
    expect(await t.run((ctx) => ctx.storage.getUrl(firstBlob))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(secondBlob))).not.toBeNull();
  });

  test("re-declaring the same blob at the same path charges the quota once", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy,
    });

    const blob = await seedStorage(t, "same bytes");
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.canvases.upsertFile, {
        canvasId: created.canvasId,
        relPath: "/assets/logo.png",
        storageId: blob,
        size: 100,
        contentHash: "h1",
      });
    }

    // This is what a retried canvas_save does: it replays the upload_ids it
    // was handed. Charging per replay would burn a canvas's quota on bytes
    // that were never re-uploaded, and the blob is still very much alive.
    const used = await t.run(async (ctx) => (await ctx.db.get(created.canvasId))?.storageBytesUsed);
    expect(used).toBe(100);
    expect(await t.run((ctx) => ctx.storage.getUrl(blob))).not.toBeNull();
  });
});

describe("canvases.storageAttachment", () => {
  test("reports where a blob is attached so a replayed write can be told from aliasing", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy,
    });

    const blob = await seedStorage(t, "bytes");
    const free = await t.query(internal.canvases.storageAttachment, { storageId: blob });
    expect(free).toBeNull();

    await t.mutation(internal.canvases.upsertFile, {
      canvasId: created.canvasId,
      relPath: "/assets/logo.png",
      storageId: blob,
      size: 5,
      contentHash: "h1",
    });

    const taken = await t.query(internal.canvases.storageAttachment, { storageId: blob });
    expect(taken).toMatchObject({
      scope: "file",
      canvasId: created.canvasId,
      relPath: "/assets/logo.png",
      size: 5,
    });
  });
});

describe("canvases.restoreVersionByRef", () => {
  test("restores an earlier checkpoint into a new monotonic checkpoint", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/report",
      createdBy,
      kind: "canvas",
    });

    const firstFile = await seedStorage(t, "version-one");
    await t.mutation(internal.canvases.upsertFile, {
      canvasId: created.canvasId,
      relPath: "/src/state.txt",
      storageId: firstFile,
      size: 11,
      contentHash: "v1",
    });
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId: await seedStorage(t, "{v:1}"),
      createdBy,
      nodes: [],
    });
    await t.mutation(internal.canvases.upsertFile, {
      canvasId: created.canvasId,
      relPath: "/src/state.txt",
      storageId: await seedStorage(t, "version-two"),
      size: 11,
      contentHash: "v2",
    });
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId: await seedStorage(t, "{v:2}"),
      createdBy,
      nodes: [],
    });

    const restored = await t.mutation(internal.canvases.restoreVersionByRef, {
      ref: "osago/report",
      version: 1,
    });
    expect(restored.version).toBe(3);

    const canvas = await t.query(internal.canvases.get, { canvasId: created.canvasId });
    expect(canvas?.version).toBe(3);
    const files = await t.query(internal.canvases.listFilesForCanvas, {
      canvasId: created.canvasId,
    });
    expect(files).toMatchObject([{ relPath: "/src/state.txt", contentHash: "v1" }]);

    const docEdit = await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId: await seedStorage(t, "{v:3}"),
      createdBy,
      expectedVersion: 3,
      nodes: [],
    });
    expect(docEdit.version).toBe(4);

    await t.mutation(internal.canvases.restoreVersionByRef, {
      ref: "osago/report",
      version: 1,
    });
    const fileEdit = await t.mutation(internal.canvases.commitFilePatch, {
      canvasId: created.canvasId,
      expectedVersion: 5,
      createdBy,
      changes: [
        {
          type: "write",
          path: "/src/state.txt",
          expectedHash: "v1",
          storageId: await seedStorage(t, "version-four"),
          size: 12,
          contentHash: "v4",
        },
      ],
    });
    expect(fileEdit).toMatchObject({ version: 5, dirty: true });

    await t.mutation(internal.canvases.restoreVersionByRef, {
      ref: "osago/report",
      version: 1,
    });
    const asset = await t.run(async (ctx) => {
      const canvas = await ctx.db.get(created.canvasId);
      if (!canvas) throw new Error("missing canvas");
      const assetId = await ctx.db.insert("assets", {
        scope: "workspace",
        workspaceId: canvas.workspaceId,
        slug: "logo",
        name: "Logo",
        tags: [],
        kind: "image",
        searchText: "logo",
        createdBy,
        updatedAt: 0,
      });
      const assetVersionId = await ctx.db.insert("assetVersions", {
        assetId,
        revision: 1,
        sourceObjectKey: "source/logo",
        deliveryObjectKey: "delivery/logo",
        previewObjectKey: "preview/logo",
        contentHash: "logo-hash",
        mimeType: "image/png",
        size: 4,
        originalFilename: "logo.png",
        sourceType: "upload",
        createdBy,
      });
      return { assetId, assetVersionId };
    });
    const assetEdit = await t.mutation(internal.canvases.bindAssetAndVersion, {
      canvasId: created.canvasId,
      logicalPath: "/assets/logo.png",
      assetId: asset.assetId,
      assetVersionId: asset.assetVersionId,
      expectedVersion: 6,
      createdBy,
    });
    expect(assetEdit.version).toBe(6);
    expect(
      await t.run(async (ctx) => ((await ctx.db.get(created.canvasId))?.draftEditCount ?? 0) > 0),
    ).toBe(true);

    expect(
      await t.run(async (ctx) =>
        (
          await ctx.db
            .query("canvasVersions")
            .withIndex("by_canvas_version", (q) => q.eq("canvasId", created.canvasId))
            .collect()
        ).map((version) => version.version),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("refuses a render that finishes after the canvas moved to a newer version", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/render-race",
      createdBy,
      kind: "canvas",
    });
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId: await seedStorage(t, "v1"),
      createdBy,
      nodes: [],
    });
    const oldVersionId = await t.run(
      async (ctx) => (await ctx.db.get(created.canvasId))?.currentVersionId,
    );
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId: await seedStorage(t, "v2"),
      createdBy,
      nodes: [],
    });
    if (!oldVersionId) throw new Error("missing old version");
    await expect(
      t.mutation(internal.canvases.attachCanvasRender, {
        canvasId: created.canvasId,
        versionId: oldVersionId,
        relPath: "/output/stale.png",
        type: "image",
        mimeType: "image/png",
        size: 3,
        storageId: await seedStorage(t, "png"),
      }),
    ).rejects.toThrow(/stale/i);
  });

  test("replacing a same-version supporting render reclaims its invisible old blob", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const created = await t.mutation(internal.canvases.upsertByRef, {
      ref: "osago/render-cleanup",
      createdBy,
      kind: "canvas",
    });
    await t.mutation(internal.canvases.putDoc, {
      iframeEntrypoints: [],
      canvasId: created.canvasId,
      docStorageId: await seedStorage(t, "doc"),
      createdBy,
      nodes: [],
    });
    const versionId = await t.run(
      async (ctx) => (await ctx.db.get(created.canvasId))?.currentVersionId,
    );
    if (!versionId) throw new Error("missing version");
    const oldStorageId = await seedStorage(t, "old");
    await t.mutation(internal.canvases.attachCanvasRender, {
      canvasId: created.canvasId,
      versionId,
      relPath: "/output/preview.png",
      type: "image",
      mimeType: "image/png",
      size: 3,
      storageId: oldStorageId,
    });
    await t.mutation(internal.canvases.attachCanvasRender, {
      canvasId: created.canvasId,
      versionId,
      relPath: "/output/preview.png",
      type: "image",
      mimeType: "image/png",
      size: 7,
      storageId: await seedStorage(t, "new-new"),
    });
    expect(await t.run((ctx) => ctx.storage.get(oldStorageId))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.get(created.canvasId))?.storageBytesUsed)).toBe(
      7,
    );
  });

  test("a missing version is refused with the version number named", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    await t.mutation(internal.canvases.upsertByRef, { ref: "osago/report", createdBy });
    await expect(
      t.mutation(internal.canvases.restoreVersionByRef, { ref: "osago/report", version: 42 }),
    ).rejects.toThrow(/no version 42/i);
  });
});
