import { CanvasFileSchema, resolveCanvasPage } from "@visual-canvas/canvas";
import {
  type CanvasSnapshotTarget,
  canvasSnapshotEntryHtml,
} from "@visual-canvas/canvas/snapshot-entry.js";
import { THEME_CSS } from "@visual-canvas/canvas/theme-css.js";
import type { Theme } from "@visual-canvas/canvas/themes.js";
import {
  compileThemeToCssVariables,
  compileThemeToTailwindV4,
  resolveTheme,
} from "@visual-canvas/runtime/render/themes/index.js";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { httpAction } from "./_generated/server";
import { handleAgentGateway } from "./agentGateway";
// Aliased: the request handlers below bind a local `auth` for the verified
// bearer AuthInfo.
import { auth as convexAuth } from "./auth";
import { renderEmbedCard } from "./lib/embedCard";
import { embedPlaceholderPng } from "./lib/embedPlaceholder";
import { sha256Hex } from "./lib/hash";
import { getObject, presignObject } from "./lib/objectStore";

const http = httpRouter();

// Convex Auth's own endpoints (../auth.ts): the OAuth redirect, the Google
// callback, and the refresh-token exchange the SPA calls silently in the
// background. They live under /api/auth/*, separate from the private agent
// gateway and the public /s/:slug artifact route below.
convexAuth.addHttpRoutes(http);

