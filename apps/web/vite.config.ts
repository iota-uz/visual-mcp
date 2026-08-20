import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
// Runtime server helpers are intentionally plain ESM so the final image does
// not need a TypeScript loader.
// @ts-expect-error -- server.mjs is covered by server.test.js.
import { convexSiteOrigin, injectSocialMeta, rasterDimensions } from "./server.mjs";

/*
 * VITE_FIXTURES=1 swaps the two Convex client modules for in-memory fakes
 * (src/dev/fixtures/) so the app runs with no backend at all. It is an alias
 * rather than a runtime branch on purpose: the route files stay untouched,
 * and without the flag none of the fixture code is reachable from the module
 * graph, so it cannot end up in a production bundle. See
 * src/dev/fixtures/convexReact.ts for what it is for.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const fixtures = env.VITE_FIXTURES === "1";
  const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

  const alias: Record<string, string> = {};
  if (fixtures) {
    alias["convex/react"] = local("./src/dev/fixtures/convexReact.ts");
    alias["@convex-dev/auth/react"] = local("./src/dev/fixtures/authReact.tsx");
  }

  const crawlerMetadata = {
    name: "visual-canvas-crawler-metadata",
    configureServer(server: import("vite").ViteDevServer) {
      if (fixtures || !env.VITE_CONVEX_URL) return;
      const siteOrigin = convexSiteOrigin(env.VITE_CONVEX_URL);
      server.middlewares.use(async (request, response, next) => {
        const host = request.headers.host ?? "localhost:5173";
        const url = new URL(request.url ?? "/", `http://${host}`);
        const imageMatch = /^\/s\/([^/]+)\/_social\/preview\.png$/.exec(url.pathname);
        if (imageMatch) {
          const slug = decodeURIComponent(imageMatch[1] as string);
          const metadataResponse = await fetch(`${siteOrigin}/social/${encodeURIComponent(slug)}`);
          if (!metadataResponse.ok) {
            response.statusCode = 404;
            response.end("Not found");
            return;
          }
          const metadata = (await metadataResponse.json()) as {
            version: number;
            thumbnail_url: string | null;
          };
          if (url.searchParams.get("v") && url.searchParams.get("v") !== String(metadata.version)) {
            response.statusCode = 404;
            response.end("Not found");
            return;
          }
          let bytes = await readFile(local("./public/social-fallback.png"));
          let type = "image/png";
          if (metadata.thumbnail_url) {
            const thumbnail = await fetch(metadata.thumbnail_url);
            const thumbnailType = thumbnail.headers.get("content-type") ?? "";
            if (thumbnail.ok && /^image\/(png|jpeg)$/.test(thumbnailType)) {
              bytes = Buffer.from(await thumbnail.arrayBuffer());
              type = thumbnailType;
            }
          }
          response.statusCode = 200;
          response.setHeader("content-type", type);
          response.setHeader("cache-control", "no-store");
          response.end(bytes);
          return;
        }
        const match = /^\/s\/([^/]+)\/?$/.exec(url.pathname);
        if (!match) return next();
        const slug = decodeURIComponent(match[1] as string);
        const metadataResponse = await fetch(`${siteOrigin}/social/${encodeURIComponent(slug)}`);
        if (!metadataResponse.ok) return next();
        const metadata = (await metadataResponse.json()) as {
          title: string;
          description: string;
          version: number;
          thumbnail_url: string | null;
        };
        const canonicalUrl = `${url.origin}/s/${encodeURIComponent(slug)}`;
        const template = await readFile(local("./index.html"), "utf8");
        let previewBytes = await readFile(local("./public/social-fallback.png"));
        let previewType = "image/png";
        if (metadata.thumbnail_url) {
          const thumbnail = await fetch(metadata.thumbnail_url);
          const thumbnailType = thumbnail.headers.get("content-type") ?? "";
          if (thumbnail.ok && /^image\/(png|jpeg)$/.test(thumbnailType)) {
            previewBytes = Buffer.from(await thumbnail.arrayBuffer());
            previewType = thumbnailType;
          }
        }
        const dimensions = rasterDimensions(previewBytes, previewType) ?? {
          width: 1730,
          height: 909,
        };
        const html = injectSocialMeta(await server.transformIndexHtml(url.pathname, template), {
          metadata,
          canonicalUrl,
          imageUrl: `${canonicalUrl}/_social/preview.png?v=${metadata.version}`,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        });
        response.statusCode = 200;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(html);
      });
    },
  };

  return {
    plugins: [crawlerMetadata, react()],
    server: { port: 5173 },
    resolve: { alias },
  };
});
