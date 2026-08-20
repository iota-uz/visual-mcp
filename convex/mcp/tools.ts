/**
 * The MCP surface is split between canvas lifecycle, incremental editing,
 * and the reusable Asset Library.
 *
 * v1's tools mirrored the data model one verb at a time — create_workspace,
 * create_canvas, write_file, render_file, publish_canvas, get_canvas — so
 * shipping a single deliverable took six round trips and *still* did not
 * return a URL a human could open. v2 moves the expressiveness into the
 * arguments instead: `canvas_save` alone creates the workspace and canvas,
 * writes files, renders, publishes, and hands back real links.
 *
 * Design rules this file follows, each from an observed v1 failure:
 *
 *   - One `ref` addresses everything (../lib/ref.ts). No more juggling
 *     workspace_id + canvas_id + slug.
 *   - Writes are idempotent. A retried call updates; it does not mint
 *     `osago-2`.
 *   - Every result carries fully-qualified URLs (../lib/urls.ts).
 *   - Bytes stay out of JSON-RPC. `canvas_upload_url` hands back a URL the
 *     client POSTs to directly; only the handle travels in the tool call.
 *   - Nothing fails silently. `status: "partial"` plus a typed `warnings[]`
 *     reports renders that failed, assets that did not resolve, lists that
 *     were truncated, and upserts that landed on someone else's canvas.
 *   - Results are structured. Every tool declares an `outputSchema` and
 *     returns `structuredContent`, instead of pretty-printed JSON inside a
 *     text blob the caller has to re-parse.
 *
 * Two zod majors are in play here on purpose (see ../http.ts's header
 * comment): tool schemas use zod v4 (this file's `z` import, which resolves
 * to root's zod@4 — what `@modelcontextprotocol/server` itself requires),
 * while `CanvasDocSchema` comes from `@visual-canvas/canvas` and validates
 * with its own bundled zod v3. Never mix the two schema objects.
 */

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { layoutCanvas } from "@visual-canvas/canvas/layout.js";
import { applyCanvasDocPatch, type CanvasDocPatchOperation } from "@visual-canvas/canvas/patch.js";
import { renderCanvas } from "@visual-canvas/canvas/render.js";
import { THEME_CSS } from "@visual-canvas/canvas/theme-css.js";
import type { CanvasDoc } from "@visual-canvas/canvas/types.js";
import { CanvasDocSchema } from "@visual-canvas/canvas/types.js";
import { normalizeCanvasPath } from "@visual-canvas/runtime/paths/index.js";
import {
  getTemplate,
  listTemplates as templateRegistryList,
} from "@visual-canvas/runtime/templates/index.js";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { fetchAssetImport, persistAsset } from "../assets";
import { inferArtifactInfo } from "../lib/artifactInfo";
import { ASSET_MAX_BYTES, ASSET_MIME_TYPES } from "../lib/assetSecurity";
import { sha256Hex, sha256HexBytes } from "../lib/hash";
import { deleteObject, getObject, presignObject } from "../lib/objectStore";
import { slugify } from "../lib/slug";
import {
  canvasUrl,
  embedCardUrl,
  embedTargetUrl,
  githubEmbedMarkdown,
  shareUrl,
} from "../lib/urls";
import { callWorker, extractStorageId, getWorkerConfig } from "../lib/worker";
import { applyExactEdit, type PreparedPatchChange, prepareApplyPatch } from "./editEngine";

export interface McpPrincipal {
  userId: Id<"users">;
  tokenId: Id<"mcpTokens">;
  email: string;
}

/* ------------------------------------------------------------------------
 * Result plumbing
 * ---------------------------------------------------------------------- */

type WarningCode =
  | "unresolved_asset"
  | "overwrote_other_author"
  | "truncated"
  | "render_failed"
  | "quota_near_limit"
  | "upload_pool_exhausted";

interface Warning {
  code: WarningCode;
  message: string;
  path?: string;
}

const WarningSchema = z.object({
  code: z.enum([
    "unresolved_asset",
    "overwrote_other_author",
    "truncated",
    "render_failed",
    "quota_near_limit",
    "upload_pool_exhausted",
  ]),
  message: z.string(),
  path: z.string().optional(),
});

const StorageSchema = z.object({ used_bytes: z.number(), quota_bytes: z.number() });

/**
 * Every success returns both a human-readable text block and machine-readable
 * `structuredContent`. The text block stays because plenty of clients still
 * only surface text; the structured half is what a caller should actually
 * program against.
 */
function result(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)),
    );
  }
  return btoa(binary);
}

/**
 * Turns a thrown value into a message worth reading. v1 joined zod issue
 * messages and *dropped the paths*, so a 40-node CanvasDoc that failed
 * validation reported `"<script> elements are not allowed"` without ever
 * naming the offending node. The path is the only part that makes it fixable.
 */
