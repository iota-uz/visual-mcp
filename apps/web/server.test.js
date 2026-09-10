import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAppServer, injectSocialMeta } from "./server.mjs";

const servers = [];
const directories = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixtureServer(metadataBySlug) {
  const root = await mkdtemp(join(tmpdir(), "visual-canvas-web-"));
  directories.push(root);
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><head><!-- visual-canvas:meta:start --><title>Visual Canvas</title><!-- visual-canvas:meta:end --></head><body><div id="root"></div></body>',
  );
  await writeFile(join(root, "social-fallback.png"), Buffer.from([137, 80, 78, 71]));
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.hostname === "mcp.example") {
      return Response.json({
        pathname: parsed.pathname,
        authorization: init.headers.get("authorization"),
        body: JSON.parse(await new Response(init.body).text()),
      });
    }
    if (parsed.hostname === "images.example") {
      const png = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
      png.writeUInt32BE(600, 16);
      png.writeUInt32BE(328, 20);
      return new Response(png, { headers: { "content-type": "image/png" } });
    }
    if (parsed.pathname.includes("/_embed/")) {
      if (parsed.pathname.includes("/missing/")) return new Response("Not found", { status: 404 });
      if (parsed.searchParams.has("pending")) {
        return new Response("Preview is being prepared.", {
          status: 202,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "retry-after": "3",
            "x-embed-status": "queued",
          },
        });
      }
      if (init?.headers?.get("if-none-match") === '"embed-hash"') {
        return new Response(null, { status: 304, headers: { etag: '"embed-hash"' } });
      }
      return new Response(Buffer.from([137, 80, 78, 71]), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": parsed.searchParams.has("v")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=60, must-revalidate",
          etag: '"embed-hash"',
          "x-embed-downscaled": "1",
          "set-cookie": "must-not-pass=1",
        },
      });
    }
    const slug = decodeURIComponent(parsed.pathname.slice("/social/".length));
    const entry = metadataBySlug[slug];
    const metadata = typeof entry === "function" ? entry(parsed) : entry;
    return metadata ? Response.json(metadata) : new Response("Not found", { status: 404 });
  };
  const server = createAppServer({
    distRoot: root,
    siteOrigin: "https://api.example",
    mcpOrigin: "https://mcp.example",
    fetchImpl,
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

describe("MCP reverse proxy", () => {
  it.each(["/mcp", "/mcp/video"])("preserves exact %s routing, auth and JSON", async (endpoint) => {
    const origin = await fixtureServer({});
    const response = await fetch(`${origin}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pathname: endpoint,
      authorization: "Bearer token",
      body: { method: "tools/list" },
    });
  });

  it.each(["/mcp", "/mcp/video"])("keeps %s POST-only", async (endpoint) => {
    const origin = await fixtureServer({});
    const response = await fetch(`${origin}${endpoint}`);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it.each(["/mcp/video/", "/mcp/video/other", "/mcp/other"])(
    "does not proxy the unsupported path %s",
    async (endpoint) => {
      const origin = await fixtureServer({});
      const response = await fetch(`${origin}${endpoint}`, { method: "POST", body: "{}" });
      expect(response.status).toBe(405);
    },
  );
});

describe("crawler-facing public share HTML", () => {
  it("injects escaped canvas-specific OG and Twitter metadata before JavaScript runs", () => {
    const html = injectSocialMeta(
      "<head><!-- visual-canvas:meta:start --><title>default</title><!-- visual-canvas:meta:end --></head>",
      {
        metadata: { title: 'Claims <Q3> & "next"', description: "Safe <b>description</b>" },
        canonicalUrl: "https://canvas.example/s/public",
        imageUrl: "https://canvas.example/s/public/_social/preview.png?v=3",
      },
    );
    expect(html).toContain("Claims &lt;Q3&gt; &amp; &quot;next&quot; · Visual Canvas");
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).not.toContain("<b>description</b>");
  });

  it("serves live shares with metadata and a versioned raster image URL", async () => {
    const origin = await fixtureServer({
      live: {
        title: "Fast settlement",
        description: "A claims flow",
        version: 7,
        thumbnail_url: null,
      },
    });
    const page = await fetch(`${origin}/s/live`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Fast settlement · Visual Canvas");
    expect(html).toContain(`${origin}/s/live/_social/preview.png?v=7`);
    const image = await fetch(`${origin}/s/live/_social/preview.png?v=7`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
  });

  it("declares the real thumbnail dimensions in crawler metadata", async () => {
    const origin = await fixtureServer({
      live: {
        title: "Fast settlement",
        description: "A claims flow",
        version: 8,
        thumbnail_url: "https://images.example/thumbnail.png",
      },
    });
    const html = await (await fetch(`${origin}/s/live`)).text();
    expect(html).toContain('property="og:image:width" content="600"');
    expect(html).toContain('property="og:image:height" content="328"');
  });

  it("keeps focused Page and Present URLs canonical and requests page-aware metadata", async () => {
    const origin = await fixtureServer({
      live: (url) => ({
        title: url.searchParams.get("page") === "mobile-flow" ? "Flow — Mobile flow" : "Flow",
        description: "A multi-page flow",
        version: 9,
        thumbnail_url: null,
      }),
    });
    const focusedUrl = `${origin}/s/live/present?page=mobile-flow&node=welcome&transition=dissolve`;
    const page = await fetch(focusedUrl);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Flow — Mobile flow · Visual Canvas");
    expect(html).toContain(
      `rel="canonical" href="${origin}/s/live/present?page=mobile-flow&amp;node=welcome"`,
    );
    expect(html).not.toContain("transition=dissolve");
  });

  it.each(["private", "revoked", "dead"])(
    "returns 404 with generic HTML and no canvas metadata for a %s slug",
    async (slug) => {
      const origin = await fixtureServer({});
      const page = await fetch(`${origin}/s/${slug}`);
      const html = await page.text();
      expect(page.status).toBe(404);
      expect(html).toContain("<title>Visual Canvas</title>");
      expect(html).not.toContain("og:image");
      expect((await fetch(`${origin}/s/${slug}/_social/preview.png?v=1`)).status).toBe(404);
    },
  );
});

describe("public embed image proxy", () => {
  it("preserves an explicit non-image queued response", async () => {
    const origin = await fixtureServer({});
    const response = await fetch(`${origin}/s/live/_embed/canvas.png?pending=1`);
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.headers.get("x-embed-status")).toBe("queued");
  });

  it("serves embeds on the web origin and preserves cache validators without cookies", async () => {
    const origin = await fixtureServer({});
    const url = `${origin}/s/live/_embed/node/c-rear.png?page=mobile&scale=2`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
    expect(response.headers.get("etag")).toBe('"embed-hash"');
    expect(response.headers.get("x-embed-downscaled")).toBe("1");
    expect(response.headers.get("set-cookie")).toBeNull();

    const conditional = await fetch(url, { headers: { "if-none-match": '"embed-hash"' } });
    expect(conditional.status).toBe(304);
  });

  it.each(["/s/live/_embed/group/fallback.png", "/s/live/_embed/stage/manual-entry.png?scale=2"])(
    "proxies addressable composition %s",
    async (path) => {
      const origin = await fixtureServer({});
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );
});
