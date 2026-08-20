/**
 * `/mcp` — the real remote MCP endpoint (PLAN.md section 6), replacing the
 * A1.0 spike's single unauthenticated `echo` tool now that the spike is
 * proven (see git history: "A1.0 SPIKE RESOLVED").
 *
 * Two zod majors coexist in this bundle by design — see ./mcp/tools.ts's
 * header comment. This file only touches the v4 one, via
 * `@modelcontextprotocol/server`'s own auth helpers.
 *
 * Auth: `requireBearerAuth` (the framework-free, fetch-native counterpart of
 * the SDK's Express middleware — see that package's
 * dist/createMcpHandler-*.d.mts) gates every request before the JSON-RPC
 * body is ever parsed. The verifier hashes the raw token, looks up
 * `mcpTokens` by that hash (see ./tokens.ts), and rejects unknown/revoked/
 * expired tokens with a spec-correct 401 + `WWW-Authenticate` challenge —
 * `verifyBearerToken` also rejects any `AuthInfo` missing `expiresAt`, so a
 * verifier that forgets to set it fails closed, not open.
 *
 * Per-request factory: `createMcpHandler`'s factory runs once per HTTP
 * request (see McpServerFactory's doc comment) and receives the verified
 * `AuthInfo` via `McpRequestContext.authInfo` — the SDK's documented way to
 * build multi-tenant servers keyed off the caller's identity, so no
 * module-level session/principal state is needed.
 */

import {
  type AuthInfo,
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { httpAction } from "./_generated/server";
// Aliased: the request handlers below bind a local `auth` for the verified
// bearer AuthInfo.
import { auth as convexAuth } from "./auth";
import { renderEmbedCard } from "./lib/embedCard";
import { sha256Hex } from "./lib/hash";
import { getObject, presignObject } from "./lib/objectStore";
import { buildInstructions } from "./mcp/instructions";
import { type McpPrincipal, registerResources, registerTools } from "./mcp/tools";

function principalFromAuthInfo(authInfo: AuthInfo | undefined): McpPrincipal {
  const extra = authInfo?.extra;
  if (!extra) {
    throw new Error("MCP request reached the tool factory without a verified principal");
  }
  return {
    userId: extra.userId as Id<"users">,
    tokenId: extra.tokenId as Id<"mcpTokens">,
    email: extra.email as string,
  };
}

function buildVerifier(ctx: ActionCtx): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const tokenHash = await sha256Hex(token);
      const principal = await ctx.runQuery(internal.tokens.verify, { tokenHash, now: Date.now() });
      if (!principal) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid, revoked, or expired token");
      }
      // Awaited — an unawaited action promise can be dropped once the
      // action returns, which would make lastUsedAt silently unreliable.
      await ctx.scheduler.runAfter(0, internal.tokens.touchLastUsed, {
        tokenId: principal.tokenId,
      });
      return {
        token,
        clientId: principal.userId,
        scopes: ["mcp"],
        expiresAt: Math.floor(principal.expiresAt / 1000),
        extra: { userId: principal.userId, tokenId: principal.tokenId, email: principal.email },
      };
    },
  };
}

const http = httpRouter();

// Convex Auth's own endpoints (../auth.ts): the OAuth redirect, the Google
// callback, and the refresh-token exchange the SPA calls silently in the
// background. They live under /api/auth/*, so they cannot collide with /mcp
// or the public /s/:slug artifact route below.
convexAuth.addHttpRoutes(http);

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const gate = requireBearerAuth({ verifier: buildVerifier(ctx) });
    const auth = await gate(request);
    if (auth instanceof Response) return auth;

    const mcpHandler = createMcpHandler((reqCtx) => {
      // `instructions` is how a server explains itself once, instead of
      // repeating the addressing rules in all six tool descriptions — and it
      // replaces the v1 descriptions' citations of "PLAN.md section 7", a
      // file the caller has no way to read.
      const server = new McpServer(
        { name: "visual-canvas", version: "2.0.0" },
        { instructions: buildInstructions() },
      );
      registerTools(server, ctx, principalFromAuthInfo(reqCtx.authInfo));
      registerResources(server);
      return server;
    });

    return mcpHandler.fetch(request, { authInfo: auth });
  }),
});

