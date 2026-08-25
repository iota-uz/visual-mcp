/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("GET /s/:slug", () => {
  async function seedPublicCanvasWithArtifact(
    t: ReturnType<typeof convexTest>,
    overrides: {
      visibility?: "private" | "public";
      publicSlug?: string;
      artifactType?: "pdf" | "image" | "svg" | "source";
      artifactMime?: string;
      relPath?: string;
      role?: "primary" | "supporting";
      body?: string;
    } = {},
  ) {
    return t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "owner@iota.uz",
        name: "Owner",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "ws",
        name: "WS",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "canvas",
        title: "Public Canvas",
        kind: "html",
        visibility: overrides.visibility ?? "public",
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: 0,
        draftIframeEntrypoints: [],
        storageBytesUsed: 0,
        publicSlug: overrides.publicSlug ?? "pub-slug-123",
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
        iframeEntrypoints: [],
      });
      await ctx.db.patch(canvasId, {
        currentVersionId: versionId,
        publishedVersionId: (overrides.visibility ?? "public") === "public" ? versionId : undefined,
      });
      const storageId = await ctx.storage.store(
        new Blob([overrides.body ?? "<h1>hi</h1>"], {
          type: overrides.artifactMime ?? "text/html",
        }),
      );
      await ctx.db.insert("artifacts", {
        canvasId,
        versionId,
        relPath: overrides.relPath ?? "/output/index.html",
        type: overrides.artifactType ?? "source",
        role: overrides.role ?? "primary",
        mimeType: overrides.artifactMime ?? "text/html",
        size: (overrides.body ?? "<h1>hi</h1>").length,
        storageId,
      });
      return { canvasId, storageId };
    });
  }

  test("serves the primary artifact with CSP + nosniff headers, no auth required", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);

    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>hi</h1>");
    expect(html).toContain("data-visual-canvas-theme");
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src[^;]*cdn\.tailwindcss\.com/);
  });

  test("scopes workspace-root references inside public HTML", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t, {
      body: [
        '<img src="/assets/screen.png">',
        '<script>const runtime="/src/runtime.js";</script>',
        "<style>.hero{background:url(/assets/background.png)}</style>",
        '<img src="https://cdn.example/assets/external.png">',
      ].join(""),
    });

    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });
    const html = await res.text();

    expect(html).toContain('src="/s/pub-slug-123/assets/screen.png?v=1"');
    expect(html).toContain('runtime="/s/pub-slug-123/src/runtime.js?v=1"');
    expect(html).toContain("url(/s/pub-slug-123/assets/background.png?v=1)");
    expect(html).toContain('src="https://cdn.example/assets/external.png"');
  });

  test("pins scoped subresources to the artifact version and inserts v before fragments", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t, {
      body: '<link rel="stylesheet" href="/assets/theme.css#palette">',
    });
    await seedAsset(t, canvasId, "/assets/theme.css", "old-version");
    await t.run(async (ctx) => {
      const canvas = await ctx.db.get(canvasId);
      if (!canvas) throw new Error("missing canvas");
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 2,
        createdBy: canvas.createdBy,
        iframeEntrypoints: [],
      });
      const storageId = await ctx.storage.store(new Blob(["new-version"]));
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/assets/theme.css",
        storageId,
        size: 11,
        contentHash: "new",
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId, publishedVersionId: versionId });
    });

    const html = await (await t.fetch("/s/pub-slug-123")).text();
    expect(html).toContain('href="/s/pub-slug-123/assets/theme.css?v=1#palette"');
    expect(await (await t.fetch("/s/pub-slug-123/assets/theme.css?v=1")).text()).toBe(
      "old-version",
    );
    expect(await (await t.fetch("/s/pub-slug-123/assets/theme.css")).text()).toBe("new-version");
  });

  test("404s for an unknown slug", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/s/does-not-exist", { method: "GET" });
    expect(res.status).toBe(404);
  });

  test("404s for a private canvas's slug — visibility is the only gate on this route", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t, { visibility: "private" });
    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });
    expect(res.status).toBe(404);
  });

  test("serves crawler metadata only while the public slug is live", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    const live = await t.fetch("/social/pub-slug-123");
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(await live.json()).toMatchObject({
      title: "Public Canvas",
      description: "A visual canvas shared from Visual Canvas.",
      version: 1,
      thumbnail_url: null,
    });

    await t.run((ctx) => ctx.db.patch(canvasId, { visibility: "private", publicSlug: undefined }));
    expect((await t.fetch("/social/pub-slug-123")).status).toBe(404);
    expect((await t.fetch("/social/never-minted")).status).toBe(404);
  });

  test("serves a script-free pinned GitHub/Markdown preview card", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);

    const res = await t.fetch(
      "/s/pub-slug-123/_embed/card.svg?target=artifact&id=%2Foutput%2Findex.html&version=1",
      { method: "GET" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/);
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const svg = await res.text();
    expect(svg).toContain("index.html");
    expect(svg).toContain("Public Canvas");
    expect(svg).not.toContain("<script");
  });

  test("an image artifact card contains the artifact preview bytes", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t, {
      artifactType: "image",
      artifactMime: "image/png",
      relPath: "/output/screen.png",
      body: "PNG-preview-bytes",
    });

    const res = await t.fetch(
      "/s/pub-slug-123/_embed/card.svg?target=artifact&id=%2Foutput%2Fscreen.png&version=1",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("data:image/png;base64,");
  });

  test("latest cards use short caching and unpublishing revokes them", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    const live = await t.fetch("/s/pub-slug-123/_embed/card.svg?target=canvas");
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toContain("max-age=60");

    await t.run(async (ctx) => {
      await ctx.db.patch(canvasId, { visibility: "private", publicSlug: undefined });
    });
    expect((await t.fetch("/s/pub-slug-123/_embed/card.svg?target=canvas")).status).toBe(404);
  });

  test("rejects unknown card targets", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);
    const res = await t.fetch("/s/pub-slug-123/_embed/card.svg?target=website");
    expect(res.status).toBe(400);
  });

  test("validates PNG embed parameters before starting a render", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);
    expect((await t.fetch("/s/pub-slug-123/_embed/canvas.png?scale=3")).status).toBe(400);
    expect((await t.fetch("/s/pub-slug-123/_embed/region/0-0-0-100.png?scale=2")).status).toBe(400);
    expect(
      (await t.fetch("/s/pub-slug-123/_embed/region/0-0-10000-10000.png?scale=2")).status,
    ).toBe(400);
    expect((await t.fetch("/s/pub-slug-123/_embed/canvas.png?v=999")).status).toBe(404);
  });

  test("never resolves unpublished historical checkpoints for public embeds", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    const unpublishedVersionId = await t.run(async (ctx) => {
      const canvas = await ctx.db.get(canvasId);
      if (!canvas) throw new Error("missing canvas");
      return ctx.db.insert("canvasVersions", {
        canvasId,
        version: 2,
        createdBy: canvas.createdBy,
        iframeEntrypoints: [],
      });
    });
    expect(
      await t.query(internal.embeds.resolvePublicContext, {
        publicSlug: "pub-slug-123",
        version: 2,
      }),
    ).toBeNull();
    await t.run((ctx) => ctx.db.patch(canvasId, { publishedVersionId: unpublishedVersionId }));
    await expect(
      t.query(internal.embeds.resolvePublicContext, {
        publicSlug: "pub-slug-123",
        version: 2,
      }),
    ).resolves.toMatchObject({ version: 2 });
  });

  test("serves an explicit relPath under the slug instead of the primary artifact", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);
    await t.run(async (ctx) => {
      const canvas = await ctx.db
        .query("canvases")
        .withIndex("by_publicSlug", (q) => q.eq("publicSlug", "pub-slug-123"))
        .unique();
      if (!canvas) throw new Error("seed canvas missing");
      const versionId = await ctx.db
        .query("canvasVersions")
        .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvas._id))
        .first()
        .then((v) => v?._id);
      if (!versionId) throw new Error("seed version missing");
      const storageId = await ctx.storage.store(new Blob(["extra"], { type: "text/plain" }));
      await ctx.db.insert("artifacts", {
        canvasId: canvas._id,
        versionId,
        relPath: "/output/extra.txt",
        type: "source",
        role: "supporting",
        mimeType: "text/plain",
        size: 5,
        storageId,
      });
    });

    const res = await t.fetch("/s/pub-slug-123/output/extra.txt", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("extra");
  });

  test("SVG is served as an attachment, never inline", async () => {
    const t = convexTest(schema, modules);
    const svg = '<svg><image href="/assets/logo.png"/></svg>';
    await seedPublicCanvasWithArtifact(t, {
      artifactType: "svg",
      artifactMime: "image/svg+xml",
      relPath: "/output/diagram.svg",
      body: svg,
    });

    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(res.headers.get("content-disposition")).toMatch(/diagram\.svg/);
    expect(await res.text()).toBe(svg);
  });

  // A shared HTML artifact is a *page*, and a page has subresources. Until
  // these, `<img src="../assets/logo.png">` rendered fine in the worker (it
  // hydrates every canvasFile) and then 404'd for whoever opened the link,
  // because this route could only ever serve `artifacts` rows.
  async function seedAsset(
    t: ReturnType<typeof convexTest>,
    canvasId: Id<"canvases">,
    relPath: string,
    body: string,
  ) {
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([body]));
      await ctx.db.insert("canvasFiles", {
        canvasId,
        relPath,
        storageId,
        size: body.length,
        contentHash: "hash",
      });
      const canvas = await ctx.db.get(canvasId);
      if (!canvas?.currentVersionId) throw new Error("seed canvas has no current version");
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId: canvas.currentVersionId,
        relPath,
        storageId,
        size: body.length,
        contentHash: "hash",
      });
    });
  }

  test("serves a public canvas's /assets file, typed from its extension", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/assets/logo.png", "PNGBYTES");

    const res = await t.fetch("/s/pub-slug-123/assets/logo.png", { method: "GET" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PNGBYTES");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("resolves a version-pinned Asset Library binding for non-canvas public pages", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await t.run(async (ctx) => {
      const canvas = await ctx.db.get(canvasId);
      if (!canvas?.currentVersionId) throw new Error("seed canvas has no current version");
      const assetId = await ctx.db.insert("assets", {
        scope: "workspace",
        workspaceId: canvas.workspaceId,
        slug: "logo",
        name: "Logo",
        tags: [],
        kind: "image",
        searchText: "logo",
        createdBy: canvas.createdBy,
        updatedAt: 0,
      });
      const assetVersionId = await ctx.db.insert("assetVersions", {
        assetId,
        revision: 1,
        objectKey: "assets/logo",
        contentHash: "logo-hash",
        mimeType: "image/png",
        size: 123,
        originalFilename: "logo.png",
        sourceType: "upload",
        createdBy: canvas.createdBy,
      });
      await ctx.db.insert("canvasVersionAssets", {
        canvasId,
        versionId: canvas.currentVersionId,
        logicalPath: "/assets/logo.png",
        assetId,
        assetVersionId,
      });
    });

    expect(
      await t.query(internal.canvases.resolvePublicArtifact, {
        publicSlug: "pub-slug-123",
        relPath: "/assets/logo.png",
        version: 1,
      }),
    ).toMatchObject({
      objectKey: "assets/logo",
      libraryAsset: true,
      mimeType: "image/png",
      version: 1,
    });
  });

  test("serves supported video with an executable media CSP and correct MIME", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/assets/demo.mp4", "MP4BYTES");

    const asset = await t.fetch("/s/pub-slug-123/assets/demo.mp4");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("video/mp4");
    const page = await t.fetch("/s/pub-slug-123");
    expect(page.headers.get("content-security-policy")).toMatch(/media-src 'self' blob:/);
  });

  test("serves only registered iframe HTML from the current immutable version snapshot", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "u@iota.uz",
        name: "U",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "w",
        name: "W",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "c",
        title: "C",
        kind: "canvas",
        visibility: "public",
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: 0,
        draftIframeEntrypoints: ["/src/screens/runtime.html"],
        storageBytesUsed: 0,
        publicSlug: "iframe-public",
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
        iframeEntrypoints: ["/src/screens/runtime.html"],
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId, publishedVersionId: versionId });
      for (const [relPath, body] of [
        ["/src/screens/runtime.html", "<!doctype html><button>Live</button>"],
        ["/src/screens/secret.html", "secret"],
      ] as const) {
        const storageId = await ctx.storage.store(new Blob([body]));
        await ctx.db.insert("canvasVersionFiles", {
          canvasId,
          versionId,
          relPath,
          storageId,
          size: body.length,
          contentHash: "hash",
        });
      }
    });
    const allowed = await t.fetch("/s/iframe-public/src/screens/runtime.html");
    expect(allowed.status).toBe(200);
    const html = await allowed.text();
    expect(html).toMatch(/visual-canvas:readiness/);
    expect(html).toMatch(/visual-canvas:lifecycle/);
    expect(html).toMatch(/visual-canvas:suspend/);
    expect(html).toMatch(/visual-canvas:resume/);
    expect(allowed.headers.get("content-security-policy")).not.toMatch(/allow-same-origin/);
    expect((await t.fetch("/s/iframe-public/src/screens/secret.html")).status).toBe(404);
  });

  test("an /assets SVG still downloads rather than rendering as a document", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/assets/logo.svg", "<svg/>");

    const res = await t.fetch("/s/pub-slug-123/assets/logo.svg", { method: "GET" });

    // Content-Disposition does not apply to `<img>` subresource loads, so
    // the logo still renders inside the page — but a direct navigation to
    // this URL must not execute SVG script on the shared origin.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  test("published non-canvas HTML serves its version-pinned /src dependencies", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/src/index.html", "<h1>author source</h1>");

    const res = await t.fetch("/s/pub-slug-123/src/index.html", { method: "GET" });

    expect(res.status).toBe(200);
  });

  test("a private canvas's assets are not served either", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t, { visibility: "private" });
    await seedAsset(t, canvasId, "/assets/logo.png", "PNGBYTES");

    const res = await t.fetch("/s/pub-slug-123/assets/logo.png", { method: "GET" });

    expect(res.status).toBe(404);
  });
});