function describeError(err: unknown): string {
  if (err && typeof err === "object" && Array.isArray((err as { issues?: unknown }).issues)) {
    const issues = (err as { issues: { message: string; path?: (string | number)[] }[] }).issues;
    return issues
      .map((issue) => {
        const path = issue.path?.length ? issue.path.join(".") : null;
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return { content: [{ type: "text", text: describeError(err) }], isError: true };
  }
}

/* ------------------------------------------------------------------------
 * Shared helpers
 * ---------------------------------------------------------------------- */

/** Signed download URLs for every file a canvas has (the worker's `sources`). */
async function resolveCanvasSources(
  ctx: ActionCtx,
  canvasId: Id<"canvases">,
): Promise<Array<{ relPath: string; getUrl: string }>> {
  const files = await ctx.runQuery(internal.canvases.listFilesForCanvas, { canvasId });
  const [resolved, assetSources] = await Promise.all([
    Promise.all(
      files.map(async (f) => {
        const getUrl = await ctx.storage.getUrl(f.storageId);
        return getUrl ? { relPath: f.relPath, getUrl } : null;
      }),
    ),
    ctx.runQuery(internal.canvases.listAssetSourcesForCanvas, { canvasId }),
  ]);
  const assets = await Promise.all(
    assetSources.map(async (asset) => ({
      relPath: asset.relPath,
      getUrl: await presignObject("delivery", asset.objectKey, "GET", 3600),
    })),
  );
  return [
    ...resolved.filter((source): source is { relPath: string; getUrl: string } => source !== null),
    ...assets,
  ];
}

/** Server-side fetch cap for `FileInput.url`, so one call can't pull a DVD in. */
const URL_FETCH_LIMIT_BYTES = 25 * 1024 * 1024;

const FileInputSchema = z.object({
  path: z
    .string()
    .describe('Workspace path: /src/…, /assets/… or /output/…, e.g. "/assets/logo.png".'),
  text: z.string().optional().describe("Inline UTF-8 content. Use for small text files only."),
  upload_id: z
    .string()
    .optional()
    .describe("storageId returned by canvas_upload_url. The way to attach large or binary files."),
  url: z.string().optional().describe("Public URL for the server to fetch the bytes from."),
  asset_ref: z
    .string()
    .optional()
    .describe("Immutable asset:// ref from asset_list. Mounts it without uploading bytes again."),
  delete: z.boolean().optional().describe("Delete this path instead of writing it."),
});

type FileInput = z.infer<typeof FileInputSchema>;

/**
 * Static scan for references a render would silently 404 on.
 *
 * This is the cheap half of the unresolved-asset story (the worker reports
 * the runtime half from Chromium). It exists because a production canvas
 * shipped with a broken `url("./myid-face-camera-v1.png")` in a CSS block and
 * *nothing anywhere* said a word — the render "succeeded" with a missing
 * image. Only same-origin relative refs are checked; absolute URLs and
 * `data:` URIs are none of our business.
 */
const REF_PATTERN = /(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi;

/**
 * Resolves a reference the way a browser does — against the *directory of
 * the file that made it*, not against the canvas root. `/src/index.html`
 * pointing at `../assets/logo.png` means `/assets/logo.png`; treating the
 * reference as root-relative produced the nonsense path `/../assets/logo.png`,
 * which matched no file, so every correct `../assets/...` reference was
 * reported as broken. Returns null for a path that climbs past the root,
 * which can never name a canvas file.
 */
function resolveRef(fromFile: string, raw: string): string | null {
  const segments = raw.startsWith("/")
    ? []
    : fromFile
        .replace(/\/[^/]*$/, "")
        .split("/")
        .filter(Boolean);
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? `/${segments.join("/")}` : null;
}

/** Collapses warnings that name the same problem — the static scan and the
 * renderer's own failed-request report overlap by design, and a caller does
 * not need to be told twice that one image is missing. */
function dedupeWarnings(warnings: Warning[]): Warning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.code} ${w.path ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scanUnresolvedRefs(
  writtenText: Array<{ path: string; text: string }>,
  knownPaths: Set<string>,
): Warning[] {
  const warnings: Warning[] = [];
  const seen = new Set<string>();

  for (const file of writtenText) {
    for (const match of file.text.matchAll(REF_PATTERN)) {
      const raw = (match[1] ?? match[2] ?? "").trim();
      if (!raw) continue;
      // Dynamic template expressions are resolved by the screen runtime;
      // treating their source text as a literal filename is a false positive.
      if (raw.includes("${")) continue;
      // Absolute, protocol-relative, data/blob URIs and anchors are external.
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:)/i.test(raw)) continue;

      const normalized = resolveRef(file.path, raw.split("?")[0]?.split("#")[0] ?? raw);
      if (!normalized || knownPaths.has(normalized)) continue;
      // The worker vendors this one itself; it is never a canvas file.
      if (normalized === "/assets/js/apexcharts.min.js") continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      warnings.push({
        code: "unresolved_asset",
        path: normalized,
        message:
          `${file.path} references "${raw}", which this canvas does not contain. ` +
          "It will be missing in the render. Upload it with canvas_upload_url, " +
          "or use an absolute URL.",
      });
    }
  }
  return warnings;
}

/**
 * Resolves one `FileInput` to bytes and writes it. Returns null for deletes.
 *
 * The three input modes exist because the alternatives all failed in
 * practice: `text` alone forced a 3.5MB document through a JSON-RPC argument
 * (which meant hand-rolling a raw HTTP call to get it in at all), and there
 * was no binary path whatsoever, so images had to be base64-inlined into the
 * HTML — tripling the payload and burning the caller's context.
 */
async function writeOneFile(
  ctx: ActionCtx,
  canvasId: Id<"canvases">,
  userId: Id<"users">,
  file: FileInput,
): Promise<{ path: string; size_bytes: number } | null> {
  const { relPath, displayPath } = normalizeCanvasPath(file.path, "write", "path");

  if (file.delete) {
    await ctx.runMutation(internal.canvases.removeAssetBinding, {
      canvasId,
      logicalPath: displayPath,
    });
    await ctx.runMutation(internal.canvases.removeByRef, {
      ref: canvasId,
      target: "file",
      path: displayPath,
    });
    return null;
  }

  const provided = [file.text !== undefined, !!file.upload_id, !!file.url, !!file.asset_ref].filter(
    Boolean,
  ).length;
  if (provided !== 1) {
    throw new Error(
      `File "${file.path}" needs exactly one of text, upload_id, url or asset_ref (got ${provided}).`,
    );
  }

  const { mime } = inferArtifactInfo(relPath);

  if (file.asset_ref) {
    const asset = await ctx.runQuery(internal.assets.resolveRef, {
      ref: file.asset_ref,
      userId,
    });
    await ctx.runMutation(internal.canvases.upsertAssetBinding, {
      canvasId,
      logicalPath: displayPath,
      assetId: asset.assetId,
      assetVersionId: asset.assetVersionId,
    });
    return { path: displayPath, size_bytes: asset.size };
  }

  // Already-uploaded blob: nothing to move, just verify and attach.
  if (file.upload_id) {
    const storageId = file.upload_id as Id<"_storage">;
    const attachment = await ctx.runQuery(internal.canvases.storageAttachment, { storageId });
    // Same blob, same canvas, same path — a replayed call, not aliasing.
    // Re-attaching would be a no-op anyway, so short-circuit and let the
    // retry report the file as written, which it is.
    const isReplay =
      attachment !== null &&
      attachment.scope === "file" &&
      attachment.canvasId === canvasId &&
      attachment.relPath === displayPath;
    if (attachment && !isReplay) {
      throw new Error(
        `upload_id "${file.upload_id}" is already attached to ${attachment.relPath}` +
          `${attachment.canvasId === canvasId ? " on this canvas" : " on another canvas"}. ` +
          "Request a fresh URL from canvas_upload_url for each file you write.",
      );
    }
    if (isReplay) {
      return { path: displayPath, size_bytes: attachment.size };
    }
    const metadata = await ctx.storage.getMetadata(storageId);
    if (!metadata) {
      throw new Error(
        `upload_id "${file.upload_id}" does not exist. Upload the bytes to the URL from ` +
          "canvas_upload_url first, then pass the storageId it returns.",
      );
    }
    await ctx.runMutation(internal.canvases.upsertFile, {
      canvasId,
      relPath: displayPath,
      storageId,
      size: metadata.size,
      contentHash: metadata.sha256,
    });
    return { path: displayPath, size_bytes: metadata.size };
  }

  let blob: Blob;
  let size: number;
  let hash: string;

  if (file.url) {
    const res = await fetch(file.url);
    if (!res.ok) {
      throw new Error(`Fetching "${file.url}" failed: HTTP ${res.status} ${res.statusText}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > URL_FETCH_LIMIT_BYTES) {
      throw new Error(
        `"${file.url}" is ${buf.byteLength} bytes, over the ${URL_FETCH_LIMIT_BYTES}-byte fetch limit.`,
      );
    }
    blob = new Blob([buf], { type: res.headers.get("content-type") ?? mime });
    size = buf.byteLength;
    hash = await sha256HexBytes(buf);
  } else {
    const text = file.text as string;
    const bytes = new TextEncoder().encode(text);
    blob = new Blob([bytes], { type: mime });
    size = bytes.byteLength;
    hash = await sha256Hex(text);
  }

  const storageId = await ctx.storage.store(blob);
  try {
    await ctx.runMutation(internal.canvases.upsertFile, {
      canvasId,
      relPath: displayPath,
      storageId,
      size,
      contentHash: hash,
    });
  } catch (err) {
    // The mutation rejected (quota, most likely). Don't leak the blob.
    await ctx.storage.delete(storageId);
    throw err;
  }
  return { path: displayPath, size_bytes: size };
}

const RenderInputSchema = z.object({
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("canvas") }),
    z.object({
      type: z.literal("file"),
      entrypoint: z.string().describe('Source file to render, e.g. "/src/index.html".'),
    }),
  ]),
  format: z.enum(["png", "svg", "pdf", "html"]),
  output_path: z
    .string()
    .optional()
    .describe("Where to write the result. Derived from entrypoint + format when omitted."),
  primary: z
    .boolean()
    .optional()
    .describe(
      "Mark this render as the canvas's face — what /s/:slug serves and what the thumbnail " +
        "comes from. Declare it explicitly rather than relying on render order.",
    ),
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      device_scale_factor: z.number().positive().optional(),
    })
    .optional(),
  pdf: z
    .object({
      format: z.enum(["A4", "A3", "Letter"]).optional(),
      orientation: z.enum(["portrait", "landscape"]).optional(),
      print_background: z.boolean().optional(),
      display_header_footer: z.boolean().optional(),
      header_template: z.string().optional(),
      footer_template: z.string().optional(),
      margin: z
        .object({
          top: z.string().optional(),
          right: z.string().optional(),
          bottom: z.string().optional(),
          left: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

type RenderInput = z.infer<typeof RenderInputSchema>;

interface RenderedArtifact {
  path: string;
  format: string;
  role: "primary" | "supporting";
  size_bytes: number;
  mime_type: string;
  raw_url: string | null;
}

/** Derives an output path when the caller didn't name one. */
function deriveOutputPath(entrypoint: string, format: RenderInput["format"]): string {
  const base = entrypoint.replace(/^.*\//, "").replace(/\.[^.]+$/, "") || "output";
  return `/output/${base}.${format}`;
}

/**
 * One render, worker round trip included. Returns either the artifact or a
 * warning — a failed render never throws, because the caller's content has
 * already been committed by the time renders run and losing that would be
 * far worse than shipping without a PNG.
 */
async function performRender(
  ctx: ActionCtx,
  canvasId: Id<"canvases">,
  principal: McpPrincipal,
  spec: RenderInput,
): Promise<{ artifact?: RenderedArtifact; warnings: Warning[] }> {
  const warnings: Warning[] = [];
  const entrypoint = spec.target.type === "canvas" ? "/src/__canvas.html" : spec.target.entrypoint;
  const outputPath = spec.output_path ?? deriveOutputPath(entrypoint, spec.format);
  // Normalized here, not just in the worker: v1 shipped the caller's raw
  // string through, so `output_path: "output/x.png"` (no leading slash)
  // recorded an artifact that /s/:slug could never serve and the /cache TTL
  // cron never swept.
  const { displayPath } = normalizeCanvasPath(outputPath, "render-output", "output_path");
  const started = Date.now();

  try {
    // Caller input is validated before infrastructure is touched: v1 let a
    // typo'd entrypoint reach Chromium and come back as an ENOENT-shaped
    // worker 500, and checking the worker config first would mask the far
    // more actionable "that file isn't here" with "the worker is down".
    const sources = await resolveCanvasSources(ctx, canvasId);
    if (!sources.some((s) => s.relPath === entrypoint)) {
      throw new Error(
        `Entrypoint "${entrypoint}" is not a file on this canvas. ` +
          `Files present: ${sources.map((s) => s.relPath).join(", ") || "(none)"}`,
      );
    }

    const config = getWorkerConfig();
    const putUrl = await ctx.storage.generateUploadUrl();
    const thumbnailPutUrl =
      spec.format === "png" ? await ctx.storage.generateUploadUrl() : undefined;

    const workerResult = await callWorker<{
      relPath: string;
      size: number;
      mimeType: string;
      uploadStatus: number;
      uploadBody: unknown;
      thumbnail?: { uploadStatus: number; uploadBody: unknown };
      unresolvedRefs?: string[];
      readiness?: { status: "ready" | "partial"; warnings: string[] };
    }>(config, "/render", {
      sources,
      entrypoint,
      outputPath: displayPath,
      format: spec.format,
      viewport: spec.viewport
        ? {
            width: spec.viewport.width,
            height: spec.viewport.height,
            deviceScaleFactor: spec.viewport.device_scale_factor,
          }
        : undefined,
      pdf: spec.pdf
        ? {
            format: spec.pdf.format,
            orientation: spec.pdf.orientation,
            printBackground: spec.pdf.print_background,
            displayHeaderFooter: spec.pdf.display_header_footer,
            headerTemplate: spec.pdf.header_template,
            footerTemplate: spec.pdf.footer_template,
            margin: spec.pdf.margin,
          }
        : undefined,
      upload: { putUrl },
      thumbnailUpload: thumbnailPutUrl ? { putUrl: thumbnailPutUrl } : undefined,
    });

    for (const ref of workerResult.unresolvedRefs ?? []) {
      warnings.push({
        code: "unresolved_asset",
        path: ref,
        message: `The render requested "${ref}" and it was not found. It is missing from the output.`,
      });
    }

    const storageId = extractStorageId(workerResult.uploadBody) as Id<"_storage">;
    let thumbnailStorageId: Id<"_storage"> | undefined;
    if (workerResult.thumbnail) {
      try {
        thumbnailStorageId = extractStorageId(workerResult.thumbnail.uploadBody) as Id<"_storage">;
      } catch {
        thumbnailStorageId = undefined;
      }
    }

    const { type } = inferArtifactInfo(workerResult.relPath);
    let recorded: { version: number; artifact: { relPath: string; role: string } };
    try {
      if (spec.target.type === "canvas") {
        const current = await ctx.runQuery(internal.canvases.currentVersion, { canvasId });
        if (!current) throw new Error("CanvasDoc has no current version to attach export to");
        const attached = await ctx.runMutation(internal.canvases.attachCanvasRender, {
          canvasId,
          versionId: current.versionId,
          relPath: workerResult.relPath,
          type,
          mimeType: workerResult.mimeType,
          size: workerResult.size,
          storageId,
          thumbnailStorageId:
            workerResult.readiness?.status === "partial" ? undefined : thumbnailStorageId,
        });
        recorded = { version: current.version, artifact: attached.artifact };
      } else {
        recorded = await ctx.runMutation(internal.canvases.recordRender, {
          canvasId,
          createdBy: principal.userId,
          relPath: workerResult.relPath,
          type,
          mimeType: workerResult.mimeType,
          size: workerResult.size,
          storageId,
          thumbnailStorageId:
            workerResult.readiness?.status === "partial" ? undefined : thumbnailStorageId,
          primary: workerResult.readiness?.status === "partial" ? false : spec.primary,
        });
      }
    } catch (err) {
      await ctx.storage.delete(storageId);
      if (thumbnailStorageId) await ctx.storage.delete(thumbnailStorageId);
      throw err;
    }

    await ctx.runMutation(internal.canvases.logRender, {
      canvasId,
      entrypoint,
      format: spec.format,
      status: workerResult.readiness?.status === "partial" ? "partial" : "success",
      durationMs: Date.now() - started,
      createdBy: principal.userId,
    });

    if (workerResult.readiness?.status === "partial")
      warnings.push({
        code: "render_failed",
        path: entrypoint,
        message: `Partial iframe render: ${workerResult.readiness.warnings.join("; ")}`,
      });
    return {
      artifact: {
        path: recorded.artifact.relPath,
        format: spec.format,
        role: recorded.artifact.role as "primary" | "supporting",
        size_bytes: workerResult.size,
        mime_type: workerResult.mimeType,
        raw_url: await ctx.storage.getUrl(storageId),
      },
      warnings,
    };
  } catch (err) {
    await ctx.runMutation(internal.canvases.logRender, {
      canvasId,
      entrypoint,
      format: spec.format,
      status: "error",
      durationMs: Date.now() - started,
      errorText: describeError(err),
      createdBy: principal.userId,
    });
    warnings.push({
      code: "render_failed",
      path: entrypoint,
      message: `Render of ${entrypoint} to ${spec.format} failed: ${describeError(err)}`,
    });
    return { warnings };
  }
}

/**
 * Commits a CanvasDoc: validate, compile the doc's Tailwind CSS, store, and
 * assemble the static page that makes the doc renderable and thumbnailable.
 */
async function saveDoc(
  ctx: ActionCtx,
  canvasId: Id<"canvases">,
  principal: McpPrincipal,
  rawDoc: unknown,
  note: string | undefined,
  expectedVersion?: number,
): Promise<{ version: number; warnings: Warning[] }> {
  const warnings: Warning[] = [];
  const doc: CanvasDoc = CanvasDocSchema.parse(rawDoc);

  const compiledCss = "";
  const iframeEntrypoints = [
    ...new Set(
      doc.nodes.filter((node) => node.kind === "iframe").map((node) => node.source.entrypoint),
    ),
  ];
  const manifest = await ctx.runQuery(internal.canvases.listFilesForCanvas, { canvasId });
  const paths = new Set(manifest.map((file) => file.relPath));
  const missing = iframeEntrypoints.filter((entrypoint) => !paths.has(entrypoint));
  if (missing.length)
    throw new Error(
      `CanvasDoc iframe entrypoint does not exist: ${missing.join(", ")}. Upload it in the same canvas_save files array.`,
    );

  const docJson = JSON.stringify(doc);
  const docBytes = new TextEncoder().encode(docJson);
  const docStorageId = await ctx.storage.store(new Blob([docBytes], { type: "application/json" }));
  const cssStorageId = compiledCss
    ? await ctx.storage.store(new Blob([compiledCss], { type: "text/css" }))
    : undefined;

  let version: number;
  try {
    const put = await ctx.runMutation(internal.canvases.putDoc, {
      canvasId,
      docStorageId,
      cssStorageId,
      iframeEntrypoints,
      note,
      createdBy: principal.userId,
      expectedVersion,
      nodes: doc.nodes.map((node) => ({
        nodeId: node.id,
        title: node.caption.title,
        eyebrow: node.inspector?.eyebrow ?? node.caption.tag,
        searchText: [
          node.caption.title,
          node.caption.subtitle,
          node.caption.tag,
          node.inspector?.eyebrow,
          node.inspector?.title,
          node.inspector?.copy,
        ]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .join(" "),
      })),
    });
    version = put.version;
  } catch (err) {
    await ctx.storage.delete(docStorageId);
    if (cssStorageId) await ctx.storage.delete(cssStorageId);
    throw err;
  }

  // The rendered page is written to a reserved path. v1 wrote this silently
  // into /src/__canvas.html — colliding with any caller file of that name and
  // consuming the caller's quota without ever mentioning it. Same mechanism,
  // but now it is documented in the tool description and reported back.
  try {
    // Export pages must instantiate every screen, including screens outside the
    // browser viewport. The interactive viewer uses lazy loading instead.
    const { html } = renderCanvas(layoutCanvas(doc), { iframeLoading: "eager" });
    const page =
      '<!doctype html><html><head><meta charset="utf-8" />' +
      `<style>html,body{margin:0;padding:0}</style><style>${THEME_CSS}</style>` +
      `<style>${compiledCss}</style></head><body>${html}<script>addEventListener('message',function(e){if(!e.data||e.data.type!=='visual-canvas:readiness')return;for(const f of document.querySelectorAll('.vc-kind-iframe iframe'))if(f.contentWindow===e.source){const n=f.closest('.vc-kind-iframe');n.dataset.iframeReadiness=e.data.state;n.dataset.iframeReadinessDetail=typeof e.data.detail==='string'?e.data.detail:'';break}})</script></body></html>`;
    const bytes = new TextEncoder().encode(page);
    const htmlStorageId = await ctx.storage.store(new Blob([bytes], { type: "text/html" }));
    try {
      await ctx.runMutation(internal.canvases.upsertFile, {
        canvasId,
        relPath: "/src/__canvas.html",
        storageId: htmlStorageId,
        size: bytes.byteLength,
        contentHash: await sha256Hex(page),
      });
    } catch (err) {
      await ctx.storage.delete(htmlStorageId);
      throw err;
    }
  } catch (err) {
    warnings.push({
      code: "render_failed",
      message: `The canvas document saved, but its preview page could not be built: ${describeError(err)}`,
    });
  }

  return { version, warnings };
}

/* ------------------------------------------------------------------------
 * Tool registration
 * ---------------------------------------------------------------------- */

const RefArg = z
  .string()
  .describe('"workspace-slug/canvas-slug" (created on first save) or a canvas id.');

function assertEditableText(path: string, text: string): void {
  if (!/\.(?:html?|css|m?js|cjs|jsx|tsx?|json|md|txt|svg|xml|ya?ml|d2)$/i.test(path)) {
    throw new Error(`binary_file: ${path} is not an editable UTF-8 text file`);
  }
  if (text.includes("\0")) throw new Error(`binary_file: ${path} contains NUL bytes`);
}

async function loadEditableFile(
  ctx: ActionCtx,
  ref: string,
  path: string,
): Promise<{
  canvasId: Id<"canvases">;
  version: number;
  path: string;
  contentHash: string;
  content: string;
}> {
  const file = await ctx.runQuery(internal.canvases.getEditableFileByRef, { ref, path });
  if (!file) throw new Error(`file_not_found: ${path}`);
  const response = await fetch(file.fileUrl);
  if (!response.ok) throw new Error(`Unable to read ${file.path}: HTTP ${response.status}`);
  const content = await response.text();
  assertEditableText(file.path, content);
  return {
    canvasId: file.canvasId,
    version: file.version,
    path: file.path,
    contentHash: file.contentHash,
    content,
  };
}

async function commitPreparedFileChanges(
  ctx: ActionCtx,
  principal: McpPrincipal,
  canvasId: Id<"canvases">,
  expectedVersion: number,
  prepared: PreparedPatchChange[],
  note?: string,
): Promise<{ version: number; files: Array<{ path: string; content_hash?: string }> }> {
  const stored: Id<"_storage">[] = [];
  const changes: Array<
    | {
        type: "write";
        path: string;
        expectedHash?: string;
        storageId: Id<"_storage">;
        size: number;
        contentHash: string;
      }
    | { type: "delete"; path: string; expectedHash: string }
    | { type: "move"; path: string; toPath: string; expectedHash: string }
  > = [];
  try {
    for (const change of prepared) {
      if (change.type !== "write") {
        changes.push(change);
        continue;
      }
      assertEditableText(change.path, change.content);
      const bytes = new TextEncoder().encode(change.content);
      const mimeType = inferArtifactInfo(change.path).mime;
      const storageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));
      stored.push(storageId);
      changes.push({
        type: "write",
        path: change.path,
        expectedHash: change.expectedHash,
        storageId,
        size: bytes.byteLength,
        contentHash: await sha256Hex(change.content),
      });
    }
    const committed = await ctx.runMutation(internal.canvases.commitFilePatch, {
      canvasId,
      expectedVersion,
      changes,
      createdBy: principal.userId,
      note,
    });
    return {
      version: committed.version,
      files: changes.map((change) => ({
        path: change.type === "move" ? change.toPath : change.path,
        content_hash: change.type === "write" ? change.contentHash : undefined,
      })),
    };
  } catch (error) {
    await Promise.all(stored.map((storageId) => ctx.storage.delete(storageId)));
    throw error;
  }
}

const SaveOutputSchema = z.object({
  status: z.enum(["ok", "partial"]),
  created: z.boolean(),
  ref: z.string(),
  canvas_id: z.string(),
  workspace_slug: z.string(),
  canvas_slug: z.string(),
  kind: z.enum(["canvas", "html", "image", "pdf"]),
  title: z.string(),
  version: z.number(),
  visibility: z.enum(["private", "public"]),
  canvas_url: z.string(),
  share_url: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  embed: z
    .object({
      image_url: z.string(),
      target_url: z.string(),
      github_markdown: z.string(),
    })
    .nullable(),
  files_written: z.array(z.object({ path: z.string(), size_bytes: z.number() })),
  artifacts: z.array(
    z.object({
      path: z.string(),
      format: z.string(),
      role: z.enum(["primary", "supporting"]),
      size_bytes: z.number(),
      mime_type: z.string(),
      raw_url: z.string().nullable(),
      public_url: z.string().nullable(),
      embed_image_url: z.string().nullable(),
      github_markdown: z.string().nullable(),
    }),
  ),
  storage: StorageSchema,
  warnings: z.array(WarningSchema),
});

export function registerTools(server: McpServer, ctx: ActionCtx, principal: McpPrincipal): void {
  /* --- 1. canvas_save ------------------------------------------------- */
  server.registerTool(
    "canvas_save",
    {
      title: "Save canvas",
      description:
        "Creates or updates a canvas and returns its URLs. This one call does everything: it " +
        "creates the workspace and canvas if they don't exist, writes files, renders, and " +
        "publishes. Addressed by ref, so calling it twice with the same ref updates rather than " +
        "duplicating — safe to retry. Author kind=canvas with `doc`; author html/image/pdf with " +
        "`files` + `renders`. Note that saving a `doc` also writes a generated preview page to " +
        "the reserved path /src/__canvas.html.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        ref: RefArg,
        title: z.string().optional(),
        description: z.string().optional(),
        theme: z.string().optional(),
        kind: z
          .enum(["canvas", "html", "image", "pdf"])
          .optional()
          .describe("Inferred from doc/renders when omitted. Cannot be changed after creation."),
        doc: z
          .unknown()
          .optional()
          .describe(
            "CanvasDoc v2 with explicit geometry and native/iframe nodes. May be saved atomically with iframe source/assets in files. A phone node must use viewport 284x642 and frame {kind:'phone',time:'09:42'}; its iframe contains screen content only because canvas chrome supplies the bezel, notch and status bar.",
          ),
        files: z.array(FileInputSchema).optional(),
        renders: z.array(RenderInputSchema).max(4).optional(),
        from_version: z.number().optional().describe("Restore this earlier version first."),
        visibility: z
          .enum(["private", "public"])
          .optional()
          .describe("Omit to leave unchanged. 'public' mints a share link."),
        mode: z
          .enum(["upsert", "create", "update"])
          .optional()
          .describe("'create' refuses to touch an existing canvas; 'update' refuses to make one."),
        expected_version: z
          .number()
          .optional()
          .describe("Refuse the write if the canvas is not at this version."),
        note: z.string().optional().describe("Recorded on the version this call creates."),
      }),
      outputSchema: SaveOutputSchema,
    },
    async (input) =>
      runTool(async () => {
        const warnings: Warning[] = [];

        const kind = input.kind ?? (input.doc !== undefined ? "canvas" : "html");
        const upserted = await ctx.runMutation(internal.canvases.upsertByRef, {
          ref: input.ref,
          createdBy: principal.userId,
          title: input.title,
          kind,
          description: input.description,
          theme: input.theme,
          mode: input.mode,
          expectedVersion: input.expected_version,
        });
        const canvasId = upserted.canvasId;

        if (upserted.overwroteOtherAuthor) {
          warnings.push({
            code: "overwrote_other_author",
            message:
              `"${input.ref}" was created by someone else and you just wrote to it. ` +
              "Writes are org-wide here. Use mode:'create' with a different ref if that was unintended.",
          });
        }

        if (input.from_version !== undefined) {
          await ctx.runMutation(internal.canvases.restoreVersionByRef, {
            ref: canvasId,
            version: input.from_version,
          });
        }

        // --- content ---
        const filesWritten: Array<{ path: string; size_bytes: number }> = [];
        const writtenText: Array<{ path: string; text: string }> = [];

        for (const file of input.files ?? []) {
          const written = await writeOneFile(ctx, canvasId, principal.userId, file);
          if (written) {
            filesWritten.push(written);
            if (file.text !== undefined) writtenText.push({ path: written.path, text: file.text });
          }
        }

        if (input.doc !== undefined) {
          const saved = await saveDoc(
            ctx,
            canvasId,
            principal,
            input.doc,
            input.note,
            input.expected_version,
          );
          warnings.push(...saved.warnings);
        }

        // --- unresolved-reference scan, before rendering ---
        if (writtenText.length > 0) {
          const present = await ctx.runQuery(internal.canvases.listFilesForCanvas, { canvasId });
          const assetPaths = await ctx.runQuery(internal.canvases.listAssetBindingPaths, {
            canvasId,
          });
          warnings.push(
            ...scanUnresolvedRefs(
              writtenText,
              new Set([...present.map((file) => file.relPath), ...assetPaths]),
            ),
          );
        }

        // --- renders ---
        const artifacts: RenderedArtifact[] = [];
        for (const spec of input.renders ?? []) {
          const rendered = await performRender(ctx, canvasId, principal, spec);
          if (rendered.artifact) artifacts.push(rendered.artifact);
          warnings.push(...rendered.warnings);
        }

        // --- visibility ---
        if (input.visibility) {
          await ctx.runMutation(internal.canvases.publish, {
            canvasId,
            visibility: input.visibility,
            newPublicSlug: input.visibility === "public" ? randomShareSlug() : undefined,
          });
        }

        const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: canvasId });
        if (!detail) throw new Error("Canvas vanished mid-save.");

        const usedRatio = detail.storage.used_bytes / detail.storage.quota_bytes;
        if (usedRatio > 0.8) {
          warnings.push({
            code: "quota_near_limit",
            message:
              `This canvas is using ${(usedRatio * 100).toFixed(0)}% of its storage quota. ` +
              "Delete old outputs with canvas_delete.",
          });
        }

        const renderFailed = warnings.some((w) => w.code === "render_failed");
        const publicSlug = detail.canvas.public_slug;
        const version = detail.canvas.version ?? 0;
        const canvasEmbedImage = embedCardUrl(publicSlug, { kind: "canvas" }, version);
        const canvasEmbedTarget = embedTargetUrl(publicSlug, { kind: "canvas" });
        const canvasEmbedMarkdown = githubEmbedMarkdown(
          detail.canvas.title,
          canvasEmbedImage,
          canvasEmbedTarget,
        );
        return result({
          status: renderFailed ? "partial" : "ok",
          created: upserted.created,
          ref: `${upserted.workspaceSlug}/${upserted.canvasSlug}`,
          canvas_id: canvasId,
          workspace_slug: upserted.workspaceSlug,
          canvas_slug: upserted.canvasSlug,
          kind: detail.canvas.kind,
          title: detail.canvas.title,
          version: detail.canvas.version ?? 0,
          visibility: detail.canvas.visibility,
          canvas_url: canvasUrl(canvasId),
          share_url: shareUrl(detail.canvas.public_slug),
          thumbnail_url: detail.canvas.thumbnail_url,
          embed:
            canvasEmbedImage && canvasEmbedTarget && canvasEmbedMarkdown
              ? {
                  image_url: canvasEmbedImage,
                  target_url: canvasEmbedTarget,
                  github_markdown: canvasEmbedMarkdown,
                }
              : null,
          files_written: filesWritten,
          artifacts: artifacts.map((artifact) => {
            const target = { kind: "artifact" as const, id: artifact.path };
            const imageUrl = embedCardUrl(publicSlug, target, version);
            const targetUrl = embedTargetUrl(publicSlug, target);
            return {
              ...artifact,
              public_url: targetUrl,
              embed_image_url: imageUrl,
              github_markdown: githubEmbedMarkdown(artifact.path, imageUrl, targetUrl),
            };
          }),
          storage: detail.storage,
          warnings: dedupeWarnings(warnings),
        });
      }),
  );

  server.registerTool(
    "canvas_edit",
    {
      title: "Edit one canvas file",
      description:
        "Edits one UTF-8 workspace file using the same exact old_string/new_string contract as " +
        "Claude Code and OpenCode. The match must be unique unless replace_all is explicit. " +
        "Creates one immutable canvas version and rejects stale expected_version/hash values.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        ref: RefArg,
        file_path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
        expected_version: z.number().int().nonnegative(),
        expected_hash: z.string().optional(),
        note: z.string().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const source = await loadEditableFile(ctx, input.ref, input.file_path);
        if (source.version !== input.expected_version) {
          throw new Error(
            `version_conflict: expected ${input.expected_version}, current ${source.version}`,
          );
        }
        if (
          input.expected_hash &&
          input.expected_hash.replace(/^sha256:/, "") !== source.contentHash
        ) {
          throw new Error(
            `hash_conflict: expected ${input.expected_hash}, current ${source.contentHash}`,
          );
        }
        const edited = applyExactEdit(source.content, {
          oldString: input.old_string,
          newString: input.new_string,
          replaceAll: input.replace_all,
        });
        const committed = await commitPreparedFileChanges(
          ctx,
          principal,
          source.canvasId,
          input.expected_version,
          [
            {
              type: "write",
              path: source.path,
              expectedHash: source.contentHash,
              content: edited.content,
            },
          ],
          input.note,
        );
        return result({
          status: "ok",
          ref: input.ref,
          file_path: source.path,
          replacements: edited.replacements,
          previous_hash: source.contentHash,
          content_hash: committed.files[0]?.content_hash,
          previous_version: input.expected_version,
          version: committed.version,
        });
      }),
  );

  server.registerTool(
    "canvas_apply_patch",
    {
      title: "Apply a multi-file canvas patch",
      description:
        "Atomically applies Codex-style Begin Patch operations (Add, Update, Move, Delete) to " +
        "UTF-8 workspace files. Every hunk is exact; one failed hunk rolls back the whole patch.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z.object({
        ref: RefArg,
        patch: z.string(),
        expected_version: z.number().int().nonnegative(),
        note: z.string().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        let canvasId: Id<"canvases"> | undefined;
        const cache = new Map<string, Awaited<ReturnType<typeof loadEditableFile>> | null>();
        const prepared = await prepareApplyPatch(input.patch, async (path) => {
          if (cache.has(path)) {
            const cached = cache.get(path);
            return cached ? { content: cached.content, hash: cached.contentHash } : null;
          }
          try {
            const file = await loadEditableFile(ctx, input.ref, path);
            if (file.version !== input.expected_version) {
              throw new Error(
                `version_conflict: expected ${input.expected_version}, current ${file.version}`,
              );
            }
            canvasId = file.canvasId;
            cache.set(path, file);
            return { content: file.content, hash: file.contentHash };
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("file_not_found:")) {
              cache.set(path, null);
              return null;
            }
            throw error;
          }
        });
        if (!canvasId) {
          const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: input.ref });
          if (!detail) throw new Error(`No canvas found for ref "${input.ref}"`);
          canvasId = detail.canvas.canvas_id;
          if ((detail.canvas.version ?? 0) !== input.expected_version) {
            throw new Error(
              `version_conflict: expected ${input.expected_version}, current ${detail.canvas.version ?? 0}`,
            );
          }
        }
        const committed = await commitPreparedFileChanges(
          ctx,
          principal,
          canvasId,
          input.expected_version,
          prepared,
          input.note,
        );
        return result({
          status: "ok",
          ref: input.ref,
          previous_version: input.expected_version,
          version: committed.version,
          files: committed.files,
        });
      }),
  );

  const docPatchOps = new Set([
    "world.update",
    ...(["lanes", "stages", "labels", "nodes", "edges"] as const).flatMap((collection) => [
      `${collection}.add`,
      `${collection}.update`,
      `${collection}.remove`,
    ]),
  ]);
  const docPatchOperationSchema = z
    .object({
      op: z.string(),
      id: z.string().optional(),
      changes: z.record(z.string(), z.unknown()).optional(),
      value: z.unknown().optional(),
    })
    .superRefine((operation, check) => {
      if (!docPatchOps.has(operation.op)) {
        check.addIssue({
          code: "custom",
          message: `Unsupported CanvasDoc operation: ${operation.op}`,
        });
      }
      if (operation.op.endsWith(".add") && operation.value === undefined) {
        check.addIssue({ code: "custom", path: ["value"], message: "add requires value" });
      }
      if (
        (operation.op.endsWith(".update") || operation.op.endsWith(".remove")) &&
        operation.op !== "world.update" &&
        !operation.id
      ) {
        check.addIssue({ code: "custom", path: ["id"], message: "update/remove requires id" });
      }
      if (operation.op.endsWith(".update") && operation.changes === undefined) {
        check.addIssue({ code: "custom", path: ["changes"], message: "update requires changes" });
      }
    });

  server.registerTool(
    "canvas_doc_patch",
    {
      title: "Patch CanvasDoc entities",
      description:
        "Atomically adds, updates or removes CanvasDoc v2 world/lanes/stages/labels/nodes/edges " +
        "by semantic id. The complete resulting graph is strictly validated before a version is created.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z.object({
        ref: RefArg,
        expected_version: z.number().int().nonnegative(),
        operations: z.array(docPatchOperationSchema).min(1),
        note: z.string().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const detail = await ctx.runQuery(internal.canvases.detailByRef, {
          ref: input.ref,
          includeDoc: true,
        });
        if (!detail?.canvas.doc_url) throw new Error(`CanvasDoc not found for ref "${input.ref}"`);
        const currentVersion = detail.canvas.version ?? 0;
        if (currentVersion !== input.expected_version) {
          throw new Error(
            `version_conflict: expected ${input.expected_version}, current ${currentVersion}`,
          );
        }
        const response = await fetch(detail.canvas.doc_url);
        if (!response.ok) throw new Error(`Unable to load CanvasDoc: HTTP ${response.status}`);
        const current = CanvasDocSchema.parse(await response.json());
        const patched = applyCanvasDocPatch(current, input.operations as CanvasDocPatchOperation[]);
        const saved = await saveDoc(
          ctx,
          detail.canvas.canvas_id,
          principal,
          patched,
          input.note ?? `CanvasDoc patch (${input.operations.length})`,
          input.expected_version,
        );
        return result({
          status: saved.warnings.length ? "partial" : "ok",
          ref: input.ref,
          previous_version: input.expected_version,
          version: saved.version,
          operations: input.operations.length,
          warnings: saved.warnings,
        });
      }),
  );

  const assetScopeSchema = z.enum(["personal", "workspace"]);
  const assetKindSchema = z.enum(["image", "svg", "font", "video", "data"]);

  server.registerTool(
    "asset_list",
    {
      title: "Find reusable media assets",
      description:
        "Searches the personal or workspace Asset Library and returns immutable asset:// refs " +
        "that can be attached to a canvas without uploading the bytes again.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        scope: assetScopeSchema,
        workspace: z.string().optional(),
        query: z.string().optional(),
        kind: assetKindSchema.optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        if (input.scope === "workspace" && !input.workspace)
          throw new Error("workspace is required for workspace assets");
        const rows = await ctx.runQuery(internal.assets.listInternal, {
          userId: principal.userId,
          scope: input.scope,
          workspaceSlug: input.workspace,
          query: input.query,
          kind: input.kind,
          limit: input.limit ?? 50,
        });
        const assets = await Promise.all(
          rows.map(async ({ preview_object_key, ...asset }) => ({
            ...asset,
            preview_url: await presignObject("delivery", preview_object_key, "GET", 900),
          })),
        );
        return result({ assets, count: assets.length });
      }),
  );

  server.registerTool(
    "asset_get",
    {
      title: "Inspect one media asset",
      description:
        "Returns one immutable asset revision. For visual assets include_preview=true adds the " +
        "actual image to MCP content so a multimodal caller can inspect it directly.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        asset_ref: z.string(),
        include_preview: z.boolean().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const asset = await ctx.runQuery(internal.assets.resolveRef, {
          ref: input.asset_ref,
          userId: principal.userId,
        });
        const payload = {
          asset_ref: asset.assetRef,
          revision: asset.revision,
          mime_type: asset.mimeType,
          size_bytes: asset.size,
          content_hash: asset.contentHash,
          preview_url: await presignObject("delivery", asset.previewObjectKey, "GET", 900),
        };
        if (!input.include_preview || !asset.mimeType.startsWith("image/")) return result(payload);
        const response = await getObject("delivery", asset.previewObjectKey);
        if (!response.ok) throw new Error(`Asset preview failed: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > 5 * 1024 * 1024)
          throw new Error("Asset preview exceeds the 5MB MCP inline limit");
        return {
          content: [
            { type: "text", text: JSON.stringify(payload, null, 2) },
            { type: "image", data: base64Bytes(bytes), mimeType: asset.mimeType },
          ],
          structuredContent: payload,
        };
      }),
  );

  server.registerTool(
    "asset_upload_url",
    {
      title: "Upload media to the Asset Library",
      description:
        "Creates a one-hour presigned PUT URL for direct binary upload to the private source " +
        "bucket. Call asset_finalize after the PUT completes.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        scope: assetScopeSchema,
        workspace: z.string().optional(),
        filename: z.string(),
        content_type: z.string(),
        size_bytes: z.number().int().positive().max(ASSET_MAX_BYTES).optional(),
        sha256: z.string().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const mime = input.content_type.split(";")[0]?.trim().toLowerCase() ?? "";
        if (!(mime in ASSET_MIME_TYPES)) throw new Error(`Unsupported asset MIME type: ${mime}`);
        const workspace =
          input.scope === "workspace"
            ? await ctx.runQuery(internal.assets.getWorkspaceBySlug, {
                slug: input.workspace ?? "",
              })
            : null;
        if (input.scope === "workspace" && !workspace) throw new Error("Workspace not found");
        const sourceObjectKey = `staging/${principal.userId}/${crypto.randomUUID()}`;
        const expiresAt = Date.now() + 60 * 60 * 1000;
        const uploadId = await ctx.runMutation(internal.assets.createUpload, {
          scope: input.scope,
          ownerUserId: principal.userId,
          workspaceId: workspace?.workspaceId,
          sourceObjectKey,
          filename: input.filename,
          declaredMimeType: mime,
          expectedSize: input.size_bytes,
          expectedHash: input.sha256,
          expiresAt,
        });
        return result({
          upload_id: uploadId,
          upload_url: await presignObject("source", sourceObjectKey, "PUT", 3600),
          method: "PUT",
          expires_at: expiresAt,
          instructions: "PUT the raw bytes to upload_url, then call asset_finalize with upload_id.",
        });
      }),
  );

  server.registerTool(
    "asset_finalize",
    {
      title: "Finalize an uploaded asset",
      description:
        "Validates MIME/size/hash, stores immutable source and delivery objects, " +
        "and creates a new Asset Library revision.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        upload_id: z.string(),
        slug: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const uploadId = input.upload_id as Id<"assetUploads">;
        const upload = await ctx.runQuery(internal.assets.getUpload, {
          uploadId,
          userId: principal.userId,
          now: Date.now(),
        });
        if (!upload) throw new Error("Upload does not exist or has expired");
        const response = await getObject("source", upload.sourceObjectKey);
        if (!response.ok)
          throw new Error(`Uploaded object is unavailable: HTTP ${response.status}`);
        const rawBytes = new Uint8Array(await response.arrayBuffer());
        if (upload.expectedSize !== undefined && rawBytes.byteLength !== upload.expectedSize)
          throw new Error("Uploaded asset size does not match the declared size");
        const rawHash = await sha256HexBytes(rawBytes);
        if (upload.expectedHash && rawHash !== upload.expectedHash.replace(/^sha256:/, ""))
          throw new Error("Uploaded asset SHA-256 does not match");
        const workspace = upload.workspaceId
          ? await ctx.runQuery(internal.assets.getWorkspace, { workspaceId: upload.workspaceId })
          : null;
        const saved = await persistAsset(ctx, {
          uploadId,
          scope: upload.scope,
          ownerUserId: principal.userId,
          workspaceId: upload.workspaceId,
          workspaceSlug: workspace?.slug,
          slug: slugify(input.slug ?? input.name),
          name: input.name.trim(),
          description: input.description,
          tags: [...new Set(input.tags ?? [])],
          filename: upload.filename,
          rawBytes,
          declaredMime: upload.declaredMimeType,
          sourceType: "upload",
        });
        await deleteObject("source", upload.sourceObjectKey);
        return result({
          status: "ok",
          asset_id: saved.assetId,
          asset_ref: saved.assetRef,
          revision: saved.revision,
          mime_type: saved.mimeType,
          size_bytes: saved.size,
          content_hash: saved.contentHash,
        });
      }),
  );

  server.registerTool(
    "asset_import",
    {
      title: "Import an external media asset",
      description:
        "Downloads an HTTPS asset into the private Asset Library. The canvas never hotlinks the " +
        "external URL; redirects and private-network targets are rejected.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        scope: assetScopeSchema,
        workspace: z.string().optional(),
        url: z.string(),
        slug: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const workspace =
          input.scope === "workspace"
            ? await ctx.runQuery(internal.assets.getWorkspaceBySlug, {
                slug: input.workspace ?? "",
              })
            : null;
        if (input.scope === "workspace" && !workspace) throw new Error("Workspace not found");
        const imported = await fetchAssetImport(input.url);
        const saved = await persistAsset(ctx, {
          scope: input.scope,
          ownerUserId: principal.userId,
          workspaceId: workspace?.workspaceId,
          workspaceSlug: workspace?.slug,
          slug: slugify(input.slug ?? input.name),
          name: input.name.trim(),
          description: input.description,
          tags: [...new Set(input.tags ?? [])],
          filename: new URL(imported.finalUrl).pathname.split("/").pop() || "asset",
          rawBytes: imported.bytes,
          declaredMime: imported.mimeType,
          sourceType: "url",
          sourceUrl: imported.finalUrl.split("?")[0],
        });
        return result({
          status: "ok",
          asset_id: saved.assetId,
          asset_ref: saved.assetRef,
          revision: saved.revision,
          mime_type: saved.mimeType,
          size_bytes: saved.size,
          content_hash: saved.contentHash,
        });
      }),
  );

  server.registerTool(
    "asset_attach",
    {
      title: "Attach a library asset to a canvas",
      description:
        "Pins one immutable asset revision at an /assets path and creates a canvas version. " +
        "Iframe HTML uses the ordinary path; old canvas versions keep their previous revision.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        ref: RefArg,
        asset_ref: z.string(),
        path: z.string(),
        expected_version: z.number().int().nonnegative(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: input.ref });
        if (!detail) throw new Error(`No canvas found for ref "${input.ref}"`);
        const asset = await ctx.runQuery(internal.assets.resolveRef, {
          ref: input.asset_ref,
          userId: principal.userId,
        });
        const attached = await ctx.runMutation(internal.canvases.bindAssetAndVersion, {
          canvasId: detail.canvas.canvas_id,
          logicalPath: input.path,
          assetId: asset.assetId,
          assetVersionId: asset.assetVersionId,
          expectedVersion: input.expected_version,
          createdBy: principal.userId,
        });
        return result({
          status: "ok",
          ref: input.ref,
          asset_ref: asset.assetRef,
          path: attached.path,
          version: attached.version,
        });
      }),
  );

  /* --- canvas_get ----------------------------------------------------- */
  server.registerTool(
    "canvas_get",
    {
      title: "Read canvas",
      description:
        "Reads one canvas: metadata and URLs always, plus whichever of doc / files / artifacts / " +
        "versions / renders / storage you ask for. Artifact bytes are returned as links, not " +
        "inlined — fetch raw_url if you need the content.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        ref: RefArg,
        include: z
          .array(z.enum(["doc", "files", "artifacts", "versions", "renders", "storage"]))
          .optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const include = new Set(input.include ?? []);
        const detail = await ctx.runQuery(internal.canvases.detailByRef, {
          ref: input.ref,
          includeDoc: include.has("doc"),
          includeFiles: include.has("files"),
          includeArtifacts: include.has("artifacts"),
          includeVersions: include.has("versions"),
          includeRenders: include.has("renders"),
        });
        if (!detail) {
          throw new Error(
            `No canvas found for ref "${input.ref}". Use canvas_find to see what exists.`,
          );
        }

        let doc: unknown;
        if (include.has("doc") && detail.canvas.doc_url) {
          const res = await fetch(detail.canvas.doc_url);
          if (res.ok) doc = await res.json();
        }

        return result({
          canvas: {
            ref: detail.workspace_slug
              ? `${detail.workspace_slug}/${detail.canvas.slug}`
              : detail.canvas.canvas_id,
            canvas_id: detail.canvas.canvas_id,
            title: detail.canvas.title,
            description: detail.canvas.description,
            kind: detail.canvas.kind,
            visibility: detail.canvas.visibility,
            version: detail.canvas.version ?? 0,
            updated_at: detail.canvas.updated_at,
            created_by_email: detail.created_by_email,
            canvas_url: canvasUrl(detail.canvas.canvas_id),
            share_url: shareUrl(detail.canvas.public_slug),
            thumbnail_url: detail.canvas.thumbnail_url,
            embed: (() => {
              const imageUrl = embedCardUrl(
                detail.canvas.public_slug,
                { kind: "canvas" },
                detail.canvas.version,
              );
              const targetUrl = embedTargetUrl(detail.canvas.public_slug, { kind: "canvas" });
              const markdown = githubEmbedMarkdown(detail.canvas.title, imageUrl, targetUrl);
              return imageUrl && targetUrl && markdown
                ? { image_url: imageUrl, target_url: targetUrl, github_markdown: markdown }
                : null;
            })(),
          },
          doc,
          files: detail.files,
          artifacts: detail.artifacts?.map((artifact) => {
            const target = { kind: "artifact" as const, id: artifact.path };
            const imageUrl = embedCardUrl(detail.canvas.public_slug, target, detail.canvas.version);
            const targetUrl = embedTargetUrl(detail.canvas.public_slug, target);
            return {
              ...artifact,
              public_url: targetUrl,
              embed_image_url: imageUrl,
              github_markdown: githubEmbedMarkdown(artifact.path, imageUrl, targetUrl),
            };
          }),
          versions: detail.versions,
          renders: detail.renders,
          storage: include.has("storage") ? detail.storage : undefined,
        });
      }),
  );

  /* --- 3. canvas_find ------------------------------------------------- */
  server.registerTool(
    "canvas_find",
    {
      title: "Find canvases",
      description:
        "Browses and searches. With no query it lists workspaces and recent canvases; with a " +
        "query it searches canvas titles and the text inside canvas-document nodes, so a hit can " +
        "point at the exact node. Every result carries a ref you can pass straight to the other " +
        "tools.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        query: z.string().optional(),
        workspace: z.string().optional().describe("Restrict to one workspace slug."),
        kind: z.enum(["canvas", "html", "image", "pdf"]).optional(),
        visibility: z.enum(["private", "public"]).optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const found = await ctx.runQuery(internal.canvases.findCanvases, {
          query: input.query,
          workspaceSlug: input.workspace,
          kind: input.kind,
          visibility: input.visibility,
          limit: input.limit,
        });
        // Workspaces are only interesting when browsing, not when searching.
        const workspaces = input.query
          ? undefined
          : (await ctx.runQuery(internal.canvases.findWorkspaces, {})).workspaces;

        const warnings: Warning[] = [];
        if (found.has_more) {
          warnings.push({
            code: "truncated",
            message:
              "More canvases match than were returned. Narrow with workspace/kind or raise limit.",
          });
        }

        return result({
          workspaces,
          canvases: found.canvases.map((c) => ({
            ...c,
            canvas_url: canvasUrl(c.canvas_id),
            share_url: shareUrl(c.public_slug),
          })),
          nodes: found.nodes,
          has_more: found.has_more,
          warnings,
        });
      }),
  );

  /* --- 4. canvas_delete ----------------------------------------------- */
  server.registerTool(
    "canvas_delete",
    {
      title: "Delete",
      description:
        "Removes a workspace, canvas, file or artifact. Defaults to archiving (reversible, keeps " +
        "the bytes); pass purge:true to delete permanently and reclaim storage. Purging a " +
        "workspace also purges every canvas inside it.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z.object({
        ref: RefArg,
        target: z.enum(["workspace", "canvas", "file", "artifact"]),
        path: z.string().optional().describe("Required for target file/artifact."),
        purge: z
          .boolean()
          .optional()
          .describe("true = permanent delete. false/omitted = reversible archive."),
      }),
    },
    async (input) =>
      runTool(async () => {
        const removed = await ctx.runMutation(internal.canvases.removeByRef, {
          ref: input.ref,
          target: input.target,
          path: input.path,
          purge: input.purge,
        });
        return result({
          deleted: removed.deleted,
          archived: removed.archived,
          bytes_reclaimed: removed.bytes_reclaimed,
          canvases_deleted: (removed as { canvases_deleted?: number }).canvases_deleted,
        });
      }),
  );

  /* --- 5. canvas_run -------------------------------------------------- */
  server.registerTool(
    "canvas_run",
    {
      title: "Run code",
      description:
        "Executes JS/TS in a sandboxed worker against this canvas's files. Anything written to " +
        "/output is collected as an artifact. No shell, no filesystem outside the canvas.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        ref: RefArg,
        code: z.string(),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .max(60_000)
          .optional()
          .describe("Defaults to 5000."),
        memory_limit_mb: z
          .number()
          .int()
          .positive()
          .max(1024)
          .optional()
          .describe("Defaults to 128."),
      }),
    },
    async (input) =>
      runTool(async () => {
        const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: input.ref });
        if (!detail) throw new Error(`No canvas found for ref "${input.ref}".`);
        const canvasId = detail.canvas.canvas_id;

        const config = getWorkerConfig();
        const sources = await resolveCanvasSources(ctx, canvasId);

        const UPLOAD_POOL_SIZE = 10;
        const uploads = await Promise.all(
          Array.from({ length: UPLOAD_POOL_SIZE }, () => ctx.storage.generateUploadUrl()),
        );

        const workerResult = await callWorker<{
          success: boolean;
          stdout: string;
          stderr: string;
          error?: string;
          durationMs?: number;
          artifacts: Array<{
            relPath: string;
            size: number;
            uploaded: boolean;
            uploadBody?: unknown;
          }>;
        }>(config, "/exec", {
          sources,
          code: input.code,
          // The worker has always accepted these; v1's tool simply never sent
          // them, so every call silently ran at the 5s/128MB defaults with no
          // way to ask for more.
          timeoutMs: input.timeout_ms,
          memoryLimitMb: input.memory_limit_mb,
          uploads: uploads.map((putUrl) => ({ putUrl })),
        });

        const warnings: Warning[] = [];
        const uploaded = workerResult.artifacts.filter((a) => a.uploaded);
        if (workerResult.artifacts.some((a) => !a.uploaded)) {
          warnings.push({
            code: "upload_pool_exhausted",
            message:
              `Only ${UPLOAD_POOL_SIZE} output files can be saved per run and this produced ` +
              `${workerResult.artifacts.length}. The rest were left behind.`,
          });
        }

        if (uploaded.length > 0) {
          const entries = uploaded.map((a) => {
            const info = inferArtifactInfo(a.relPath);
            return {
              relPath: a.relPath,
              type: info.type,
              mimeType: info.mime,
              size: a.size,
              storageId: extractStorageId(a.uploadBody) as Id<"_storage">,
            };
          });
          try {
            await ctx.runMutation(internal.canvases.recordExecArtifacts, {
              canvasId,
              createdBy: principal.userId,
              artifacts: entries,
            });
          } catch (err) {
            await Promise.all(entries.map((a) => ctx.storage.delete(a.storageId)));
            throw err;
          }
        }

        const payload = {
          status: workerResult.success ? "ok" : "failed",
          stdout: workerResult.stdout,
          stderr: workerResult.stderr,
          error: workerResult.error,
          duration_ms: workerResult.durationMs,
          artifacts: workerResult.artifacts.map((a) => ({
            path: a.relPath,
            size_bytes: a.size,
            uploaded: a.uploaded,
          })),
          warnings,
        };

        // A script that threw is a failure, not a success with a flag buried
        // in the payload — v1 returned isError:false here, so a caller doing
        // ordinary error handling saw "success".
        if (!workerResult.success) {
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
            isError: true,
          };
        }
        return result(payload);
      }),
  );

  /* --- 6. canvas_upload_url ------------------------------------------- */
  server.registerTool(
    "canvas_upload_url",
    {
      title: "Get an upload URL",
      description:
        "Returns a short-lived URL for uploading one file's bytes out of band. Use this for " +
        "images, fonts, and anything large: POST the raw bytes to upload_url, read the storageId " +
        "from the JSON response, then pass it as a file's `upload_id` in canvas_save. This keeps " +
        "file bytes out of the conversation entirely — never base64 a large file into a tool call.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        ref: RefArg,
        path: z.string().describe('Where the file will live, e.g. "/assets/logo.png".'),
        content_type: z.string().optional(),
      }),
      outputSchema: z.object({
        upload_url: z.string(),
        method: z.string(),
        upload_id_field: z.string(),
        path: z.string(),
        instructions: z.string(),
      }),
    },
    async (input) =>
      runTool(async () => {
        // Validate the destination now, so a caller can't burn an upload
        // discovering that /cache isn't writable.
        const { displayPath } = normalizeCanvasPath(input.path, "write", "path");
        const uploadUrl = await ctx.storage.generateUploadUrl();
        return result({
          upload_url: uploadUrl,
          method: "POST",
          upload_id_field: "storageId",
          path: displayPath,
          instructions:
            `POST the raw bytes to upload_url with Content-Type: ${input.content_type ?? "<the file's type>"}. ` +
            'The response is JSON like {"storageId":"..."}. Pass that value as ' +
            `upload_id on a file with path "${displayPath}" in canvas_save.`,
        });
      }),
  );
}