http.route({
  path: "/agent-gateway",
  method: "POST",
  handler: httpAction(handleAgentGateway),
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
    "media-src 'self' blob:",
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
function scopeCanvasRootReferences(
  source: string,
  scopedBasePath: string,
  version?: number,
): string {
  const scoped = source
    .replace(
      /(["'`])\/(assets|src)\//g,
      (_match, quote: string, root: string) => `${quote}${scopedBasePath}/${root}/`,
    )
    .replace(
      /(url\(\s*)\/(assets|src)\//gi,
      (_match, start: string, root: string) => `${start}${scopedBasePath}/${root}/`,
    );
  if (version === undefined) return scoped;
  const escapedBase = scopedBasePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scoped.replace(new RegExp(`(${escapedBase}/(?:assets|src)/[^"'\`\\s)]+)`, "g"), (url) => {
    const hashAt = url.indexOf("#");
    const base = hashAt === -1 ? url : url.slice(0, hashAt);
    const fragment = hashAt === -1 ? "" : url.slice(hashAt);
    return `${base}${base.includes("?") ? "&" : "?"}v=${version}${fragment}`;
  });
}

async function prepareScopedCanvasBlob(
  blob: Blob,
  mimeType: string,
  scopedBasePath: string,
  bridgeNonce?: string,
  version?: number,
  theme?: Theme,
): Promise<Blob> {
  if (!bridgeNonce && !SCOPED_CANVAS_TEXT_MIME.test(mimeType)) return blob;
  let source = scopeCanvasRootReferences(await blob.text(), scopedBasePath, version);
  if (/^text\/html(?:;|$)/i.test(mimeType) && theme) {
    const themeJson = JSON.stringify(theme).replaceAll("<", "\\u003c");
    const nonceAttribute = bridgeNonce ? ` nonce="${bridgeNonce}"` : "";
    const bootstrap = `<style data-visual-canvas-theme>${compileThemeToCssVariables(theme)}</style><script${nonceAttribute}>window.visualCanvasTheme=${themeJson}</script>`;
    source = source.includes("</head>")
      ? source.replace("</head>", `${bootstrap}</head>`)
      : bootstrap + source;
  }
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

type EmbedRequest = {
  target: CanvasSnapshotTarget;
  targetLabel: string;
  pageId?: string;
  version?: number;
  scale: 1 | 2;
  padding: number;
};

const REGION_PATH =
  /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\.png$/;
const MAX_EMBED_REGION_PIXELS = 40_000_000;

function embedBadRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function parseEmbedRequest(segments: string[], url: URL): EmbedRequest | Response | null {
  if (segments[1] !== "_embed") return null;
  let target: CanvasSnapshotTarget;
  let targetLabel: string;
  if (segments.length === 3 && segments[2] === "canvas.png") {
    target = { type: "canvas" };
    targetLabel = "canvas";
  } else if (segments.length === 4 && segments[2] === "node" && segments[3]?.endsWith(".png")) {
    const nodeFilename = segments[3];
    if (!nodeFilename) return embedBadRequest("Invalid node id");
    const nodeId = decodeURIComponent(nodeFilename.slice(0, -4));
    if (!nodeId || nodeId.length > 500) return embedBadRequest("Invalid node id");
    target = { type: "node", nodeId };
    targetLabel = `node:${nodeId}`;
  } else if (segments.length === 4 && segments[2] === "region") {
    const regionFilename = segments[3];
    if (!regionFilename) return embedBadRequest("Invalid region; expected x-y-w-h.png");
    const match = REGION_PATH.exec(regionFilename);
    if (!match) return embedBadRequest("Invalid region; expected x-y-w-h.png");
    const x = Number(match[1]);
    const y = Number(match[2]);
    const width = Number(match[3]);
    const height = Number(match[4]);
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0) {
      return embedBadRequest("Region coordinates must be finite and non-negative");
    }
    if (width <= 0 || height <= 0) {
      return embedBadRequest("Region width and height must be positive");
    }
    target = { type: "region", x, y, width, height };
    targetLabel = `region:${x},${y},${width},${height}`;
  } else {
    return null;
  }

  const rawVersion = url.searchParams.get("v");
  const version = rawVersion === null ? undefined : Number(rawVersion);
  if (version !== undefined && (!Number.isSafeInteger(version) || version <= 0)) {
    return embedBadRequest("Invalid v; expected a positive published version number");
  }
  const rawScale = url.searchParams.get("scale");
  const scale = rawScale === null ? 2 : Number(rawScale);
  if (scale !== 1 && scale !== 2) return embedBadRequest("Invalid scale; expected 1 or 2");
  const rawPadding = url.searchParams.get("padding");
  const padding = rawPadding === null ? (target.type === "node" ? 24 : 0) : Number(rawPadding);
  if (!Number.isInteger(padding) || padding < 0 || padding > 256) {
    return embedBadRequest("Invalid padding; expected an integer from 0 to 256");
  }
  const pageId = url.searchParams.get("page") ?? undefined;
  if (pageId !== undefined && (!pageId || pageId.length > 200)) {
    return embedBadRequest("Invalid page id");
  }
  if (
    target.type === "region" &&
    target.width * scale * (target.height * scale) > MAX_EMBED_REGION_PIXELS
  ) {
    return embedBadRequest("Region exceeds the 40 megapixel render limit");
  }
  return { target, targetLabel, pageId, version, scale, padding };
}

function embedHeaders(pinned: boolean, etag?: string, downscaled = false): Headers {
  const headers = new Headers({
    "content-type": "image/png",
    "content-disposition": 'inline; filename="visual-canvas-embed.png"',
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "cross-origin",
    "access-control-allow-origin": "*",
    "cache-control": pinned
      ? "public, max-age=31536000, immutable"
      : "public, max-age=60, must-revalidate",
  });
  if (etag) headers.set("etag", `"${etag}"`);
  if (downscaled) headers.set("x-embed-downscaled", "1");
  return headers;
}

function transientEmbedResponse(): Response {
  return new Response(new Blob([embedPlaceholderPng()], { type: "image/png" }), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "cross-origin",
      "access-control-allow-origin": "*",
    },
  });
}

type PublicEmbedContext = {
  canvasId: Id<"canvases">;
  kind: "canvas" | "html" | "image" | "pdf";
  title: string;
  publicSlug: string;
  versionId: Id<"canvasVersions">;
  version: number;
  docStorageId?: Id<"_storage">;
  cssStorageId?: Id<"_storage">;
  entryStorageId?: Id<"_storage">;
  files: Array<{ relPath: string; storageId: Id<"_storage">; size: number }>;
  assets: Array<{ relPath: string; objectKey: string; size: number }>;
  themeId?: "clean-saas" | "minimal-docs" | "dark-terminal" | "startup-pitch";
  canvasBrand?: Parameters<typeof resolveTheme>[2];
  workspaceBrand?: Parameters<typeof resolveTheme>[1];
};

type WorkerSnapshotResult = {
  size: number;
  width: number;
  height: number;
  mimeType: "image/png";
  contentHash: string;
  uploadStatus: number;
  readiness: { status: "ready" | "partial"; warnings: string[] };
  downscaled: boolean;
};

async function callSnapshotWorker(body: unknown): Promise<WorkerSnapshotResult> {
  const rawUrl = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!rawUrl || !token) throw new Error("render worker is not configured");
  const origin = rawUrl.includes("://") ? rawUrl : `http://${rawUrl}:8080`;
  const response = await fetch(`${origin.replace(/\/$/, "")}/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as WorkerSnapshotResult | null;
  if (!response.ok || !result) throw new Error(`snapshot worker failed (${response.status})`);
  if (result.uploadStatus < 200 || result.uploadStatus >= 300) {
    throw new Error(`snapshot upload failed (${result.uploadStatus})`);
  }
  return result;
}

async function renderPublicEmbed(
  ctx: ActionCtx,
  context: PublicEmbedContext,
  request: EmbedRequest,
  objectKey: string,
): Promise<WorkerSnapshotResult> {
  if (context.kind !== "canvas" && context.kind !== "html") {
    throw new Error("unsupported_canvas_kind");
  }
  const resolvedFiles = await Promise.all(
    context.files.map(async (file) => {
      const getUrl = await ctx.storage.getUrl(file.storageId);
      return getUrl ? { relPath: file.relPath, getUrl } : null;
    }),
  );
  const sources = [
    ...resolvedFiles.filter(
      (source): source is { relPath: string; getUrl: string } => source !== null,
    ),
    ...(await Promise.all(
      context.assets.map(async (asset) => ({
        relPath: asset.relPath,
        getUrl: await presignObject(asset.objectKey, "GET", 3600),
      })),
    )),
  ];
  let entrypoint: string;
  let temporaryEntryStorageId: Id<"_storage"> | undefined;
  try {
    if (context.kind === "canvas") {
      if (!context.docStorageId) throw new Error("published CanvasDoc is unavailable");
      const docBlob = await ctx.storage.get(context.docStorageId);
      if (!docBlob) throw new Error("published CanvasDoc storage object is unavailable");
      const file = CanvasFileSchema.parse(JSON.parse(await docBlob.text()));
      const page = resolveCanvasPage(file, request.pageId);
      if (request.pageId && page.id !== request.pageId) throw new Error("page_not_found");
      if (request.target.type === "node") {
        const nodeId = request.target.nodeId;
        if (!page.doc.nodes.some((node) => node.id === nodeId)) {
          throw new Error("node_not_found");
        }
      }
      const cssBlob = context.cssStorageId ? await ctx.storage.get(context.cssStorageId) : null;
      const entry = canvasSnapshotEntryHtml(
        page.doc,
        cssBlob ? await cssBlob.text() : "",
        request.target,
        undefined,
        THEME_CSS,
      );
      temporaryEntryStorageId = await ctx.storage.store(new Blob([entry], { type: "text/html" }));
      const getUrl = await ctx.storage.getUrl(temporaryEntryStorageId);
      if (!getUrl) throw new Error("unable to stage published canvas entrypoint");
      entrypoint = "/src/__embed.html";
      sources.push({ relPath: entrypoint, getUrl });
    } else {
      if (request.pageId) throw new Error("page_not_found");
      if (request.target.type !== "canvas") throw new Error("unsupported_snapshot_target");
      const html = context.files.find((file) => file.relPath.endsWith(".html"));
      if (html) {
        entrypoint = html.relPath;
      } else if (context.entryStorageId) {
        const getUrl = await ctx.storage.getUrl(context.entryStorageId);
        if (!getUrl) throw new Error("published HTML entrypoint is unavailable");
        entrypoint = "/src/index.html";
        sources.push({ relPath: entrypoint, getUrl });
      } else {
        throw new Error("published HTML entrypoint is unavailable");
      }
    }
    const theme = resolveTheme(
      context.themeId ?? "clean-saas",
      context.workspaceBrand,
      context.canvasBrand,
    );
    let result: WorkerSnapshotResult | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      result = await callSnapshotWorker({
        sources,
        entrypoint,
        target: request.target,
        padding: request.padding,
        scale: request.scale,
        readinessTimeoutMs: 15_000,
        upload: { putUrl: await presignObject(objectKey, "PUT", 900), method: "PUT" },
        themeTailwindCss: compileThemeToTailwindV4(theme),
        themeRuntimeCss: compileThemeToCssVariables(theme),
        themeJson: JSON.stringify(theme),
      });
      if (result.readiness.status === "ready") break;
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (result?.readiness.status !== "ready") throw new Error("iframe_not_ready");
    return result;
  } finally {
    if (temporaryEntryStorageId) {
      await ctx.storage.delete(temporaryEntryStorageId).catch(() => undefined);
    }
  }
}

function embedNotFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readyEmbedResponse(
  request: Request,
  ready: {
    objectKey: string;
    contentHash: string;
    downscaled: boolean;
  },
  pinned: boolean,
): Promise<Response | null> {
  const headers = embedHeaders(pinned, ready.contentHash, ready.downscaled);
  if (request.headers.get("if-none-match") === `"${ready.contentHash}"`) {
    return new Response(null, { status: 304, headers });
  }
  try {
    const object = await getObject(ready.objectKey);
    if (!object.ok) return null;
    return new Response(await object.arrayBuffer(), { status: 200, headers });
  } catch {
    return null;
  }
}

async function publicEmbedAddressExists(
  ctx: ActionCtx,
  context: PublicEmbedContext,
  request: EmbedRequest,
): Promise<boolean> {
  if (context.kind === "html") return !request.pageId && request.target.type === "canvas";
  if (context.kind !== "canvas" || !context.docStorageId) return false;
  const blob = await ctx.storage.get(context.docStorageId);
  if (!blob) return false;
  const file = CanvasFileSchema.parse(JSON.parse(await blob.text()));
  const page = resolveCanvasPage(file, request.pageId);
  if (request.pageId && page.id !== request.pageId) return false;
  if (request.target.type !== "node") return true;
  const nodeId = request.target.nodeId;
  return page.doc.nodes.some((node) => node.id === nodeId);
}

async function handlePublicEmbed(
  ctx: ActionCtx,
  rawRequest: Request,
  publicSlug: string,
  embed: EmbedRequest,
): Promise<Response> {
  const startedAt = Date.now();
  const pinned = embed.version !== undefined;
  const context = (await ctx.runQuery(internal.embeds.resolvePublicContext, {
    publicSlug,
    version: embed.version,
  })) as PublicEmbedContext | null;
  if (!context) {
    console.warn("canvas_embed", {
      shareSlug: publicSlug,
      version: embed.version ?? null,
      target: embed.targetLabel,
      cacheHit: false,
      outcome: "not_found",
      durationMs: Date.now() - startedAt,
    });
    return embedNotFound();
  }
  const cacheKey = await sha256Hex(
    JSON.stringify({
      renderer: 4,
      canvasId: context.canvasId,
      version: context.version,
      pageId: embed.pageId ?? "default",
      target: embed.target,
      scale: embed.scale,
      padding: embed.padding,
    }),
  );
  const lookupArgs = { publicSlug, versionId: context.versionId, cacheKey };
  let ready = await ctx.runQuery(internal.embeds.getReady, lookupArgs);
  if (ready) {
    const response = await readyEmbedResponse(rawRequest, ready, pinned);
    if (response) {
      console.info("canvas_embed", {
        shareSlug: publicSlug,
        version: context.version,
        target: embed.targetLabel,
        cacheHit: true,
        durationMs: Date.now() - startedAt,
      });
      return response;
    }
  }
  try {
    if (!(await publicEmbedAddressExists(ctx, context, embed))) {
      console.warn("canvas_embed", {
        shareSlug: publicSlug,
        version: context.version,
        target: embed.targetLabel,
        cacheHit: false,
        outcome: "not_found",
        durationMs: Date.now() - startedAt,
      });
      return embedNotFound();
    }
  } catch (error) {
    console.error("canvas_embed", {
      shareSlug: publicSlug,
      version: context.version,
      target: embed.targetLabel,
      cacheHit: false,
      outcome: "validation_failed",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    return transientEmbedResponse();
  }

  const objectKey = `embeds/${context.canvasId}/v${context.version}/${cacheKey}.png`;
  let claim: { status: "claimed" | "pending" | "rate_limited"; retryAfter?: number };
  try {
    claim = await ctx.runMutation(internal.embeds.claimColdRender, {
      publicSlug,
      canvasId: context.canvasId,
      versionId: context.versionId,
      cacheKey,
      objectKey,
      now: Date.now(),
      force: ready !== null,
    });
  } catch {
    return embedNotFound();
  }
  if (claim.status === "pending") {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      ready = await ctx.runQuery(internal.embeds.getReady, lookupArgs);
      if (!ready) continue;
      const response = await readyEmbedResponse(rawRequest, ready, pinned);
      if (response) {
        console.info("canvas_embed", {
          shareSlug: publicSlug,
          version: context.version,
          target: embed.targetLabel,
          cacheHit: true,
          outcome: "joined_pending_render",
          durationMs: Date.now() - startedAt,
        });
        return response;
      }
    }
    console.warn("canvas_embed", {
      shareSlug: publicSlug,
      version: context.version,
      target: embed.targetLabel,
      cacheHit: false,
      outcome: "pending_timeout",
      durationMs: Date.now() - startedAt,
    });
    return transientEmbedResponse();
  }
  if (claim.status === "rate_limited") {
    console.warn("canvas_embed", {
      shareSlug: publicSlug,
      version: context.version,
      target: embed.targetLabel,
      cacheHit: false,
      outcome: "rate_limited",
      durationMs: Date.now() - startedAt,
    });
    return transientEmbedResponse();
  }

  try {
    const rendered = await renderPublicEmbed(ctx, context, embed, objectKey);
    await ctx.runMutation(internal.embeds.finishColdRender, {
      versionId: context.versionId,
      cacheKey,
      objectKey,
      contentHash: rendered.contentHash,
      size: rendered.size,
      width: rendered.width,
      height: rendered.height,
      downscaled: rendered.downscaled,
      renderDurationMs: Date.now() - startedAt,
    });
    // Re-resolve the share after the expensive render. A share revoked while
    // Chromium was running must not leak the just-produced bytes.
    const finished = await ctx.runQuery(internal.embeds.getReady, lookupArgs);
    if (!finished) return embedNotFound();
    const response = await readyEmbedResponse(rawRequest, finished, pinned);
    if (!response) throw new Error("rendered embed object is unavailable");
    console.info("canvas_embed", {
      shareSlug: publicSlug,
      version: context.version,
      target: embed.targetLabel,
      cacheHit: false,
      downscaled: rendered.downscaled,
      renderDurationMs: Date.now() - startedAt,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    await ctx.runMutation(internal.embeds.abandonColdRender, {
      versionId: context.versionId,
      cacheKey,
      objectKey,
    });
    const message = error instanceof Error ? error.message : String(error);
    if (
      message === "page_not_found" ||
      message === "node_not_found" ||
      message === "unsupported_snapshot_target" ||
      message === "unsupported_canvas_kind"
    ) {
      console.warn("canvas_embed", {
        shareSlug: publicSlug,
        version: context.version,
        target: embed.targetLabel,
        cacheHit: false,
        outcome: "not_found",
        durationMs: Date.now() - startedAt,
      });
      return embedNotFound();
    }
    console.error("canvas_embed", {
      shareSlug: publicSlug,
      version: context.version,
      target: embed.targetLabel,
      cacheHit: false,
      outcome: "render_failed",
      error: message,
      durationMs: Date.now() - startedAt,
    });
    return transientEmbedResponse();
  }
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
    const requestUrl = new URL(request.url);
    const slug = decodeURIComponent(requestUrl.pathname.slice("/social/".length));
    if (!slug || slug.includes("/")) return new Response("Not found", { status: 404 });
    const metadata = await ctx.runQuery(internal.canvases.resolvePublicSocialMetadata, {
      publicSlug: slug,
    });
    if (!metadata) return new Response("Not found", { status: 404 });
    let title = metadata.title;
    const pageId = requestUrl.searchParams.get("page");
    if (pageId && metadata.docStorageId) {
      try {
        const docUrl = await ctx.storage.getUrl(metadata.docStorageId);
        const response = docUrl ? await fetch(docUrl) : null;
        if (response?.ok) {
          const file = CanvasFileSchema.parse(await response.json());
          const page = file.pages.find((candidate) => candidate.id === pageId);
          if (page) title = `${metadata.title} — ${page.title}`;
        }
      } catch {
        // Metadata remains useful if a transient storage read cannot enrich the Page title.
      }
    }
    return Response.json(
      {
        title,
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
    const slug = segments[0] ? decodeURIComponent(segments[0]) : undefined;
    if (!slug) return new Response("Not found", { status: 404 });

    const embedRequest = parseEmbedRequest(segments, url);
    if (embedRequest instanceof Response) {
      console.warn("canvas_embed", {
        shareSlug: slug,
        version: url.searchParams.get("v"),
        target: segments.slice(2).join("/"),
        cacheHit: false,
        outcome: "invalid_parameters",
        durationMs: 0,
      });
      return embedRequest;
    }
    if (embedRequest) return handlePublicEmbed(ctx, request, slug, embedRequest);

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
    const rawVersion = url.searchParams.get("v");
    const version = rawVersion === null ? undefined : Number(rawVersion);
    if (version !== undefined && (!Number.isSafeInteger(version) || version <= 0)) {
      return new Response("Invalid version", { status: 400 });
    }

    const artifact = await ctx.runQuery(internal.canvases.resolvePublicArtifact, {
      publicSlug: slug,
      relPath,
      version,
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
          ? await presignObject(artifact.objectKey, "GET", 300)
          : await ctx.storage.getUrl(artifact.storageId);
      if (!directUrl) return new Response("Not found", { status: 404 });
      return Response.redirect(directUrl, 302);
    }

    let blob =
      typeof artifact.objectKey === "string"
        ? await (async () => {
            const response = await getObject(artifact.objectKey);
            return response.ok ? await response.blob() : null;
          })()
        : await ctx.storage.get(artifact.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    blob = await prepareScopedCanvasBlob(
      blob,
      artifact.mimeType,
      `/s/${slug}`,
      isIframe ? nonce : undefined,
      artifact.version,
      artifact.resolvedTheme,
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
            const response = await getObject(file.objectKey);
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
      undefined,
      file.resolvedTheme,
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
