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
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "images.example") {
      const png = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
      png.writeUInt32BE(600, 16);
      png.writeUInt32BE(328, 20);
      return new Response(png, { headers: { "content-type": "image/png" } });
    }
    const slug = decodeURIComponent(parsed.pathname.slice("/social/".length));
    const metadata = metadataBySlug[slug];
    return metadata ? Response.json(metadata) : new Response("Not found", { status: 404 });
  };
  const server = createAppServer({ distRoot: root, siteOrigin: "https://api.example", fetchImpl });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

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