/**
 * 128-bit base62 share slug. v1 minted these two different ways depending on
 * which surface published — `crypto.randomUUID()` hex over MCP, base62 in the
 * SPA. One format now.
 */
function randomShareSlug(): string {
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out;
}

/* ------------------------------------------------------------------------
 * Resources
 *
 * Templates were a *tool* in v1 (`list_templates`), and it returned every
 * template's full `exampleCode` — roughly 46KB of HTML dumped into the
 * caller's context on every call, with no summary mode. They are reference
 * data, which is exactly what MCP resources are for: the listing is titles
 * and descriptions, and a caller reads the one it actually wants.
 * ---------------------------------------------------------------------- */
export function registerResources(server: McpServer): void {
  for (const template of templateRegistryList()) {
    server.registerResource(
      `template-${template.id}`,
      `canvas://templates/${template.id}`,
      {
        title: template.name,
        description: `${template.description} (kind: ${template.kind})`,
        mimeType: "text/plain",
      },
      async (uri) => {
        const full = getTemplate(template.id);
        if (!full) throw new Error(`Unknown template: ${template.id}`);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: [
                `# ${full.name}`,
                "",
                full.description,
                "",
                `Expected inputs: ${JSON.stringify(full.expectedInputs, null, 2)}`,
                "",
                "## Example source",
                "",
                full.exampleCode,
              ].join("\n"),
            },
          ],
        };
      },
    );
  }
}
