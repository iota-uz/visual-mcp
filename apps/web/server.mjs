import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(process.cwd(), "dist");
const META_START = "<!-- visual-canvas:meta:start -->";
const META_END = "<!-- visual-canvas:meta:end -->";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function convexSiteOrigin(convexUrl) {
  const raw = String(convexUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!raw) throw new Error("VITE_CONVEX_URL or CONVEX_SITE_URL is required");
  const url = new URL(raw.replace(/\.convex\.cloud$/, ".convex.site"));
  if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port) {
    url.port = String(Number(url.port) + 1);
  }
  return url.origin;
}

export function renderSocialMeta({ metadata, canonicalUrl, imageUrl }) {
  const title = `${metadata.title} · Visual Canvas`;
  const alt = `Preview of ${metadata.title}`;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    '<meta property="og:image:width" content="1730" />',
    '<meta property="og:image:height" content="909" />',
    `<meta property="og:image:alt" content="${escapeHtml(alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(alt)}" />`,
  ];
  return `${META_START}\n    ${tags.join("\n    ")}\n    ${META_END}`;
}

export function injectSocialMeta(template, data) {
  const start = template.indexOf(META_START);
  const end = template.indexOf(META_END);
  if (start < 0 || end < start) throw new Error("index.html is missing social metadata markers");
  return `${template.slice(0, start)}${renderSocialMeta(data)}${template.slice(end + META_END.length)}`;
}

function requestOrigin(request) {
  const protocol = String(request.headers["x-forwarded-proto"] ?? "http")
    .split(",")[0]
    .trim();
  const host = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost")
    .split(",")[0]
    .trim();
  return new URL(`${protocol}://${host}`).origin;
}

function contentType(path) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    }[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

export function createAppServer({
  distRoot = ROOT,
  siteOrigin = convexSiteOrigin(process.env.CONVEX_SITE_URL ?? process.env.VITE_CONVEX_URL),
  fetchImpl = fetch,
} = {}) {
  const templatePromise = readFile(join(distRoot, "index.html"), "utf8");
  const fallbackPath = join(distRoot, "social-fallback.png");

  async function metadata(slug) {
    const response = await fetchImpl(`${siteOrigin}/social/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
    });
    return response.ok ? response.json() : null;
  }

  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const url = new URL(request.url ?? "/", requestOrigin(request));
      const socialImage = /^\/s\/([^/]+)\/_social\/preview\.png$/.exec(url.pathname);
      if (socialImage) {
        const slug = decodeURIComponent(socialImage[1]);
        const data = await metadata(slug);
        if (
          !data ||
          (url.searchParams.get("v") && url.searchParams.get("v") !== String(data.version))
        ) {
          response.writeHead(404, { "cache-control": "no-store" }).end("Not found");
          return;
        }
        let body;
        let type = "image/png";
        if (data.thumbnail_url) {
          const thumbnail = await fetchImpl(data.thumbnail_url);
          const thumbnailType = thumbnail.headers.get("content-type") ?? "";
          if (thumbnail.ok && /^image\/(png|jpeg)$/.test(thumbnailType)) {
            body = Buffer.from(await thumbnail.arrayBuffer());
            type = thumbnailType;
          }
        }
        body ??= await readFile(fallbackPath);
        response.writeHead(200, {
          "content-type": type,
          "content-length": body.byteLength,
          "cache-control": "public, max-age=60, must-revalidate",
          "x-content-type-options": "nosniff",
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }

      const publicPage = /^\/s\/([^/]+)\/?$/.exec(url.pathname);
      if (publicPage) {
        const slug = decodeURIComponent(publicPage[1]);
        const data = await metadata(slug);
        const template = await templatePromise;
        if (!data) {
          response.writeHead(404, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          });
          response.end(request.method === "HEAD" ? undefined : template);
          return;
        }
        const canonicalUrl = `${url.origin}/s/${encodeURIComponent(slug)}`;
        const imageUrl = `${canonicalUrl}/_social/preview.png?v=${encodeURIComponent(data.version)}`;
        const html = injectSocialMeta(template, { metadata: data, canonicalUrl, imageUrl });
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(html),
          "cache-control": "public, max-age=0, must-revalidate",
          vary: "x-forwarded-host, x-forwarded-proto, host",
        });
        response.end(request.method === "HEAD" ? undefined : html);
        return;
      }

      const decoded = decodeURIComponent(url.pathname);
      const relative = normalize(decoded).replace(/^[/\\]+/, "");
      let path = join(distRoot, relative || "index.html");
      if (!path.startsWith(distRoot)) throw new Error("Invalid path");
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) path = join(distRoot, "index.html");
      const fileInfo = await stat(path);
      response.writeHead(200, {
        "content-type": contentType(path),
        "content-length": fileInfo.size,
        "cache-control": path.endsWith("index.html")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(path).pipe(response);
    } catch (error) {
      console.error(error);
      response
        .writeHead(500, { "content-type": "text/plain; charset=utf-8" })
        .end("Internal error");
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createAppServer().listen(port, "0.0.0.0", () => {
    console.log(`Visual Canvas web listening on ${port}`);
  });
}