describe("GET /i/:capability", () => {
  test("serves current draft iframe HTML, scripts, styles and assets through the capability", async () => {
    const t = convexTest(schema, modules);
    const token = "private-iframe-capability";
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "owner@iota.uz",
        name: "Owner",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "private-workspace",
        name: "Private workspace",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "private-canvas",
        title: "Private canvas",
        kind: "canvas",
        visibility: "private",
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: 0,
        draftIframeEntrypoints: ["/src/screens/runtime.html"],
        storageBytesUsed: 0,
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
        iframeEntrypoints: ["/src/screens/runtime.html"],
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId });

      for (const [relPath, body] of [
        [
          "/src/screens/runtime.html",
          [
            '<link rel="stylesheet" href="/src/screen.css">',
            '<img src="/assets/screens/screen.png">',
            '<script>const runtime="/src/runtime.js";</script>',
            '<img src="https://cdn.example/assets/external.png">',
          ].join(""),
        ],
        ["/src/screen.css", ".hero{background:url(/assets/background.png)}"],
        ["/assets/screens/screen.png", "PNG"],
      ] as const) {
        const storageId = await ctx.storage.store(new Blob([body]));
        await ctx.db.insert("canvasFiles", {
          canvasId,
          relPath,
          storageId,
          size: body.length,
          contentHash: `hash:${relPath}`,
        });
      }
      await ctx.db.insert("iframeCapabilities", {
        token,
        canvasId,
        userId,
        expiresAt: Date.now() + 60_000,
      });
    });

    const htmlResponse = await t.fetch(`/i/${token}/src/screens/runtime.html`);
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain(`href="/i/${token}/src/screen.css"`);
    expect(html).toContain(`src="/i/${token}/assets/screens/screen.png"`);
    expect(html).toContain(`runtime="/i/${token}/src/runtime.js"`);
    expect(html).toContain('src="https://cdn.example/assets/external.png"');
    expect(html).toContain("visual-canvas:readiness");
    expect(html).toContain("data-visual-canvas-theme");
    expect(html).toContain("--color-primary: #2563eb");
    expect(html).toContain("window.visualCanvasTheme=");

    const cssResponse = await t.fetch(`/i/${token}/src/screen.css`);
    expect(cssResponse.status).toBe(200);
    expect(await cssResponse.text()).toBe(
      `.hero{background:url(/i/${token}/assets/background.png)}`,
    );

    const assetResponse = await t.fetch(`/i/${token}/assets/screens/screen.png`);
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toBe("PNG");
    expect((await t.fetch("/assets/screens/screen.png")).status).toBe(404);
  });
});