// Stay under the httpAction response cap (20 MiB) with margin for headers —
// PLAN.md Part 1 section 8: above this, PNG/PDF redirect to a direct
// *.convex.cloud storage URL instead of streaming through this action.
const PUBLIC_ARTIFACT_INLINE_LIMIT = 18 * 1024 * 1024;

// Deliberately allows the Tailwind CDN and Google Fonts (PLAN.md Part 1
// section 8/10.2): the reference osago artifact this product exists to host
// loads both, and a stricter default-deny would render it unstyled.
// `frame-ancestors` widens to the SPA's own origin once SPA_ORIGIN is set —
// until then this equals "no embedding at all", which is the safe default,
// not a broken one.
function publicArtifactCsp(): string {
  const spaOrigin = process.env.SPA_ORIGIN;
  const frameAncestors = spaOrigin ? `'self' ${spaOrigin}` : "'self'";
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function iframeCsp(nonce: string): string {
  const spaOrigin = process.env.SPA_ORIGIN;
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'none'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    `frame-ancestors ${spaOrigin ? `'self' ${spaOrigin}` : "'self'"}`,
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

function iframeBridge(nonce: string): string {
  return `<script nonce="${nonce}">(function(){const send=(state,detail)=>parent.postMessage({type:'visual-canvas:readiness',state,detail},'*');const style=document.createElement('style');style.textContent='html[data-visual-canvas-suspended] *,html[data-visual-canvas-suspended] *::before,html[data-visual-canvas-suspended] *::after{animation-play-state:paused!important}';document.head.appendChild(style);addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='visual-canvas:lifecycle'||!['suspend','resume'].includes(e.data.state))return;const suspended=e.data.state==='suspend';document.documentElement.toggleAttribute('data-visual-canvas-suspended',suspended);window.visualCanvasSuspended=suspended;dispatchEvent(new CustomEvent(suspended?'visual-canvas:suspend':'visual-canvas:resume'));parent.postMessage({type:'visual-canvas:lifecycle-ack',state:suspended?'suspended':'active'},'*')});addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();parent.postMessage({type:'visual-canvas:escape'},'*')}});Promise.all([document.fonts?document.fonts.ready:Promise.resolve(),Promise.all(Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise((r,j)=>{i.addEventListener('load',r,{once:true});i.addEventListener('error',()=>j(new Error('image '+i.src)),{once:true})}))),window.visualCanvasScreenReady||Promise.resolve()]).then(()=>send('ready')).catch(e=>send('partial',String(e&&e.message||e)));})();</script>`;
}

const SCOPED_CANVAS_TEXT_MIME =
  /^(?:text\/(?:html|css|javascript)|application\/javascript)(?:;|$)/i;

/**
 * Canvas paths beginning with `/assets/` or `/src/` are workspace-root
 * relative by contract. The browser instead treats them as origin-root
 * relative, which drops the `/i/:capability` or `/s/:slug` scope and turns a
 * valid versioned resource into a 404. Scope quoted references (HTML, JS and
 * quoted CSS URLs) plus the common unquoted CSS url(...) form while leaving
 * remote URLs such as https://cdn.example/assets/x.png untouched.
 */
function scopeCanvasRootReferences(source: string, scopedBasePath: string): string {
  return source
    .replace(
      /(["'`])\/(assets|src)\//g,
      (_match, quote: string, root: string) => `${quote}${scopedBasePath}/${root}/`,
    )
    .replace(
      /(url\(\s*)\/(assets|src)\//gi,
      (_match, start: string, root: string) => `${start}${scopedBasePath}/${root}/`,
    );
}

async function prepareScopedCanvasBlob(
  blob: Blob,
  mimeType: string,
  scopedBasePath: string,
  bridgeNonce?: string,
): Promise<Blob> {
  if (!bridgeNonce && !SCOPED_CANVAS_TEXT_MIME.test(mimeType)) return blob;
  let source = scopeCanvasRootReferences(await blob.text(), scopedBasePath);
  if (bridgeNonce) {
    source = source.includes("</body>")
      ? source.replace("</body>", `${iframeBridge(bridgeNonce)}</body>`)
      : source + iframeBridge(bridgeNonce);
  }
  return new Blob([source], { type: mimeType });
}

const EMBED_PREVIEW_INLINE_LIMIT = 2 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function embedPreviewDataUrl(
  ctx: ActionCtx,
  storageId: Id<"_storage"> | undefined,
): Promise<string | undefined> {
  if (!storageId) return undefined;
  const blob = await ctx.storage.get(storageId);
  if (
    !blob ||
    blob.size > EMBED_PREVIEW_INLINE_LIMIT ||
    !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)
  ) {
    return undefined;
  }
  return `data:${blob.type};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

function embedCardHeaders(pinned: boolean): Headers {
  return new Headers({
    "content-type": "image/svg+xml; charset=utf-8",
    "content-disposition": 'inline; filename="visual-canvas-preview.svg"',
    "content-security-policy":
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "cross-origin",
    "access-control-allow-origin": "*",
    "cache-control": pinned
      ? "public, max-age=31536000, immutable"
      : "public, max-age=60, stale-while-revalidate=300",
  });
}

// Private canvases and revoked slugs deliberately collapse to the same 404.
// The SPA production server consumes this endpoint server-to-server to build
// crawler-visible metadata without exposing any authenticated query surface.
http.route({
  pathPrefix: "/social/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/social/".length));
    if (!slug || slug.includes("/")) return new Response("Not found", { status: 404 });
    const metadata = await ctx.runQuery(internal.canvases.resolvePublicSocialMetadata, {
      publicSlug: slug,
    });
    if (!metadata) return new Response("Not found", { status: 404 });
    return Response.json(
      {
        title: metadata.title,
        description: metadata.description,
        version: metadata.version,
        updated_at: metadata.updatedAt,
        thumbnail_url: metadata.thumbnailStorageId
          ? await ctx.storage.getUrl(metadata.thumbnailStorageId)
          : null,
      },
      {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "access-control-allow-origin": process.env.SPA_ORIGIN ?? "null",
        },
      },
    );
  }),
});

// `GET /s/:slug` and `/s/:slug/*` — anonymous, cookieless artifact serving
// (PLAN.md Part 1 section 8). Convex's httpRouter has no named-param
// syntax (see convex/server's RouteSpec: only exact `path` or
// `pathPrefix`), so the slug/relPath split happens by hand below.
http.route({
  pathPrefix: "/s/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const segments = url.pathname
      .slice("/s/".length)
      .split("/")
      .filter((s) => s.length > 0);
    const slug = segments[0];
    if (!slug) return new Response("Not found", { status: 404 });

    // Static GitHub/Markdown preview image. It deliberately lives under the
    // existing public slug so Make private / Replace link revokes cards and
    // share links together. This is an image endpoint, not an iframe viewer.
    if (segments[1] === "_embed" && segments[2] === "card.svg" && segments.length === 3) {
      const rawTarget = url.searchParams.get("target") ?? "canvas";
      if (rawTarget !== "canvas" && rawTarget !== "node" && rawTarget !== "artifact") {
        return new Response("Invalid embed target", { status: 400 });
      }
      const targetId = url.searchParams.get("id") ?? undefined;
      if (targetId && targetId.length > 500)
        return new Response("Invalid target id", { status: 400 });
      const rawVersion = url.searchParams.get("version");
      const version = rawVersion === null ? undefined : Number(rawVersion);
      if (version !== undefined && (!Number.isSafeInteger(version) || version <= 0)) {
        return new Response("Invalid version", { status: 400 });
      }

      const card = await ctx.runQuery(internal.canvases.resolvePublicEmbedCard, {
        publicSlug: slug,
        target: rawTarget,
        targetId,
        version,
      });
      if (!card) return new Response("Not found", { status: 404 });
      const imageDataUrl = await embedPreviewDataUrl(ctx, card.previewStorageId);
      return new Response(renderEmbedCard({ ...card, imageDataUrl }), {
        status: 200,
        headers: embedCardHeaders(version !== undefined),
      });
    }

    const relPath = segments.length > 1 ? `/${segments.slice(1).join("/")}` : undefined;

    const artifact = await ctx.runQuery(internal.canvases.resolvePublicArtifact, {
      publicSlug: slug,
      relPath,
    });
    if (!artifact) return new Response("Not found", { status: 404 });

    const nonce = crypto.randomUUID().replaceAll("-", "");
    const isIframe = artifact.iframe === true;
    const headers = new Headers({
      "content-security-policy": isIframe ? iframeCsp(nonce) : publicArtifactCsp(),
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=60",
    });
    if (isIframe || pathIsIframeSubresource(artifact.relPath))
      headers.set("access-control-allow-origin", "*");

    // An SVG is an active document — never served inline on a shared origin.
    if (artifact.type === "svg" && !("libraryAsset" in artifact && artifact.libraryAsset)) {
      const filename = artifact.relPath.split("/").pop() ?? "artifact.svg";
      headers.set("content-disposition", `attachment; filename="${filename}"`);
    }

    const oversized = artifact.size > PUBLIC_ARTIFACT_INLINE_LIMIT;
    if (oversized) {
      const directUrl =
        typeof artifact.objectKey === "string"
          ? await presignObject("delivery", artifact.objectKey, "GET", 300)
          : await ctx.storage.getUrl(artifact.storageId);
      if (!directUrl) return new Response("Not found", { status: 404 });
      return Response.redirect(directUrl, 302);
    }

    let blob =
      typeof artifact.objectKey === "string"
        ? await (async () => {
            const response = await getObject("delivery", artifact.objectKey);
            return response.ok ? await response.blob() : null;
          })()
        : await ctx.storage.get(artifact.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    blob = await prepareScopedCanvasBlob(
      blob,
      artifact.mimeType,
      `/s/${slug}`,
      isIframe ? nonce : undefined,
    );
    headers.set("content-type", artifact.mimeType);
    return new Response(blob, { status: 200, headers });
  }),
});

http.route({
  pathPrefix: "/i/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const parts = new URL(request.url).pathname.slice(3).split("/").filter(Boolean);
    const token = parts.shift();
    if (!token || parts.length === 0) return new Response("Not found", { status: 404 });
    const relPath = `/${parts.join("/")}`;
    const file = await ctx.runQuery(internal.canvases.resolveIframeCapability, {
      token,
      relPath,
      now: Date.now(),
    });
    if (!file) return new Response("Not found", { status: 404 });
    let blob =
      typeof file.objectKey === "string"
        ? await (async () => {
            const response = await getObject("delivery", file.objectKey);
            return response.ok ? await response.blob() : null;
          })()
        : await ctx.storage.get(file.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    const nonce = crypto.randomUUID().replaceAll("-", "");
    blob = await prepareScopedCanvasBlob(
      blob,
      file.mimeType,
      `/i/${token}`,
      file.iframe ? nonce : undefined,
    );
    return new Response(blob, {
      headers: {
        "content-type": file.mimeType,
        "content-security-policy": iframeCsp(nonce),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "access-control-allow-origin": "*",
      },
    });
  }),
});

function pathIsIframeSubresource(relPath: string): boolean {
  // Sandboxed iframe documents intentionally have an opaque origin because
  // they do not receive allow-same-origin. Fonts therefore require CORS
  // even though their URL is on the same host as the iframe entrypoint.
  return relPath.startsWith("/src/screens/") || relPath.startsWith("/assets/");
}

export default http;
