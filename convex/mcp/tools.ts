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
import {
  formatElementRef,
  parseElementRef,
  resolveElementSelection,
} from "@visual-canvas/canvas/element-ref.js";
import type { CanvasComponentBody } from "@visual-canvas/canvas/component.js";
import {
  CanvasComponentBodySchema,
  componentSize,
  extractComponent,
  insertComponent,
} from "@visual-canvas/canvas/component.js";
import { deleteNodesFromFile, layoutCanvas, moveNodes } from "@visual-canvas/canvas/layout.js";
import { findNodeOverlaps } from "@visual-canvas/canvas/overlap.js";
import { applyCanvasDocPatch, type CanvasDocPatchOperation } from "@visual-canvas/canvas/patch.js";
import { renderCanvas } from "@visual-canvas/canvas/render.js";
import { THEME_CSS } from "@visual-canvas/canvas/theme-css.js";
import type { CanvasDoc, CanvasFile } from "@visual-canvas/canvas/types.js";
import {
  CanvasDocSchema,
  CanvasFileSchema,
  resolveCanvasPage,
} from "@visual-canvas/canvas/types.js";
import { normalizeCanvasPath } from "@visual-canvas/runtime/paths/index.js";
import {
  getTemplate,
  listTemplates as templateRegistryList,
} from "@visual-canvas/runtime/templates/index.js";
import { z } from "zod";
import { internal } from "../_generated/api";
import { parseComponentRef } from "../components";
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
  | "node_overlap"
  | "overwrote_other_author"
  | "truncated"
  | "render_failed"
  | "quota_near_limit"
  | "upload_pool_exhausted";

interface Warning {
  code: WarningCode;
  message: string;
  path?: string;
  /** Machine-readable detail. Only some codes carry it; see `WarningSchema`. */
  data?: {
    page_id?: string;
    node_ids?: string[];
    rects?: { x: number; y: number; w: number; h: number }[];
    overlap_area?: number;
    overlap_fraction?: number;
    overlap_count?: number;
    reported?: number;
  };
}

const WarningRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const WarningSchema = z.object({
  code: z.enum([
    "unresolved_asset",
    "node_overlap",
    "overwrote_other_author",
    "truncated",
    "render_failed",
    "quota_near_limit",
    "upload_pool_exhausted",
  ]),
  message: z.string(),
  path: z.string().optional(),
  data: z
    .object({
      page_id: z.string().optional(),
      node_ids: z.array(z.string()).optional(),
      rects: z.array(WarningRectSchema).optional(),
      overlap_area: z.number().optional(),
      overlap_fraction: z.number().optional(),
      overlap_count: z.number().int().nonnegative().optional(),
      reported: z.number().int().nonnegative().optional(),
    })
    .optional()
    .describe("Machine-readable detail for codes that carry one, e.g. node_overlap."),
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
  versionId: Id<"canvasVersions">,
): Promise<Array<{ relPath: string; getUrl: string }>> {
  const sourceManifest = await ctx.runQuery(internal.canvases.listSourcesForVersion, {
    canvasId,
    versionId,
  });
  const [resolved, assetSources] = await Promise.all([
    Promise.all(
      sourceManifest.files.map(async (f) => {
        const getUrl = await ctx.storage.getUrl(f.storageId);
        return getUrl ? { relPath: f.relPath, getUrl } : null;
      }),
    ),
    Promise.resolve(sourceManifest.assets),
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

const FileInputSchema = z
  .object({
    path: z
      .string()
      .describe('Workspace path: /src/…, /assets/… or /output/…, e.g. "/assets/logo.png".'),
    text: z
      .string()
      .max(1_000_000)
      .optional()
      .describe("Inline UTF-8 content up to 1 MB. Use upload_id for larger files."),
    upload_id: z
      .string()
      .optional()
      .describe(
        "storageId returned by canvas_upload_url. The way to attach large or binary files.",
      ),
    asset_ref: z
      .string()
      .optional()
      .describe("Immutable asset:// ref from asset_list. Mounts it without uploading bytes again."),
    delete: z.boolean().optional().describe("Delete this path instead of writing it."),
  })
  .strict();

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

/** How many overlapping pairs a single save reports before it stops listing. */
const OVERLAP_REPORT_LIMIT = 20;

/**
 * Geometry the agent cannot see. Overlapping nodes are legal — a badge on a
 * card is a stack on purpose — so this never blocks a write and never makes a
 * save `partial`; it just tells the author what the render will look like.
 */
function scanNodeOverlaps(
  pages: readonly { id: string; title?: string; doc: CanvasDoc }[],
): Warning[] {
  const warnings: Warning[] = [];
  let total = 0;
  let reported = 0;

  for (const page of pages) {
    const report = findNodeOverlaps(page.doc.nodes, {
      limit: Math.max(0, OVERLAP_REPORT_LIMIT - reported),
    });
    total += report.total;
    const where = pages.length > 1 ? `Page "${page.title ?? page.id}": ` : "";
    for (const overlap of report.overlaps) {
      reported += 1;
      warnings.push({
        code: "node_overlap",
        // Unique per pair so dedupeWarnings keeps every one of them.
        path: `${page.id}#${overlap.a}+${overlap.b}`,
        message:
          `${where}nodes "${overlap.a}" and "${overlap.b}" overlap by ` +
          `${Math.round(overlap.area)} square units, covering ` +
          `${Math.round(overlap.fraction * 100)}% of the smaller one. ` +
          "Saved as-is; move or resize one of them if the stack was not intended.",
        data: {
          page_id: page.id,
          node_ids: [overlap.a, overlap.b],
          rects: [overlap.rectA, overlap.rectB],
          overlap_area: overlap.area,
          overlap_fraction: overlap.fraction,
        },
      });
    }
  }

  if (total > reported) {
    warnings.push({
      code: "truncated",
      path: "node_overlap",
      message: `${total} overlapping node pairs were found; the first ${reported} are listed.`,
      data: { overlap_count: total, reported },
    });
  }
  return warnings;
}

/**
 * Resolves all `FileInput`s to immutable blobs/bindings without changing the
 * canvas. `commitSaveContent` consumes the returned batch transactionally.
 *
 * The three input modes exist because the alternatives all failed in
 * practice: `text` alone forced a 3.5MB document through a JSON-RPC argument
 * (which meant hand-rolling a raw HTTP call to get it in at all), and there
 * was no binary path whatsoever, so images had to be base64-inlined into the
 * HTML — tripling the payload and burning the caller's context.
 */
async function prepareSaveFiles(
  ctx: ActionCtx,
  canvasId: Id<"canvases">,
  userId: Id<"users">,
  files: FileInput[],
): Promise<{
  changes: Array<
    | {
        type: "write";
        path: string;
        storageId: Id<"_storage">;
        size: number;
        contentHash: string;
      }
    | {
        type: "asset";
        path: string;
        assetId: Id<"assets">;
        assetVersionId: Id<"assetVersions">;
      }
    | { type: "delete"; path: string }
  >;
  filesWritten: Array<{ path: string; size_bytes: number }>;
  writtenText: Array<{ path: string; text: string }>;
  stored: Id<"_storage">[];
}> {
  const changes: Array<
    | {
        type: "write";
        path: string;
        storageId: Id<"_storage">;
        size: number;
        contentHash: string;
      }
    | {
        type: "asset";
        path: string;
        assetId: Id<"assets">;
        assetVersionId: Id<"assetVersions">;
      }
    | { type: "delete"; path: string }
  > = [];
  const filesWritten: Array<{ path: string; size_bytes: number }> = [];
  const writtenText: Array<{ path: string; text: string }> = [];
  const stored: Id<"_storage">[] = [];
  try {
    for (const file of files) {
      const { relPath, displayPath } = normalizeCanvasPath(file.path, "write", "path");
      if (displayPath === "/src/__canvas.html") {
        throw new Error(
          '"/src/__canvas.html" is generated from CanvasDoc and cannot be written directly.',
        );
      }
      if (file.delete) {
        if (file.text !== undefined || file.upload_id || file.asset_ref) {
          throw new Error(`Delete for "${file.path}" cannot also provide file content.`);
        }
        changes.push({ type: "delete", path: displayPath });
        continue;
      }

      const provided = [file.text !== undefined, !!file.upload_id, !!file.asset_ref].filter(
        Boolean,
      ).length;
      if (provided !== 1) {
        throw new Error(
          `File "${file.path}" needs exactly one of text, upload_id or asset_ref (got ${provided}). Use asset_import for HTTPS sources.`,
        );
      }
      if (file.asset_ref) {
        const asset = await ctx.runQuery(internal.assets.resolveRef, {
          ref: file.asset_ref,
          userId,
        });
        changes.push({
          type: "asset",
          path: displayPath,
          assetId: asset.assetId,
          assetVersionId: asset.assetVersionId,
        });
        filesWritten.push({ path: displayPath, size_bytes: asset.size });
        continue;
      }

      let storageId: Id<"_storage">;
      let size: number;
      let contentHash: string;
      if (file.upload_id) {
        storageId = file.upload_id as Id<"_storage">;
        const attachment = await ctx.runQuery(internal.canvases.storageAttachment, { storageId });
        const isReplay =
          attachment?.scope === "file" &&
          attachment.canvasId === canvasId &&
          attachment.relPath === displayPath;
        if (attachment && !isReplay) {
          throw new Error(
            `upload_id "${file.upload_id}" is already attached to ${attachment.relPath}` +
              `${attachment.canvasId === canvasId ? " on this canvas" : " on another canvas"}.`,
          );
        }
        if (isReplay) {
          const existing = await ctx.runQuery(internal.canvases.getEditableFileByRef, {
            ref: canvasId,
            path: displayPath,
          });
          if (!existing) throw new Error(`Unable to resolve replayed upload ${displayPath}`);
          size = existing.size;
          contentHash = existing.contentHash;
        } else {
          const metadata = await ctx.storage.getMetadata(storageId);
          if (!metadata) {
            throw new Error(
              `upload_id "${file.upload_id}" does not exist. Upload bytes first, then pass the returned storageId.`,
            );
          }
          size = metadata.size;
          contentHash = metadata.sha256;
        }
      } else {
        const text = file.text as string;
        const bytes = new TextEncoder().encode(text);
        const { mime } = inferArtifactInfo(relPath);
        storageId = await ctx.storage.store(new Blob([bytes], { type: mime }));
        stored.push(storageId);
        size = bytes.byteLength;
        contentHash = await sha256Hex(text);
        writtenText.push({ path: displayPath, text });
      }
      changes.push({ type: "write", path: displayPath, storageId, size, contentHash });
      filesWritten.push({ path: displayPath, size_bytes: size });
    }
    return { changes, filesWritten, writtenText, stored };
  } catch (error) {
    await Promise.all(stored.map((storageId) => ctx.storage.delete(storageId)));
    throw error;
  }
}

const RenderInputSchema = z
  .object({
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("canvas") }).strict(),
      z
        .object({
          type: z.literal("file"),
          entrypoint: z.string().describe('Source file to render, e.g. "/src/index.html".'),
          route: z
            .string()
            .regex(/^#[/?A-Za-z0-9._~!$&'()*+,;=:@%-]*$/)
            .optional()
            .describe('Optional local URL fragment/hash route, e.g. "#/checkout".'),
        })
        .strict(),
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
      .strict()
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
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

type RenderInput = z.infer<typeof RenderInputSchema>;

const SnapshotTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("canvas") }).strict(),
  z.object({ type: z.literal("node"), node_id: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("region"),
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .strict(),
]);

const SnapshotInputSchema = z
  .object({
    ref: z.string().optional(),
    ref_id: z.string().optional(),
    target: SnapshotTargetSchema.optional(),
    page_id: z.string().optional().describe("Page id; defaults to defaultPageId."),
    expected_version: z.number().int().nonnegative().optional(),
    expected_draft_revision: z.number().int().nonnegative().optional(),
    padding: z.number().int().min(0).max(256).optional(),
    scale: z.union([z.literal(1), z.literal(2)]).optional(),
    refresh: z.boolean().optional().describe("Bypass an existing successful snapshot cache entry."),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(30_000)
      .optional()
      .describe("Iframe readiness budget; defaults to 15000."),
  })
  .strict()
  .superRefine((input, check) => {
    if (Boolean(input.ref) === Boolean(input.ref_id)) {
      check.addIssue({ code: "custom", message: "Pass exactly one of ref or ref_id." });
    }
    if (input.ref_id && input.target) {
      check.addIssue({
        code: "custom",
        message: "ref_id already identifies the node; omit target.",
      });
    }
  });

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
  versionId: Id<"canvasVersions">,
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
    const sources = await resolveCanvasSources(ctx, canvasId, versionId);
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
      route: spec.target.type === "file" ? spec.target.route : undefined,
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
    let recorded: { artifact: { relPath: string; role: string } };
    try {
      const attached = await ctx.runMutation(internal.canvases.attachCanvasRender, {
        canvasId,
        versionId,
        relPath: workerResult.relPath,
        type,
        mimeType: workerResult.mimeType,
        size: workerResult.size,
        storageId,
        thumbnailStorageId:
          workerResult.readiness?.status === "partial" ? undefined : thumbnailStorageId,
        primary: workerResult.readiness?.status === "partial" ? false : spec.primary,
      });
      recorded = { artifact: attached.artifact };
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

async function prepareSaveDoc(
  ctx: ActionCtx,
  rawDoc: unknown,
): Promise<{
  doc: CanvasFile;
  commit: {
    storageId: Id<"_storage">;
    contentHash: string;
    cssStorageId?: Id<"_storage">;
    entryStorageId: Id<"_storage">;
    entrySize: number;
    entryContentHash: string;
    iframeEntrypoints: string[];
    imagePaths: string[];
    nodes: Array<{
      pageId: string;
      nodeId: string;
      title: string;
      eyebrow?: string;
      searchText: string;
    }>;
  };
  stored: Id<"_storage">[];
}> {
  const doc = CanvasFileSchema.parse(rawDoc);
  const docJson = JSON.stringify(doc);
  const entry = canvasEntryHtml(resolveCanvasPage(doc).doc);
  const docBytes = new TextEncoder().encode(docJson);
  const entryBytes = new TextEncoder().encode(entry);
  const storageId = await ctx.storage.store(new Blob([docBytes], { type: "application/json" }));
  const entryStorageId = await ctx.storage.store(new Blob([entryBytes], { type: "text/html" }));
  return {
    doc,
    stored: [storageId, entryStorageId],
    commit: {
      storageId,
      contentHash: await sha256Hex(docJson),
      entryStorageId,
      entrySize: entryBytes.byteLength,
      entryContentHash: await sha256Hex(entry),
      iframeEntrypoints: [
        ...new Set(
          doc.pages.flatMap((page) =>
            page.doc.nodes
              .filter((node) => node.kind === "iframe")
              .map((node) => node.source.entrypoint),
          ),
        ),
      ],
      imagePaths: [
        ...new Set(
          doc.pages.flatMap((page) =>
            page.doc.nodes.filter((node) => node.kind === "image").map((node) => node.source.path),
          ),
        ),
      ],
      nodes: doc.pages.flatMap((page) =>
        page.doc.nodes.map((node) => ({
          pageId: page.id,
          nodeId: node.id,
          title: node.caption.title,
          eyebrow: node.inspector?.eyebrow ?? node.caption.tag,
          searchText: [
            page.title,
            node.caption.title,
            node.caption.subtitle,
            node.caption.tag,
            node.inspector?.eyebrow,
            node.inspector?.title,
            node.inspector?.copy,
          ]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join(" "),
        })),
      ),
    },
  };
}

async function saveCanvasFileDraft(
  ctx: ActionCtx,
  principal: McpPrincipal,
  canvasId: Id<"canvases">,
  file: CanvasFile,
  options: {
    expectedVersion?: number;
    expectedDraftRevision?: number;
    note?: string;
  },
) {
  const prepared = await prepareSaveDoc(ctx, file);
  try {
    return await ctx.runMutation(internal.canvases.commitSaveContent, {
      canvasId,
      expectedVersion: options.expectedVersion,
      expectedDraftRevision: options.expectedDraftRevision,
      createdBy: principal.userId,
      note: options.note,
      changes: [],
      doc: prepared.commit,
    });
  } catch (error) {
    await Promise.all(
      prepared.stored.map((storageId) => ctx.storage.delete(storageId).catch(() => undefined)),
    );
    throw error;
  }
}

async function loadCanvasFileByRef(ctx: ActionCtx, ref: string) {
  const detail = await ctx.runQuery(internal.canvases.detailByRef, {
    ref,
    includeDoc: true,
  });
  if (!detail?.canvas.doc_url) throw new Error(`CanvasFile not found for ref "${ref}"`);
  const source = await ctx.runQuery(internal.canvases.currentDocStorageByRef, { ref });
  const blob = source ? await ctx.storage.get(source.storageId) : null;
  if (!blob) throw new Error("CanvasFile storage object is unavailable");
  return {
    detail,
    file: CanvasFileSchema.parse(JSON.parse(await blob.text())),
  };
}

function pageSlug(title: string): string {
  const base = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return base || "page";
}

function canvasEntryHtml(
  doc: CanvasDoc,
  compiledCss = "",
  snapshotTarget?:
    | { type: "canvas" }
    | { type: "node"; nodeId: string }
    | { type: "region"; x: number; y: number; width: number; height: number },
): string {
  const positioned = layoutCanvas(doc);
  const { html } = renderCanvas(positioned, {
    iframeLoading: "eager",
    shouldLoadIframe: snapshotTarget
      ? (node) => {
          if (snapshotTarget.type === "canvas") return true;
          if (snapshotTarget.type === "node") return node.id === snapshotTarget.nodeId;
          return (
            node.x < snapshotTarget.x + snapshotTarget.width &&
            node.x + node.w > snapshotTarget.x &&
            node.y < snapshotTarget.y + snapshotTarget.height &&
            node.y + node.h > snapshotTarget.y
          );
        }
      : undefined,
  });
  return (
    '<!doctype html><html><head><meta charset="utf-8" />' +
    `<style>html,body{margin:0;padding:0}</style><style>${THEME_CSS}</style>` +
    `<style>${compiledCss}</style></head><body>${html}<script>addEventListener('message',function(e){if(!e.data||e.data.type!=='visual-canvas:readiness')return;for(const f of document.querySelectorAll('.vc-kind-iframe iframe'))if(f.contentWindow===e.source){const n=f.closest('.vc-kind-iframe');n.dataset.iframeReadiness=e.data.state;n.dataset.iframeReadinessDetail=typeof e.data.detail==='string'?e.data.detail:'';break}})</script></body></html>`
  );
}

/* ------------------------------------------------------------------------
 * Tool registration
 * ---------------------------------------------------------------------- */

const RefArg = z
  .string()
  .describe(
    '"workspace-slug/canvas-slug" (created on first save), canvas id, public slug, returned /c/ or /s/ URL, or canvas:// URI.',
  );

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
  const blob = await ctx.storage.get(file.storageId);
  if (!blob) throw new Error(`Unable to read ${file.path}: storage object is unavailable`);
  const content = await blob.text();
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
  expectedDraftRevision: number | undefined,
  prepared: PreparedPatchChange[],
  note?: string,
): Promise<{
  version: number;
  draftRevision: number;
  dirty: boolean;
  files: Array<{ path: string; content_hash?: string }>;
}> {
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
      expectedDraftRevision,
      changes,
      createdBy: principal.userId,
      note,
    });
    return {
      version: committed.version,
      draftRevision: committed.draftRevision,
      dirty: committed.dirty,
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
  previous_version: z.number(),
  version: z.number(),
  draft_revision: z.number().int().nonnegative(),
  dirty: z.boolean(),
  checkpointed: z.boolean(),
  published: z.boolean(),
  visibility: z.enum(["private", "public"]),
  canvas_url: z.string(),
  present_url: z.string().nullable(),
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

const AssetRecordOutputSchema = z.object({
  asset_id: z.string(),
  asset_ref: z.string(),
  scope: z.enum(["personal", "workspace"]),
  workspace_slug: z.string().nullable(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  kind: z.enum(["image", "svg", "font", "video", "data"]),
  revision: z.number().int().positive(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  content_hash: z.string(),
  original_filename: z.string(),
  updated_at: z.number(),
  preview_url: z.string(),
});

const AssetSavedOutputSchema = z.object({
  status: z.literal("ok"),
  asset_id: z.string(),
  asset_ref: z.string(),
  revision: z.number().int().positive(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  content_hash: z.string(),
});

type AssetFinalizeItem = {
  upload_id: string;
  slug?: string;
  name: string;
  description?: string;
  tags?: string[];
};

class AssetFinalizeFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AssetFinalizeFailure";
  }
}

async function finalizeUploadedAsset(
  ctx: ActionCtx,
  principal: McpPrincipal,
  input: AssetFinalizeItem,
) {
  const uploadId = input.upload_id as Id<"assetUploads">;
  const upload = await ctx.runQuery(internal.assets.getUpload, {
    uploadId,
    userId: principal.userId,
    now: Date.now(),
  });
  if (!upload) throw new AssetFinalizeFailure("Upload does not exist or has expired", false);
  const response = await getObject("source", upload.sourceObjectKey);
  if (!response.ok) throw new Error(`Uploaded object is unavailable: HTTP ${response.status}`);
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
  // The DB commit above is authoritative. Staging cleanup must never turn a
  // successful finalize into a false retryable failure after upload_id vanished.
  await deleteObject("source", upload.sourceObjectKey).catch(() => undefined);
  return {
    status: "ok" as const,
    asset_id: saved.assetId,
    asset_ref: saved.assetRef,
    revision: saved.revision,
    mime_type: saved.mimeType,
    size_bytes: saved.size,
    content_hash: saved.contentHash,
  };
}

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
      inputSchema: z
        .object({
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
              "CanvasFile v3: {version:3, defaultPageId, pages:[{id,title,order,doc:CanvasDocV2}], prototype:{start?,interactions}}. The complete multi-page file is saved atomically as a durable draft.",
            ),
          files: z.array(FileInputSchema).max(500).optional(),
          renders: z.array(RenderInputSchema).max(4).optional(),
          visibility: z
            .enum(["private", "public"])
            .optional()
            .describe("Omit to leave unchanged. 'public' mints a share link."),
          mode: z
            .enum(["upsert", "create", "update"])
            .optional()
            .describe(
              "'create' refuses to touch an existing canvas; 'update' refuses to make one.",
            ),
          expected_version: z
            .number()
            .optional()
            .describe("Refuse the write if the canvas is not at this version."),
          expected_draft_revision: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Refuse the write if the durable draft has changed."),
          note: z.string().optional().describe("Milestone note used if this save publishes."),
        })
        .strict(),
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
          deferExistingMetadata: true,
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

        // --- content ---
        // Resolve/upload every source first, then expose all file/binding/doc
        // changes atomically in the durable draft. Initial creation establishes
        // v1; later saves remain coalesced until checkpoint or publish.
        let preparedFiles: Awaited<ReturnType<typeof prepareSaveFiles>> | undefined;
        let preparedDoc: Awaited<ReturnType<typeof prepareSaveDoc>> | undefined;
        let committed: {
          versionId: Id<"canvasVersions"> | null;
          version: number;
          previousVersion: number;
          changed: boolean;
          draftRevision: number;
          dirty: boolean;
        } | null = null;
        try {
          preparedFiles = await prepareSaveFiles(
            ctx,
            canvasId,
            principal.userId,
            input.files ?? [],
          );
          preparedDoc = input.doc === undefined ? undefined : await prepareSaveDoc(ctx, input.doc);
          if (
            preparedFiles.changes.length > 0 ||
            preparedDoc ||
            input.title !== undefined ||
            input.description !== undefined ||
            input.theme !== undefined ||
            input.visibility !== undefined
          ) {
            committed = await ctx.runMutation(internal.canvases.commitSaveContent, {
              canvasId,
              expectedVersion: input.expected_version,
              expectedDraftRevision: input.expected_draft_revision,
              createdBy: principal.userId,
              note: input.note,
              metadata: {
                title: input.title,
                description: input.description,
                theme: input.theme,
                visibility: input.visibility,
                newPublicSlug: input.visibility === "public" ? randomShareSlug() : undefined,
              },
              changes: preparedFiles.changes,
              doc: preparedDoc?.commit,
            });
          }
        } catch (error) {
          await Promise.all(
            [...(preparedFiles?.stored ?? []), ...(preparedDoc?.stored ?? [])].map((storageId) =>
              ctx.storage.delete(storageId).catch(() => undefined),
            ),
          );
          if (upserted.created) {
            await ctx
              .runMutation(internal.canvases.removeByRef, {
                ref: canvasId,
                target: "canvas",
                purge: true,
              })
              .catch(() => undefined);
          }
          throw error;
        }

        const filesWritten = preparedFiles?.filesWritten ?? [];
        const writtenText = preparedFiles?.writtenText ?? [];

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

        // --- geometry the author cannot see ---
        if (preparedDoc) {
          warnings.push(...scanNodeOverlaps(preparedDoc.doc.pages));
        }

        // --- renders ---
        const artifacts: RenderedArtifact[] = [];
        let renderVersionId = committed?.versionId ?? null;
        if ((input.renders?.length ?? 0) > 0 && !renderVersionId) {
          renderVersionId =
            (await ctx.runQuery(internal.canvases.currentVersion, { canvasId }))?.versionId ?? null;
        }
        for (const spec of input.renders ?? []) {
          if (!renderVersionId) {
            warnings.push({
              code: "render_failed",
              message:
                "Render requires a committed source version. Save files or a CanvasDoc first.",
            });
            break;
          }
          const rendered = await performRender(ctx, canvasId, principal, spec, renderVersionId);
          if (rendered.artifact) artifacts.push(rendered.artifact);
          warnings.push(...rendered.warnings);
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

        const degraded = warnings.some(
          (warning) => warning.code === "render_failed" || warning.code === "unresolved_asset",
        );
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
          status: degraded ? "partial" : "ok",
          created: upserted.created,
          ref: `${upserted.workspaceSlug}/${upserted.canvasSlug}`,
          canvas_id: canvasId,
          workspace_slug: upserted.workspaceSlug,
          canvas_slug: upserted.canvasSlug,
          kind: detail.canvas.kind,
          title: detail.canvas.title,
          previous_version: committed?.previousVersion ?? detail.canvas.version ?? 0,
          version: detail.canvas.version ?? 0,
          draft_revision: detail.canvas.draft_revision,
          dirty: detail.canvas.dirty,
          checkpointed: Boolean(committed && !committed.dirty),
          published: (detail.canvas.version ?? 0) > 0,
          visibility: detail.canvas.visibility,
          canvas_url: canvasUrl(canvasId),
          present_url: detail.canvas.kind === "canvas" ? `${canvasUrl(canvasId)}/present` : null,
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
        "Updates the durable draft and rejects stale version, draft revision, or hash values.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          file_path: z.string(),
          old_string: z.string(),
          new_string: z.string(),
          replace_all: z.boolean().optional(),
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative().optional(),
          expected_hash: z.string().optional(),
          note: z.string().optional(),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        file_path: z.string(),
        replacements: z.number().int().positive(),
        previous_hash: z.string(),
        content_hash: z.string(),
        requested_version: z.number().int().nonnegative(),
        previous_version: z.number().int().nonnegative(),
        version: z.number().int().positive(),
        draft_revision: z.number().int().nonnegative(),
        dirty: z.boolean(),
        rebased: z.boolean(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const source = await loadEditableFile(ctx, input.ref, input.file_path);
        if (
          input.expected_hash &&
          input.expected_hash.replace(/^sha256:/, "") !== source.contentHash
        ) {
          throw new Error(
            `hash_conflict: expected ${input.expected_hash}, current ${source.contentHash}`,
          );
        }
        if (source.version !== input.expected_version && !input.expected_hash) {
          const changedPaths = await ctx.runQuery(internal.canvases.changedPathsSinceVersion, {
            canvasId: source.canvasId,
            expectedVersion: input.expected_version,
          });
          throw new Error(
            `version_conflict: ${JSON.stringify({ expected_version: input.expected_version, current_version: source.version, changed_paths_since: changedPaths, retryable: true, retryable_with_expected_hash: true })}`,
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
          source.version,
          input.expected_draft_revision,
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
        const contentHash = committed.files[0]?.content_hash;
        if (!contentHash) throw new Error("canvas_edit committed without a content hash");
        return result({
          status: "ok",
          ref: input.ref,
          file_path: source.path,
          replacements: edited.replacements,
          previous_hash: source.contentHash,
          content_hash: contentHash,
          requested_version: input.expected_version,
          previous_version: source.version,
          version: committed.version,
          draft_revision: committed.draftRevision,
          dirty: committed.dirty,
          rebased: source.version !== input.expected_version,
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
      inputSchema: z
        .object({
          ref: RefArg,
          patch: z.string(),
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative().optional(),
          expected_hashes: z
            .record(z.string(), z.string())
            .optional()
            .describe(
              "Current file hashes from canvas_get/canvas_file_get. Required for every existing file when safely rebasing a stale expected_version.",
            ),
          note: z.string().optional(),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        requested_version: z.number().int().nonnegative(),
        previous_version: z.number().int().nonnegative(),
        version: z.number().int().positive(),
        draft_revision: z.number().int().nonnegative(),
        dirty: z.boolean(),
        rebased: z.boolean(),
        files: z.array(z.object({ path: z.string(), content_hash: z.string().optional() })),
      }),
    },
    async (input) =>
      runTool(async () => {
        let canvasId: Id<"canvases"> | undefined;
        let currentVersion: number | undefined;
        const cache = new Map<string, Awaited<ReturnType<typeof loadEditableFile>> | null>();
        const prepared = await prepareApplyPatch(input.patch, async (path) => {
          if (cache.has(path)) {
            const cached = cache.get(path);
            return cached ? { content: cached.content, hash: cached.contentHash } : null;
          }
          try {
            const file = await loadEditableFile(ctx, input.ref, path);
            canvasId = file.canvasId;
            currentVersion = file.version;
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
          currentVersion = detail.canvas.version ?? 0;
        }
        if (currentVersion === undefined) {
          throw new Error(`No canvas version found for ref "${input.ref}"`);
        }
        if (currentVersion !== input.expected_version) {
          const staleFiles = [...cache.values()].filter(
            (file): file is NonNullable<typeof file> => file !== null,
          );
          const mismatch = staleFiles.find(
            (file) =>
              input.expected_hashes?.[file.path]?.replace(/^sha256:/, "") !== file.contentHash,
          );
          if (mismatch || staleFiles.length === 0) {
            const changedPaths = await ctx.runQuery(internal.canvases.changedPathsSinceVersion, {
              canvasId,
              expectedVersion: input.expected_version,
            });
            throw new Error(
              `version_conflict: ${JSON.stringify({ expected_version: input.expected_version, current_version: currentVersion, changed_paths_since: changedPaths, retryable: true, retryable_with_expected_hashes: staleFiles.map((file) => file.path) })}`,
            );
          }
        }
        const committed = await commitPreparedFileChanges(
          ctx,
          principal,
          canvasId,
          currentVersion,
          input.expected_draft_revision,
          prepared,
          input.note,
        );
        return result({
          status: "ok",
          ref: input.ref,
          requested_version: input.expected_version,
          previous_version: currentVersion,
          version: committed.version,
          draft_revision: committed.draftRevision,
          dirty: committed.dirty,
          rebased: currentVersion !== input.expected_version,
          files: committed.files,
        });
      }),
  );

  const rootChangesSchema = z
    .record(z.string(), z.unknown())
    .describe(
      "Shallow entity-root merge. Nested objects are replaced, not deep-merged; changing rect.x requires the complete {x,y,w,h} rect.",
    );
  const entityValueSchema = z
    .unknown()
    .describe("Complete CanvasDoc entity, validated as part of the final document.");
  const docPatchCollections = ["lanes", "stages", "labels", "nodes", "groups", "edges"] as const;
  const docPatchOperationSchema = z.discriminatedUnion("op", [
    z
      .object({
        op: z.literal("world.update"),
        changes: rootChangesSchema.describe("World changes; width and height remain positive."),
      })
      .strict(),
    ...docPatchCollections.flatMap((collection) => [
      z.object({ op: z.literal(`${collection}.add`), value: entityValueSchema }).strict(),
      z
        .object({
          op: z.literal(`${collection}.update`),
          id: z.string().min(1),
          changes: rootChangesSchema,
        })
        .strict(),
      z
        .object({
          op: z.literal(`${collection}.replace`),
          id: z.string().min(1),
          value: entityValueSchema.describe(
            "Complete replacement. Omitted optional fields are cleared; id is preserved from the operation.",
          ),
        })
        .strict(),
      z.object({ op: z.literal(`${collection}.remove`), id: z.string().min(1) }).strict(),
    ]),
  ]);

  const DocPatchOutputSchema = z.object({
    status: z.enum(["ok", "partial"]),
    ref: z.string(),
    previous_version: z.number(),
    version: z.number(),
    draft_revision: z.number().int().nonnegative(),
    dirty: z.boolean(),
    page_id: z.string(),
    operations: z.number(),
    warnings: z.array(WarningSchema),
  });

  server.registerTool(
    "canvas_doc_patch",
    {
      title: "Patch CanvasDoc entities",
      description:
        "Atomically patches CanvasDoc v2 entities, including Figma-like groups. Operation names are plural: nodes.update, " +
        "not node.update/update_node. add requires a complete value; update requires id plus " +
        "shallow root-level changes; replace requires id plus a complete value and can clear " +
        "optional fields; remove requires id; world.update requires changes. Nested objects are " +
        "replaced, so changing rect.x requires a complete {x,y,w,h} rect. Read the doc first and " +
        "pass its version as expected_version. Example: {op:'nodes.update',id:'phone',changes:{" +
        "rect:{x:10,y:20,w:310,h:708}}}. The final graph is validated atomically.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative(),
          page_id: z.string().optional().describe("Page id; defaults to the file's default Page."),
          operations: z.array(docPatchOperationSchema).min(1).max(100),
          note: z.string().optional(),
        })
        .strict(),
      outputSchema: DocPatchOutputSchema,
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
        const currentFile = CanvasFileSchema.parse(await response.json());
        const currentPage = resolveCanvasPage(currentFile, input.page_id);
        if (input.page_id && currentPage.id !== input.page_id) {
          throw new Error(`page_not_found: ${input.page_id}`);
        }
        const patchedDoc = applyCanvasDocPatch(
          currentPage.doc,
          input.operations as CanvasDocPatchOperation[],
        );
        const patchedFile = CanvasFileSchema.parse({
          ...currentFile,
          pages: currentFile.pages.map((page) =>
            page.id === currentPage.id ? { ...page, doc: patchedDoc } : page,
          ),
        });
        const saved = await saveCanvasFileDraft(
          ctx,
          principal,
          detail.canvas.canvas_id,
          patchedFile,
          {
            expectedVersion: input.expected_version,
            expectedDraftRevision: input.expected_draft_revision,
            note: input.note ?? `CanvasDoc patch (${input.operations.length})`,
          },
        );
        return result({
          status: "ok",
          ref: input.ref,
          previous_version: input.expected_version,
          version: saved.version,
          draft_revision: saved.draftRevision,
          dirty: saved.dirty,
          page_id: currentPage.id,
          operations: input.operations.length,
          warnings: dedupeWarnings(
            scanNodeOverlaps([
              { id: currentPage.id, title: currentPage.title, doc: patchedDoc },
            ]),
          ),
        });
      }),
  );

  /* --- batch node operations (UI gesture parity) ------------------------ */
  /*
   * A human's marquee selection produces one gesture over many nodes, and an
   * agent asked to "move these five left" should produce the same single
   * atomic write rather than five racing patches. The marquee itself is a UI
   * interaction and is deliberately not modelled here — only its result.
   */
  const NodesMoveOutputSchema = z.object({
    status: z.literal("ok"),
    ref: z.string(),
    page_id: z.string(),
    version: z.number().int().nonnegative(),
    draft_revision: z.number().int().nonnegative(),
    dirty: z.boolean(),
    moved_node_ids: z.array(z.string()),
    dx: z.number(),
    dy: z.number(),
    warnings: z.array(WarningSchema),
  });

  server.registerTool(
    "canvas_nodes_move",
    {
      title: "Move nodes together",
      description:
        "Translates a set of nodes on one Page by the same dx/dy in a single atomic write, " +
        "preserving their relative arrangement. This is the equivalent of a human dragging a " +
        "multi-selection. Rejects stale version or draft revision values and unknown node ids.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative(),
          page_id: z.string().optional().describe("Page id; defaults to the file's default Page."),
          node_ids: z.array(z.string().min(1)).min(1).max(1_000),
          dx: z.number().finite(),
          dy: z.number().finite(),
          note: z.string().optional(),
        })
        .strict(),
      outputSchema: NodesMoveOutputSchema,
    },
    async (input) =>
      runTool(async () => {
        const loaded = await loadCanvasFileByRef(ctx, input.ref);
        const currentVersion = loaded.detail.canvas.version ?? 0;
        if (currentVersion !== input.expected_version) {
          throw new Error(
            `version_conflict: expected ${input.expected_version}, current ${currentVersion}`,
          );
        }
        const page = resolveCanvasPage(loaded.file, input.page_id);
        if (input.page_id && page.id !== input.page_id) {
          throw new Error(`page_not_found: ${input.page_id}`);
        }
        const nodeIds = [...new Set(input.node_ids)];
        const movedDoc = CanvasDocSchema.parse(moveNodes(page.doc, nodeIds, input.dx, input.dy));
        const nextFile = CanvasFileSchema.parse({
          ...loaded.file,
          pages: loaded.file.pages.map((candidate) =>
            candidate.id === page.id ? { ...candidate, doc: movedDoc } : candidate,
          ),
        });
        const saved = await saveCanvasFileDraft(
          ctx,
          principal,
          loaded.detail.canvas.canvas_id,
          nextFile,
          {
            expectedVersion: input.expected_version,
            expectedDraftRevision: input.expected_draft_revision,
            note: input.note ?? `Moved ${nodeIds.length} nodes`,
          },
        );
        return result({
          status: "ok",
          ref: input.ref,
          page_id: page.id,
          version: saved.version,
          draft_revision: saved.draftRevision,
          dirty: saved.dirty,
          moved_node_ids: nodeIds,
          dx: input.dx,
          dy: input.dy,
          warnings: dedupeWarnings(
            scanNodeOverlaps([{ id: page.id, title: page.title, doc: movedDoc }]),
          ),
        });
      }),
  );

  const NodesDeleteOutputSchema = z.object({
    status: z.literal("ok"),
    ref: z.string(),
    page_id: z.string(),
    version: z.number().int().nonnegative(),
    draft_revision: z.number().int().nonnegative(),
    dirty: z.boolean(),
    removed_node_ids: z.array(z.string()),
    removed_edge_ids: z.array(z.string()),
    removed_group_ids: z.array(z.string()),
    removed_interaction_ids: z.array(z.string()),
    cleared_prototype_start: z.boolean(),
  });

  server.registerTool(
    "canvas_nodes_delete",
    {
      title: "Delete nodes",
      description:
        "Deletes a set of nodes from one Page together with everything that only existed " +
        "because of them: edges touching either end, empty groups, and prototype interactions " +
        "or a start screen pointing at them. One atomic write; the detailed result names every " +
        "removed id. Rejects stale version or draft revision values and unknown node ids.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative(),
          page_id: z.string().optional().describe("Page id; defaults to the file's default Page."),
          node_ids: z.array(z.string().min(1)).min(1).max(1_000),
          note: z.string().optional(),
        })
        .strict(),
      outputSchema: NodesDeleteOutputSchema,
    },
    async (input) =>
      runTool(async () => {
        const loaded = await loadCanvasFileByRef(ctx, input.ref);
        const currentVersion = loaded.detail.canvas.version ?? 0;
        if (currentVersion !== input.expected_version) {
          throw new Error(
            `version_conflict: expected ${input.expected_version}, current ${currentVersion}`,
          );
        }
        const page = resolveCanvasPage(loaded.file, input.page_id);
        if (input.page_id && page.id !== input.page_id) {
          throw new Error(`page_not_found: ${input.page_id}`);
        }
        const deleted = deleteNodesFromFile(loaded.file, page.id, [...new Set(input.node_ids)]);
        const nextFile = CanvasFileSchema.parse(deleted.file);
        const saved = await saveCanvasFileDraft(
          ctx,
          principal,
          loaded.detail.canvas.canvas_id,
          nextFile,
          {
            expectedVersion: input.expected_version,
            expectedDraftRevision: input.expected_draft_revision,
            note: input.note ?? `Deleted ${deleted.removedNodeIds.length} nodes`,
          },
        );
        return result({
          status: "ok",
          ref: input.ref,
          page_id: page.id,
          version: saved.version,
          draft_revision: saved.draftRevision,
          dirty: saved.dirty,
          removed_node_ids: deleted.removedNodeIds,
          removed_edge_ids: deleted.removedEdgeIds,
          removed_group_ids: deleted.removedGroupIds,
          removed_interaction_ids: deleted.removedInteractionIds,
          cleared_prototype_start: deleted.clearedStart,
        });
      }),
  );

  /* --- reusable components --------------------------------------------- */
  /*
   * An agent that has drawn a good flow once had no way to carry it to the
   * next canvas: nothing moved a group of nodes *and the edges between them*
   * between documents. Components are that bundle, addressed like canvases
   * ("workspace/component") and inserted as an independent copy — no
   * master/instance link, so two insertions can never disturb each other.
   */
  const ComponentRefArg = z
    .string()
    .describe('"workspace-slug/component-slug", e.g. "osago/login-flow".');

  const ComponentSummarySchema = z.object({
    ref: z.string(),
    component_id: z.string(),
    workspace_slug: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()),
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    size: z.object({ width: z.number(), height: z.number() }),
    version: z.number().int().nonnegative(),
    updated_at: z.number(),
  });

  /** Body plus derived counts, from either authoring mode. */
  async function resolveComponentBody(input: {
    nodes?: unknown[];
    edges?: unknown[];
    from?: { ref: string; page_id?: string; node_ids: string[] };
  }) {
    if (input.from) {
      const loaded = await loadCanvasFileByRef(ctx, input.from.ref);
      const page = resolveCanvasPage(loaded.file, input.from.page_id);
      if (input.from.page_id && page.id !== input.from.page_id) {
        throw new Error(`page_not_found: ${input.from.page_id}`);
      }
      return extractComponent(page.doc, input.from.node_ids);
    }
    if (!input.nodes) {
      throw new Error("Provide either nodes (+ edges) or from:{ref,node_ids}.");
    }
    return CanvasComponentBodySchema.parse({ nodes: input.nodes, edges: input.edges ?? [] });
  }

  server.registerTool(
    "component_save",
    {
      title: "Save a reusable component",
      description:
        "Creates or updates a reusable block of nodes and the edges between them, addressed as " +
        '"workspace-slug/component-slug". Author it inline with nodes/edges, or capture it from ' +
        "an existing canvas with from:{ref,page_id?,node_ids}. Geometry is stored relative to the " +
        "block's own top-left corner and lane/stage references are dropped, since a component " +
        "must insert into any page. Pass expected_version when updating.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z
        .object({
          ref: ComponentRefArg,
          name: z.string().min(1).max(160),
          description: z.string().max(2_000).optional(),
          tags: z.array(z.string().min(1).max(40)).max(20).optional(),
          nodes: z.array(z.unknown()).optional().describe("Complete CanvasDoc v2 nodes."),
          edges: z.array(z.unknown()).optional().describe("Edges between those nodes only."),
          from: z
            .object({
              ref: RefArg,
              page_id: z.string().optional(),
              node_ids: z.array(z.string().min(1)).min(1).max(200),
            })
            .strict()
            .optional()
            .describe("Capture the block from an existing canvas instead of writing it inline."),
          expected_version: z.number().int().nonnegative().optional(),
        })
        .strict(),
      outputSchema: ComponentSummarySchema.extend({ created: z.boolean() }),
    },
    async (input) =>
      runTool(async () => {
        const { workspaceSlug, componentSlug } = parseComponentRef(input.ref);
        const body = await resolveComponentBody(input);
        const size = componentSize(body);
        const saved = await ctx.runMutation(internal.components.upsert, {
          workspaceSlug,
          slug: componentSlug,
          name: input.name,
          description: input.description,
          tags: input.tags ?? [],
          bodyJson: JSON.stringify(body),
          nodeCount: body.nodes.length,
          edgeCount: body.edges.length,
          width: size.width,
          height: size.height,
          expectedVersion: input.expected_version,
          createdBy: principal.userId,
        });
        return result(saved);
      }),
  );

  server.registerTool(
    "component_get",
    {
      title: "Read a component",
      description:
        "Returns a component's metadata, and its nodes and edges when include_body is true. " +
        "Geometry is relative to the component's own origin; component_insert offsets it.",
      annotations: { readOnlyHint: true },
      inputSchema: z
        .object({ ref: ComponentRefArg, include_body: z.boolean().optional() })
        .strict(),
      outputSchema: ComponentSummarySchema.extend({
        nodes: z.array(z.unknown()).optional(),
        edges: z.array(z.unknown()).optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const { workspaceSlug, componentSlug } = parseComponentRef(input.ref);
        const found = await ctx.runQuery(internal.components.getByRef, {
          workspaceSlug,
          slug: componentSlug,
          includeBody: input.include_body === true,
        });
        if (!found) throw new Error(`component_not_found: ${input.ref}`);
        const { body_json, ...summary } = found;
        const body = body_json ? (JSON.parse(body_json) as CanvasComponentBody) : null;
        return result(body ? { ...summary, nodes: body.nodes, edges: body.edges } : summary);
      }),
  );

  server.registerTool(
    "component_find",
    {
      title: "Find components",
      description:
        "Searches saved components by name, description, tags and slug. Restrict with workspace " +
        "or tag; omit query to browse the most recently updated.",
      annotations: { readOnlyHint: true },
      inputSchema: z
        .object({
          query: z.string().optional(),
          workspace: z.string().optional(),
          tag: z.string().optional(),
          limit: z.number().int().positive().max(100).optional(),
        })
        .strict(),
      outputSchema: z.object({ components: z.array(ComponentSummarySchema) }),
    },
    async (input) =>
      runTool(async () => {
        const components = await ctx.runQuery(internal.components.find, {
          query: input.query,
          workspaceSlug: input.workspace,
          tag: input.tag,
          limit: input.limit,
        });
        return result({ components });
      }),
  );

  server.registerTool(
    "component_insert",
    {
      title: "Insert a component into a canvas",
      description:
        "Copies a component into one Page at a world point, in a single atomic write. Every " +
        "node and edge id is remapped and internal edges are re-bound to the copies, so two " +
        "insertions are independent and later component edits never touch them. Optionally " +
        "attaches the copies to a lane/stage and groups them. Iframe and image nodes still need " +
        "their files present in the target canvas. Rejects stale version or draft revision values.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: ComponentRefArg,
          target: z
            .object({ ref: RefArg, page_id: z.string().optional() })
            .strict(),
          at: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative(),
          lane_id: z.string().optional(),
          stage_id: z.string().optional(),
          group_label: z.string().min(1).max(160).optional(),
          id_prefix: z
            .string()
            .min(1)
            .max(60)
            .optional()
            .describe("Prefix for generated ids; defaults to the component slug."),
          note: z.string().optional(),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        component_ref: z.string(),
        page_id: z.string(),
        version: z.number().int().nonnegative(),
        draft_revision: z.number().int().nonnegative(),
        dirty: z.boolean(),
        node_ids: z.record(z.string(), z.string()),
        edge_ids: z.record(z.string(), z.string()),
        group_id: z.string().optional(),
        warnings: z.array(WarningSchema),
      }),
    },
    async (input) =>
      runTool(async () => {
        const { workspaceSlug, componentSlug } = parseComponentRef(input.ref);
        const found = await ctx.runQuery(internal.components.getByRef, {
          workspaceSlug,
          slug: componentSlug,
          includeBody: true,
        });
        if (!found?.body_json) throw new Error(`component_not_found: ${input.ref}`);
        const body = CanvasComponentBodySchema.parse(JSON.parse(found.body_json));

        const loaded = await loadCanvasFileByRef(ctx, input.target.ref);
        const currentVersion = loaded.detail.canvas.version ?? 0;
        if (currentVersion !== input.expected_version) {
          throw new Error(
            `version_conflict: expected ${input.expected_version}, current ${currentVersion}`,
          );
        }
        const page = resolveCanvasPage(loaded.file, input.target.page_id);
        if (input.target.page_id && page.id !== input.target.page_id) {
          throw new Error(`page_not_found: ${input.target.page_id}`);
        }
        const inserted = insertComponent(page.doc, body, {
          at: input.at,
          laneId: input.lane_id,
          stageId: input.stage_id,
          groupLabel: input.group_label,
          idPrefix: input.id_prefix ?? componentSlug,
        });
        const nextDoc = CanvasDocSchema.parse(inserted.doc);
        const nextFile = CanvasFileSchema.parse({
          ...loaded.file,
          pages: loaded.file.pages.map((candidate) =>
            candidate.id === page.id ? { ...candidate, doc: nextDoc } : candidate,
          ),
        });
        const saved = await saveCanvasFileDraft(
          ctx,
          principal,
          loaded.detail.canvas.canvas_id,
          nextFile,
          {
            expectedVersion: input.expected_version,
            expectedDraftRevision: input.expected_draft_revision,
            note: input.note ?? `Inserted component ${input.ref}`,
          },
        );
        return result({
          status: "ok",
          ref: input.target.ref,
          component_ref: input.ref,
          page_id: page.id,
          version: saved.version,
          draft_revision: saved.draftRevision,
          dirty: saved.dirty,
          node_ids: inserted.nodeIds,
          edge_ids: inserted.edgeIds,
          group_id: inserted.groupId,
          warnings: dedupeWarnings(
            scanNodeOverlaps([{ id: page.id, title: page.title, doc: nextDoc }]),
          ),
        });
      }),
  );

  server.registerTool(
    "component_delete",
    {
      title: "Delete a component",
      description:
        "Permanently removes a saved component. Canvases that already contain copies are " +
        "untouched: insertion copies, so nothing references this row.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({ ref: ComponentRefArg }).strict(),
      outputSchema: z.object({ deleted: z.boolean(), ref: z.string() }),
    },
    async (input) =>
      runTool(async () => {
        const { workspaceSlug, componentSlug } = parseComponentRef(input.ref);
        const removed = await ctx.runMutation(internal.components.remove, {
          workspaceSlug,
          slug: componentSlug,
        });
        return result({ deleted: removed.deleted, ref: input.ref });
      }),
  );

  const PageSummarySchema = z.object({
    id: z.string(),
    title: z.string(),
    order: z.number().int().nonnegative(),
    is_default: z.boolean(),
  });
  const PageMutationOutputSchema = z.object({
    status: z.literal("ok"),
    ref: z.string(),
    version: z.number().int().nonnegative(),
    draft_revision: z.number().int().nonnegative(),
    dirty: z.boolean(),
    page: PageSummarySchema.optional(),
    pages: z.array(PageSummarySchema),
  });
  const pageSummaries = (file: CanvasFile) =>
    [...file.pages]
      .sort((left, right) => left.order - right.order)
      .map((page) => ({
        id: page.id,
        title: page.title,
        order: page.order,
        is_default: page.id === file.defaultPageId,
      }));
  const savePageMutation = async (
    input: {
      ref: string;
      expected_version: number;
      expected_draft_revision: number;
      note?: string;
    },
    mutate: (file: CanvasFile) => { file: CanvasFile; pageId?: string },
  ) => {
    const loaded = await loadCanvasFileByRef(ctx, input.ref);
    if ((loaded.detail.canvas.version ?? 0) !== input.expected_version) {
      throw new Error(
        `version_conflict: expected ${input.expected_version}, current ${loaded.detail.canvas.version ?? 0}`,
      );
    }
    const changed = mutate(loaded.file);
    const saved = await saveCanvasFileDraft(
      ctx,
      principal,
      loaded.detail.canvas.canvas_id,
      changed.file,
      {
        expectedVersion: input.expected_version,
        expectedDraftRevision: input.expected_draft_revision,
        note: input.note,
      },
    );
    const page = changed.pageId
      ? pageSummaries(changed.file).find((candidate) => candidate.id === changed.pageId)
      : undefined;
    return result({
      status: "ok" as const,
      ref: input.ref,
      version: saved.version,
      draft_revision: saved.draftRevision,
      dirty: saved.dirty,
      page,
      pages: pageSummaries(changed.file),
    });
  };

  server.registerTool(
    "canvas_checkpoint",
    {
      title: "Create canvas checkpoint",
      description:
        "Atomically snapshots the complete durable draft — all Pages, prototype state, files and asset bindings — as one immutable version.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          expected_draft_revision: z.number().int().nonnegative().optional(),
          note: z.string().max(240).optional(),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        version: z.number().int().positive(),
        draft_revision: z.number().int().nonnegative(),
        dirty: z.literal(false),
        canvas_url: z.string(),
        present_url: z.string(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const checkpoint = await ctx.runMutation(internal.canvases.checkpointByRef, {
          ref: input.ref,
          createdBy: principal.userId,
          note: input.note,
          expectedDraftRevision: input.expected_draft_revision,
        });
        return result({
          status: "ok" as const,
          ref: input.ref,
          version: checkpoint.version,
          draft_revision: checkpoint.draftRevision,
          dirty: false as const,
          canvas_url: canvasUrl(checkpoint.canvasId),
          present_url: `${canvasUrl(checkpoint.canvasId)}/present`,
        });
      }),
  );

  server.registerTool(
    "canvas_page_list",
    {
      title: "List canvas Pages",
      description: "Lists every Page in file order and identifies the default Page.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ ref: RefArg }).strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        version: z.number().int().nonnegative(),
        draft_revision: z.number().int().nonnegative(),
        dirty: z.boolean(),
        pages: z.array(PageSummarySchema),
      }),
    },
    async (input) =>
      runTool(async () => {
        const loaded = await loadCanvasFileByRef(ctx, input.ref);
        return result({
          status: "ok" as const,
          ref: input.ref,
          version: loaded.detail.canvas.version ?? 0,
          draft_revision: loaded.detail.canvas.draft_revision,
          dirty: loaded.detail.canvas.dirty,
          pages: pageSummaries(loaded.file),
        });
      }),
  );

  const pageWriteBase = {
    ref: RefArg,
    expected_version: z.number().int().nonnegative(),
    expected_draft_revision: z.number().int().nonnegative(),
    note: z.string().max(240).optional(),
  };

  server.registerTool(
    "canvas_page_create",
    {
      title: "Create canvas Page",
      description: "Creates an independently editable Page and appends it to the canvas file.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ...pageWriteBase,
          title: z.string().min(1).max(120),
          page_id: z.string().optional(),
          doc: z.unknown().optional(),
        })
        .strict(),
      outputSchema: PageMutationOutputSchema,
    },
    async (input) =>
      runTool(() =>
        savePageMutation(input, (file) => {
          const requested = input.page_id ?? pageSlug(input.title);
          let id = requested;
          let suffix = 2;
          while (file.pages.some((page) => page.id === id)) id = `${requested}-${suffix++}`;
          const template = resolveCanvasPage(file).doc;
          const doc = input.doc
            ? CanvasDocSchema.parse(input.doc)
            : CanvasDocSchema.parse({
                ...template,
                title: input.title,
                subtitle: undefined,
                lanes: [],
                stages: [],
                labels: [],
                nodes: [],
                edges: [],
                legend: undefined,
              });
          const next = CanvasFileSchema.parse({
            ...file,
            pages: [...file.pages, { id, title: input.title, order: file.pages.length, doc }],
          });
          return { file: next, pageId: id };
        }),
      ),
  );

  server.registerTool(
    "canvas_page_rename",
    {
      title: "Rename canvas Page",
      description: "Renames a Page without changing its stable id or authored content.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z
        .object({ ...pageWriteBase, page_id: z.string(), title: z.string().min(1).max(120) })
        .strict(),
      outputSchema: PageMutationOutputSchema,
    },
    async (input) =>
      runTool(() =>
        savePageMutation(input, (file) => {
          if (!file.pages.some((page) => page.id === input.page_id))
            throw new Error(`page_not_found: ${input.page_id}`);
          return {
            file: CanvasFileSchema.parse({
              ...file,
              pages: file.pages.map((page) =>
                page.id === input.page_id ? { ...page, title: input.title } : page,
              ),
            }),
            pageId: input.page_id,
          };
        }),
      ),
  );

  server.registerTool(
    "canvas_page_duplicate",
    {
      title: "Duplicate canvas Page",
      description:
        "Duplicates one Page with a new stable id; prototype interactions are not copied.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ...pageWriteBase,
          page_id: z.string(),
          title: z.string().min(1).max(120).optional(),
          new_page_id: z.string().optional(),
        })
        .strict(),
      outputSchema: PageMutationOutputSchema,
    },
    async (input) =>
      runTool(() =>
        savePageMutation(input, (file) => {
          const source = file.pages.find((page) => page.id === input.page_id);
          if (!source) throw new Error(`page_not_found: ${input.page_id}`);
          const title = input.title ?? `${source.title} copy`;
          const requested = input.new_page_id ?? pageSlug(title);
          let id = requested;
          let suffix = 2;
          while (file.pages.some((page) => page.id === id)) id = `${requested}-${suffix++}`;
          return {
            file: CanvasFileSchema.parse({
              ...file,
              pages: [
                ...file.pages,
                { ...structuredClone(source), id, title, order: file.pages.length },
              ],
            }),
            pageId: id,
          };
        }),
      ),
  );

  server.registerTool(
    "canvas_page_move",
    {
      title: "Move canvas Page",
      description: "Moves a Page to a zero-based position and rewrites contiguous ordering.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z
        .object({ ...pageWriteBase, page_id: z.string(), to_index: z.number().int().nonnegative() })
        .strict(),
      outputSchema: PageMutationOutputSchema,
    },
    async (input) =>
      runTool(() =>
        savePageMutation(input, (file) => {
          const ordered = [...file.pages].sort((a, b) => a.order - b.order);
          const from = ordered.findIndex((page) => page.id === input.page_id);
          if (from < 0) throw new Error(`page_not_found: ${input.page_id}`);
          const [moved] = ordered.splice(from, 1);
          if (!moved) throw new Error(`page_not_found: ${input.page_id}`);
          ordered.splice(Math.min(input.to_index, ordered.length), 0, moved);
          return {
            file: CanvasFileSchema.parse({
              ...file,
              pages: ordered.map((page, order) => ({ ...page, order })),
            }),
            pageId: input.page_id,
          };
        }),
      ),
  );

  server.registerTool(
    "canvas_page_delete",
    {
      title: "Delete canvas Page",
      description:
        "Deletes a Page, removes prototype references to it, and refuses to delete the final Page.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z.object({ ...pageWriteBase, page_id: z.string() }).strict(),
      outputSchema: PageMutationOutputSchema,
    },
    async (input) =>
      runTool(() =>
        savePageMutation(input, (file) => {
          if (file.pages.length === 1)
            throw new Error("page_invariant: cannot delete the final Page");
          if (!file.pages.some((page) => page.id === input.page_id))
            throw new Error(`page_not_found: ${input.page_id}`);
          const pages = file.pages
            .filter((page) => page.id !== input.page_id)
            .sort((a, b) => a.order - b.order)
            .map((page, order) => ({ ...page, order }));
          const fallbackPage = pages[0];
          if (!fallbackPage) throw new Error("page_invariant: cannot delete the final Page");
          const interactions = file.prototype.interactions.filter(
            (interaction) =>
              interaction.source.pageId !== input.page_id &&
              interaction.destination.pageId !== input.page_id,
          );
          return {
            file: CanvasFileSchema.parse({
              ...file,
              defaultPageId:
                file.defaultPageId === input.page_id ? fallbackPage.id : file.defaultPageId,
              pages,
              prototype: {
                start:
                  file.prototype.start?.pageId === input.page_id ? undefined : file.prototype.start,
                interactions,
              },
            }),
          };
        }),
      ),
  );

  server.registerTool(
    "canvas_prototype_get",
    {
      title: "Read canvas prototype",
      description: "Returns the versioned start frame and hotspot interactions for Present.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ ref: RefArg }).strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        version: z.number().int().nonnegative(),
        draft_revision: z.number().int().nonnegative(),
        prototype: z.unknown(),
        present_url: z.string(),
        public_present_url: z.string().nullable(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const loaded = await loadCanvasFileByRef(ctx, input.ref);
        return result({
          status: "ok" as const,
          ref: input.ref,
          version: loaded.detail.canvas.version ?? 0,
          draft_revision: loaded.detail.canvas.draft_revision,
          prototype: loaded.file.prototype,
          present_url: `${canvasUrl(loaded.detail.canvas.canvas_id)}/present`,
          public_present_url: loaded.detail.canvas.public_slug
            ? `${shareUrl(loaded.detail.canvas.public_slug)}/present`
            : null,
        });
      }),
  );

  server.registerTool(
    "canvas_prototype_set_start",
    {
      title: "Set prototype start frame",
      description: "Sets or clears the Page/node frame launched by Present.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z
        .object({
          ...pageWriteBase,
          start: z.object({ pageId: z.string(), nodeId: z.string() }).strict().nullable(),
        })
        .strict(),
      outputSchema: PageMutationOutputSchema,
    },
    async (input) =>
      runTool(() =>
        savePageMutation(input, (file) => ({
          file: CanvasFileSchema.parse({
            ...file,
            prototype: {
              ...file.prototype,
              start: input.start ?? undefined,
            },
          }),
        })),
      ),
  );

  server.registerTool(
    "canvas_prototype_patch",
    {
      title: "Patch prototype interactions",
      description: "Atomically upserts or removes accessible Present hotspots.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z
        .object({
          ...pageWriteBase,
          operations: z
            .array(
              z.discriminatedUnion("op", [
                z.object({ op: z.literal("upsert"), interaction: z.unknown() }).strict(),
                z.object({ op: z.literal("remove"), id: z.string() }).strict(),
              ]),
            )
            .min(1)
            .max(100),
        })
        .strict(),
      outputSchema: PageMutationOutputSchema,
    },
    async (input) =>
      runTool(() =>
        savePageMutation(input, (file) => {
          const interactions = [...file.prototype.interactions];
          for (const operation of input.operations) {
            if (operation.op === "remove") {
              const index = interactions.findIndex((item) => item.id === operation.id);
              if (index < 0) throw new Error(`prototype_interaction_not_found: ${operation.id}`);
              interactions.splice(index, 1);
            } else {
              const value = operation.interaction as Record<string, unknown>;
              const id = typeof value.id === "string" ? value.id : "";
              const index = interactions.findIndex((item) => item.id === id);
              if (index < 0) interactions.push(value as (typeof interactions)[number]);
              else interactions[index] = value as (typeof interactions)[number];
            }
          }
          return {
            file: CanvasFileSchema.parse({
              ...file,
              prototype: { ...file.prototype, interactions },
            }),
          };
        }),
      ),
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
      inputSchema: z
        .object({
          scope: assetScopeSchema,
          workspace: z.string().optional(),
          query: z.string().optional(),
          kind: assetKindSchema.optional(),
          limit: z.number().int().positive().max(100).optional(),
          cursor: z.string().optional(),
        })
        .strict(),
      outputSchema: z.object({
        assets: z.array(AssetRecordOutputSchema),
        count: z.number().int().nonnegative(),
        is_done: z.boolean(),
        next_cursor: z.string().nullable(),
      }),
    },
    async (input) =>
      runTool(async () => {
        if (input.scope === "workspace" && !input.workspace)
          throw new Error("workspace is required for workspace assets");
        const page = await ctx.runQuery(internal.assets.listInternal, {
          userId: principal.userId,
          scope: input.scope,
          workspaceSlug: input.workspace,
          query: input.query,
          kind: input.kind,
          paginationOpts: { numItems: input.limit ?? 50, cursor: input.cursor ?? null },
        });
        const assets = await Promise.all(
          page.page.map(async ({ preview_object_key, ...asset }) => ({
            ...asset,
            preview_url: await presignObject("delivery", preview_object_key, "GET", 900),
          })),
        );
        return result({
          assets,
          count: assets.length,
          is_done: page.isDone,
          next_cursor: page.isDone ? null : page.continueCursor,
        });
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
      inputSchema: z
        .object({
          asset_ref: z.string(),
          include_preview: z.boolean().optional(),
        })
        .strict(),
      outputSchema: z.object({
        asset_ref: z.string(),
        revision: z.number().int().positive(),
        mime_type: z.string(),
        size_bytes: z.number().int().nonnegative(),
        content_hash: z.string(),
        preview_url: z.string(),
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
    "asset_delete",
    {
      title: "Archive an Asset Library item",
      description:
        "Archives the asset addressed by asset_ref. It disappears from asset_list and cannot be " +
        "attached again, while immutable revisions and existing canvas bindings keep working. " +
        "This is reversible archival, never a hard purge of content-addressed bytes. Call " +
        "asset_restore with the returned asset_ref to make it available again.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({ asset_ref: z.string() }).strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        asset_ref: z.string(),
        operation: z.literal("archived"),
        reversible: z.boolean(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const archived = await ctx.runMutation(internal.assets.archiveByRef, {
          assetRef: input.asset_ref,
          userId: principal.userId,
        });
        return result({
          status: "ok" as const,
          asset_ref: archived.assetRef,
          operation: archived.mode,
          reversible: archived.reversible,
        });
      }),
  );

  server.registerTool(
    "asset_restore",
    {
      title: "Restore an archived Asset Library item",
      description:
        "Restores the asset addressed by asset_ref to its original personal or workspace " +
        "library. No bytes are uploaded and immutable revisions and existing canvas bindings " +
        "remain unchanged. Repeating the same restore is safe.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({ asset_ref: z.string() }).strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        asset_ref: z.string(),
        operation: z.literal("restored"),
      }),
    },
    async (input) =>
      runTool(async () => {
        const restored = await ctx.runMutation(internal.assets.restoreByRef, {
          assetRef: input.asset_ref,
          userId: principal.userId,
        });
        return result({
          status: "ok" as const,
          asset_ref: restored.assetRef,
          operation: restored.mode,
        });
      }),
  );

  server.registerTool(
    "asset_move",
    {
      title: "Move an Asset Library item",
      description:
        "Moves an asset between personal and workspace libraries without uploading bytes again. " +
        "For destination_scope=workspace, destination_workspace is required. The old asset_ref " +
        "stops resolving for new operations; existing canvas bindings remain pinned to their " +
        "immutable revisions. A destination slug collision is returned as an error and never overwrites.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          asset_ref: z.string(),
          destination_scope: assetScopeSchema,
          destination_workspace: z.string().optional(),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        previous_asset_ref: z.string(),
        asset_ref: z.string(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const moved = await ctx.runMutation(internal.assets.moveByRef, {
          assetRef: input.asset_ref,
          userId: principal.userId,
          destinationScope: input.destination_scope,
          destinationWorkspaceSlug: input.destination_workspace,
        });
        return result({
          status: "ok" as const,
          previous_asset_ref: moved.previousAssetRef,
          asset_ref: moved.assetRef,
        });
      }),
  );

  server.registerTool(
    "asset_upload_url",
    {
      title: "Upload media to the Asset Library",
      description:
        "Creates one-hour presigned PUT URLs for direct binary upload to the private source " +
        "bucket. Pass one file or a files batch (up to 50), PUT each upload, then call " +
        "asset_finalize once with the corresponding item or items manifest.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.union([
        z
          .object({
            scope: assetScopeSchema,
            workspace: z.string().optional(),
            filename: z.string(),
            content_type: z.string(),
            size_bytes: z.number().int().positive().max(ASSET_MAX_BYTES).optional(),
            sha256: z.string().optional(),
          })
          .strict(),
        z
          .object({
            scope: assetScopeSchema,
            workspace: z.string().optional(),
            files: z
              .array(
                z
                  .object({
                    filename: z.string(),
                    content_type: z.string(),
                    size_bytes: z.number().int().positive().max(ASSET_MAX_BYTES).optional(),
                    sha256: z.string().optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(50),
          })
          .strict(),
      ]),
      outputSchema: z.object({
        uploads: z.array(
          z.object({
            upload_id: z.string(),
            filename: z.string(),
            upload_url: z.string(),
            method: z.literal("PUT"),
            expires_at: z.number(),
          }),
        ),
        instructions: z.string(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const files = "files" in input ? input.files : [input];
        const normalized = files.map((file) => {
          const mime = file.content_type.split(";")[0]?.trim().toLowerCase() ?? "";
          if (!(mime in ASSET_MIME_TYPES)) throw new Error(`Unsupported asset MIME type: ${mime}`);
          return {
            ...file,
            mime,
            sourceObjectKey: `staging/${principal.userId}/${crypto.randomUUID()}`,
            expiresAt: Date.now() + 60 * 60 * 1000,
          };
        });
        const workspace =
          input.scope === "workspace"
            ? await ctx.runQuery(internal.assets.getWorkspaceBySlug, {
                slug: input.workspace ?? "",
              })
            : null;
        if (input.scope === "workspace" && !workspace) throw new Error("Workspace not found");
        const uploadIds = await ctx.runMutation(internal.assets.createUploads, {
          scope: input.scope,
          ownerUserId: principal.userId,
          workspaceId: workspace?.workspaceId,
          uploads: normalized.map((file) => ({
            sourceObjectKey: file.sourceObjectKey,
            filename: file.filename,
            declaredMimeType: file.mime,
            expectedSize: file.size_bytes,
            expectedHash: file.sha256,
            expiresAt: file.expiresAt,
          })),
        });
        return result({
          uploads: await Promise.all(
            normalized.map(async (file, index) => ({
              upload_id: uploadIds[index] as string,
              filename: file.filename,
              upload_url: await presignObject("source", file.sourceObjectKey, "PUT", 3600),
              method: "PUT" as const,
              expires_at: file.expiresAt,
            })),
          ),
          instructions:
            "PUT each file's raw bytes to its upload_url, then call asset_finalize with an items manifest. Failed items retain their upload_id and can be retried until expires_at.",
        });
      }),
  );

  server.registerTool(
    "asset_finalize",
    {
      title: "Finalize an uploaded asset",
      description:
        "Validates MIME/size/hash, stores immutable source and delivery objects, " +
        "and creates Asset Library revisions. Pass one item or up to 50 items; a batch returns " +
        "per-item results so only failed upload_ids need to be resumed.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.union([
        z
          .object({
            upload_id: z.string(),
            slug: z.string().optional(),
            name: z.string(),
            description: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .strict(),
        z
          .object({
            items: z
              .array(
                z
                  .object({
                    upload_id: z.string(),
                    slug: z.string().optional(),
                    name: z.string(),
                    description: z.string().optional(),
                    tags: z.array(z.string()).optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(50),
          })
          .strict(),
      ]),
      outputSchema: z.union([
        AssetSavedOutputSchema,
        z.object({
          status: z.enum(["ok", "partial"]),
          results: z.array(
            z.union([
              AssetSavedOutputSchema.extend({ upload_id: z.string() }),
              z.object({
                status: z.literal("error"),
                upload_id: z.string(),
                error: z.string(),
                retryable: z.boolean(),
              }),
            ]),
          ),
          succeeded: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
        }),
      ]),
    },
    async (input) =>
      runTool(async () => {
        if (!("items" in input)) return result(await finalizeUploadedAsset(ctx, principal, input));
        const results: Array<
          | (Awaited<ReturnType<typeof finalizeUploadedAsset>> & { upload_id: string })
          | { status: "error"; upload_id: string; error: string; retryable: boolean }
        > = [];
        for (let offset = 0; offset < input.items.length; offset += 8) {
          const chunk = input.items.slice(offset, offset + 8);
          results.push(
            ...(await Promise.all(
              chunk.map(async (item) => {
                try {
                  return {
                    ...(await finalizeUploadedAsset(ctx, principal, item)),
                    upload_id: item.upload_id,
                  };
                } catch (error) {
                  return {
                    status: "error" as const,
                    upload_id: item.upload_id,
                    error: describeError(error),
                    retryable: error instanceof AssetFinalizeFailure ? error.retryable : true,
                  };
                }
              }),
            )),
          );
        }
        const failed = results.filter((item) => item.status === "error").length;
        return result({
          status: failed > 0 ? ("partial" as const) : ("ok" as const),
          results,
          succeeded: results.length - failed,
          failed,
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
      inputSchema: z
        .object({
          scope: assetScopeSchema,
          workspace: z.string().optional(),
          url: z.string(),
          slug: z.string().optional(),
          name: z.string(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .strict(),
      outputSchema: AssetSavedOutputSchema,
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
        "Pins one immutable asset revision at an /assets path in the durable draft. " +
        "Iframe HTML uses the ordinary path; checkpoints keep their previous revision.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          asset_ref: z.string(),
          path: z.string(),
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative(),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        asset_ref: z.string(),
        path: z.string(),
        version: z.number().int().positive(),
        draft_revision: z.number().int().nonnegative(),
        dirty: z.boolean(),
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
          expectedDraftRevision: input.expected_draft_revision,
          createdBy: principal.userId,
        });
        return result({
          status: "ok",
          ref: input.ref,
          asset_ref: asset.assetRef,
          path: attached.path,
          version: attached.version,
          draft_revision: attached.draftRevision,
          dirty: attached.dirty,
        });
      }),
  );

  /* --- canvas_snapshot ------------------------------------------------ */
  server.registerTool(
    "canvas_snapshot",
    {
      title: "Snapshot canvas selection",
      description:
        "Returns a PNG image block for a native canvas, one node, or an exact world-coordinate " +
        "region. Pass a copied ref_id to see that node immediately. The capture is rendered from " +
        "the current durable draft revision, not from transient browser state. PNGs above 5 MB " +
        "are not inlined; use download_url or the suggested smaller regions/scale.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: SnapshotInputSchema,
      outputSchema: z.object({
        status: z.enum(["ok", "partial"]),
        ref: z.string(),
        ref_id: z.string().optional(),
        version: z.number(),
        draft_revision: z.number().int().nonnegative(),
        page_id: z.string(),
        target: SnapshotTargetSchema,
        mime_type: z.literal("image/png"),
        width: z.number(),
        height: z.number(),
        size_bytes: z.number(),
        inline: z.boolean(),
        download_url: z.string().optional(),
        cached: z.boolean(),
        warnings: z.array(z.string()),
        diagnostics: z.object({
          unresolved_refs: z.array(z.string()),
          unresolved_resources: z.array(
            z.object({
              ref: z.string(),
              resource_type: z.string(),
              reason: z.string(),
              error: z.string().optional(),
            }),
          ),
          readiness: z.object({
            status: z.enum(["ready", "partial"]),
            warnings: z.array(z.string()),
          }),
          attempts: z.number().int().positive(),
          suggested_regions: z.array(
            z.object({
              type: z.literal("region"),
              x: z.number(),
              y: z.number(),
              width: z.number().positive(),
              height: z.number().positive(),
            }),
          ),
          regions_truncated: z.boolean(),
        }),
      }),
    },
    async (input) =>
      runTool(async () => {
        const elementRef = input.ref_id ? parseElementRef(input.ref_id) : null;
        const ref = elementRef?.canvasRef ?? input.ref;
        if (!ref) throw new Error("Pass exactly one of ref or ref_id.");
        const target = elementRef
          ? ({ type: "node", node_id: elementRef.nodeId } as const)
          : (input.target ?? ({ type: "canvas" } as const));
        const context = await ctx.runQuery(internal.canvases.snapshotContextByRef, { ref });
        if (!context) throw new Error(`canvas_not_found: No canvas found for ref "${ref}".`);
        if (context.kind !== "canvas") {
          throw new Error("unsupported_canvas_kind: canvas_snapshot supports kind=canvas only.");
        }
        if (input.expected_version !== undefined && input.expected_version !== context.version) {
          throw new Error(
            `version_conflict: expected ${input.expected_version}, current ${context.version}`,
          );
        }
        if (
          input.expected_draft_revision !== undefined &&
          input.expected_draft_revision !== context.draftRevision
        ) {
          throw new Error(
            `draft_conflict: expected ${input.expected_draft_revision}, current ${context.draftRevision}`,
          );
        }

        if (!context.docStorageId) throw new Error("snapshot_failed: CanvasDoc is unavailable.");
        const docBlob = await ctx.storage.get(context.docStorageId);
        if (!docBlob) throw new Error("snapshot_failed: CanvasDoc storage object is unavailable.");
        const file = CanvasFileSchema.parse(JSON.parse(await docBlob.text()));
        const page = resolveCanvasPage(file, input.page_id);
        if (input.page_id && page.id !== input.page_id)
          throw new Error(`page_not_found: ${input.page_id}`);
        const doc = page.doc;
        if (target.type === "node") {
          if (!resolveElementSelection(doc, target.node_id)) {
            throw new Error(
              `node_not_found: node "${target.node_id}" does not exist at version ${context.version}.`,
            );
          }
        }

        const padding = input.padding ?? (target.type === "node" ? 24 : 0);
        const scale = input.scale ?? 1;
        const normalizedTarget =
          target.type === "node" ? { type: "node" as const, nodeId: target.node_id } : target;
        const cacheKey = await sha256Hex(
          JSON.stringify({
            renderer: 3,
            draftRevision: context.draftRevision,
            pageId: page.id,
            target: normalizedTarget,
            padding,
            scale,
          }),
        );

        let cached = true;
        type SnapshotRecord = {
          storageId: Id<"_storage">;
          mimeType: "image/png";
          size: number;
          width: number;
          height: number;
          status: "ok" | "partial";
          warnings: string[];
          diagnostics: {
            unresolvedRefs: string[];
            unresolvedDetails: Array<{
              ref: string;
              resourceType: string;
              reason: string;
              error?: string;
            }>;
            readinessStatus: "ready" | "partial";
            readinessWarnings: string[];
            attempts: number;
          };
        };
        let snapshot: SnapshotRecord | null = input.refresh
          ? null
          : await ctx.runQuery(internal.canvases.getSnapshotCache, {
              versionId: context.versionId,
              cacheKey,
              now: Date.now(),
            });
        let blob = snapshot ? await ctx.storage.get(snapshot.storageId) : null;

        if (!snapshot || !blob) {
          cached = false;
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
                getUrl: await presignObject("delivery", asset.objectKey, "GET", 3600),
              })),
            )),
          ];
          // Always stage a target-aware immutable export page. Reusing the
          // version's eager page would load every sibling iframe before the
          // worker knows which node/region was requested, contaminating a
          // targeted snapshot with unrelated readiness and asset failures.
          const cssBlob = context.cssStorageId ? await ctx.storage.get(context.cssStorageId) : null;
          const entryBytes = new TextEncoder().encode(
            canvasEntryHtml(doc, cssBlob ? await cssBlob.text() : "", normalizedTarget),
          );
          const temporaryEntryStorageId = await ctx.storage.store(
            new Blob([entryBytes], { type: "text/html" }),
          );
          const getUrl = await ctx.storage.getUrl(temporaryEntryStorageId);
          if (!getUrl) {
            await ctx.storage.delete(temporaryEntryStorageId);
            throw new Error("snapshot_failed: unable to stage immutable export page.");
          }
          const entryIndex = sources.findIndex((source) => source.relPath === "/src/__canvas.html");
          if (entryIndex >= 0) sources.splice(entryIndex, 1);
          sources.push({ relPath: "/src/__canvas.html", getUrl });

          const config = getWorkerConfig();
          let workerResult:
            | {
                size: number;
                width: number;
                height: number;
                mimeType: "image/png";
                uploadStatus: number;
                uploadBody: unknown;
                unresolvedRefs: string[];
                unresolvedDetails: Array<{
                  ref: string;
                  resourceType: string;
                  reason: string;
                  error?: string;
                }>;
                readiness: { status: "ready" | "partial"; warnings: string[] };
                downscaled: boolean;
                contentOverflow: boolean;
              }
            | undefined;
          let attempts = 0;
          let lastError: unknown;
          try {
            for (let attempt = 1; attempt <= 2; attempt += 1) {
              attempts = attempt;
              try {
                const putUrl = await ctx.storage.generateUploadUrl();
                const attemptResult = await callWorker<NonNullable<typeof workerResult>>(
                  config,
                  "/snapshot",
                  {
                    sources,
                    entrypoint: "/src/__canvas.html",
                    target: normalizedTarget,
                    padding,
                    scale,
                    readinessTimeoutMs: input.timeout_ms,
                    upload: { putUrl },
                  },
                );
                workerResult = attemptResult;
                if (attemptResult.readiness.status === "ready" || attempt === 2) break;
                const partialStorageId = extractStorageId(
                  attemptResult.uploadBody,
                ) as Id<"_storage">;
                await ctx.storage.delete(partialStorageId).catch(() => undefined);
              } catch (error) {
                lastError = error;
                if (attempt === 2) throw error;
              }
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          } finally {
            await ctx.storage.delete(temporaryEntryStorageId).catch(() => undefined);
          }
          if (!workerResult)
            throw lastError ?? new Error("snapshot_failed: worker returned nothing");
          const storageId = extractStorageId(workerResult.uploadBody) as Id<"_storage">;
          const warnings = [
            ...(workerResult.readiness.status === "partial" ? ["iframe_not_ready"] : []),
            ...(workerResult.unresolvedRefs.length > 0 ? ["unresolved_asset"] : []),
            ...(workerResult.downscaled ? ["output_downscaled"] : []),
            ...(workerResult.contentOverflow ? ["content_overflow"] : []),
          ];
          snapshot = {
            storageId,
            mimeType: "image/png" as const,
            size: workerResult.size,
            width: workerResult.width,
            height: workerResult.height,
            status: warnings.length > 0 ? ("partial" as const) : ("ok" as const),
            warnings,
            diagnostics: {
              unresolvedRefs: workerResult.unresolvedRefs,
              unresolvedDetails: workerResult.unresolvedDetails,
              readinessStatus: workerResult.readiness.status,
              readinessWarnings: workerResult.readiness.warnings,
              attempts,
            },
          };
          if (snapshot.status === "ok") {
            try {
              snapshot = await ctx.runMutation(internal.canvases.putSnapshotCache, {
                canvasId: context.canvasId,
                versionId: context.versionId,
                cacheKey,
                storageId,
                size: snapshot.size,
                width: snapshot.width,
                height: snapshot.height,
                status: snapshot.status,
                warnings,
                diagnostics: snapshot.diagnostics,
              });
            } catch (error) {
              await ctx.storage.delete(storageId).catch(() => undefined);
              throw error;
            }
          }
          blob = await ctx.storage.get(snapshot.storageId);
        }
        if (!snapshot || !blob) throw new Error("snapshot_failed: snapshot bytes are unavailable.");
        const MAX_INLINE_SNAPSHOT_BYTES = 5 * 1024 * 1024;
        const tooLargeToInline = snapshot.size > MAX_INLINE_SNAPSHOT_BYTES;
        const bytes = tooLargeToInline ? null : new Uint8Array(await blob.arrayBuffer());
        if (tooLargeToInline && snapshot.status === "partial") {
          // Partial captures are never returned by getSnapshotCache, but a
          // large response still needs a cleanup-owned row so its download
          // URL remains valid until the ordinary snapshot TTL sweep.
          await ctx.runMutation(internal.canvases.putSnapshotCache, {
            canvasId: context.canvasId,
            versionId: context.versionId,
            cacheKey: `${cacheKey}:download:${crypto.randomUUID()}`,
            storageId: snapshot.storageId,
            size: snapshot.size,
            width: snapshot.width,
            height: snapshot.height,
            status: snapshot.status,
            warnings: snapshot.warnings,
            diagnostics: snapshot.diagnostics,
          });
        }
        const downloadUrl = tooLargeToInline
          ? ((await ctx.storage.getUrl(snapshot.storageId)) ?? undefined)
          : undefined;
        if (!cached && snapshot.status === "partial" && !tooLargeToInline) {
          // Transient readiness failures must not become a 24-hour cache
          // artifact. The bytes have already been materialized for this
          // response, so the worker upload can be discarded immediately.
          await ctx.storage.delete(snapshot.storageId).catch(() => undefined);
        }
        const canonicalRefId =
          target.type === "node" ? formatElementRef(ref, target.node_id) : undefined;
        const suggestedRegions: Array<{
          type: "region";
          x: number;
          y: number;
          width: number;
          height: number;
        }> = [];
        let regionsTruncated = false;
        if (
          (snapshot.warnings.includes("output_downscaled") || tooLargeToInline) &&
          target.type !== "node"
        ) {
          const bounds =
            target.type === "region"
              ? target
              : { x: 0, y: 0, width: doc.world.width, height: doc.world.height };
          const tileSize = 2_048;
          outer: for (let y = bounds.y; y < bounds.y + bounds.height; y += tileSize) {
            for (let x = bounds.x; x < bounds.x + bounds.width; x += tileSize) {
              if (suggestedRegions.length >= 64) {
                regionsTruncated = true;
                break outer;
              }
              suggestedRegions.push({
                type: "region",
                x,
                y,
                width: Math.min(tileSize, bounds.x + bounds.width - x),
                height: Math.min(tileSize, bounds.y + bounds.height - y),
              });
            }
          }
        }
        const warnings = tooLargeToInline
          ? [...new Set([...snapshot.warnings, "snapshot_too_large"])]
          : snapshot.warnings;
        const metadata = {
          status: tooLargeToInline ? ("partial" as const) : snapshot.status,
          ref,
          ref_id: canonicalRefId,
          version: context.version,
          draft_revision: context.draftRevision,
          page_id: page.id,
          target,
          mime_type: snapshot.mimeType,
          width: snapshot.width,
          height: snapshot.height,
          size_bytes: snapshot.size,
          inline: !tooLargeToInline,
          download_url: downloadUrl,
          cached,
          warnings,
          diagnostics: {
            unresolved_refs: snapshot.diagnostics.unresolvedRefs,
            unresolved_resources: snapshot.diagnostics.unresolvedDetails.map((detail) => ({
              ref: detail.ref,
              resource_type: detail.resourceType,
              reason: detail.reason,
              error: detail.error,
            })),
            readiness: {
              status: snapshot.diagnostics.readinessStatus,
              warnings: snapshot.diagnostics.readinessWarnings,
            },
            attempts: snapshot.diagnostics.attempts,
            suggested_regions: suggestedRegions,
            regions_truncated: regionsTruncated,
          },
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
            ...(bytes
              ? [{ type: "image" as const, mimeType: "image/png", data: base64Bytes(bytes) }]
              : []),
          ],
          structuredContent: metadata,
        };
      }),
  );

  /* --- canvas_get ----------------------------------------------------- */
  server.registerTool(
    "canvas_get",
    {
      title: "Read canvas",
      description:
        "Reads one canvas by ref, or resolves a copied canvas:// element ref to the exact current " +
        "node and its lane, stage, and connected edges. Metadata and URLs are always returned; " +
        "include selects optional canvas facets. Artifact bytes are links, not inline content.",
      annotations: { readOnlyHint: true },
      inputSchema: z
        .object({
          ref: RefArg.optional(),
          ref_id: z
            .string()
            .optional()
            .describe("A copied canvas://workspace/canvas?node=<id> element ref."),
          page_id: z.string().optional().describe("Select a Page; defaults to defaultPageId."),
          include: z
            .array(z.enum(["doc", "files", "artifacts", "versions", "renders", "storage"]))
            .optional(),
          doc_projection: z
            .object({
              summary: z.boolean().optional(),
              node_ids: z.array(z.string()).max(100).optional(),
              collections: z
                .array(z.enum(["lanes", "stages", "labels", "nodes", "edges", "legend"]))
                .max(6)
                .optional(),
            })
            .strict()
            .optional()
            .describe(
              "Bound a CanvasDoc response to summary/counts, selected node IDs, or selected collections.",
            ),
          pagination: z
            .object({
              limit: z.number().int().positive().max(100).optional(),
              expected_version: z
                .number()
                .int()
                .nonnegative()
                .optional()
                .describe("Pin cursor continuation to canvas.version from the first page."),
              files_cursor: z.string().optional(),
              artifacts_cursor: z.string().optional(),
              versions_cursor: z.string().optional(),
              renders_cursor: z.string().optional(),
            })
            .strict()
            .optional()
            .describe("Facet cursors returned by a previous canvas_get; default limit is 50."),
        })
        .strict()
        .superRefine((input, check) => {
          if (Boolean(input.ref) === Boolean(input.ref_id)) {
            check.addIssue({
              code: "custom",
              message: "Pass exactly one of ref or ref_id.",
            });
          }
          if (input.doc_projection && !input.include?.includes("doc")) {
            check.addIssue({
              code: "custom",
              path: ["doc_projection"],
              message: 'doc_projection requires include:["doc"].',
            });
          }
          const hasCursor = Boolean(
            input.pagination?.files_cursor ||
              input.pagination?.artifacts_cursor ||
              input.pagination?.versions_cursor ||
              input.pagination?.renders_cursor,
          );
          if (hasCursor && input.pagination?.expected_version === undefined) {
            check.addIssue({
              code: "custom",
              path: ["pagination", "expected_version"],
              message: "expected_version is required when continuing any facet cursor.",
            });
          }
        }),
      outputSchema: z
        .object({
          canvas: z
            .object({
              ref: z.string(),
              canvas_id: z.string(),
              title: z.string(),
              description: z.string().optional(),
              kind: z.enum(["canvas", "html", "image", "pdf"]),
              visibility: z.enum(["private", "public"]),
              version: z.number().int().nonnegative(),
              draft_revision: z.number().int().nonnegative(),
              dirty: z.boolean(),
              draft_edit_count: z.number().int().nonnegative(),
              updated_at: z.number(),
              created_by_email: z.string().nullable(),
              canvas_url: z.string(),
              present_url: z.string().nullable(),
              share_url: z.string().nullable(),
              thumbnail_url: z.string().nullable(),
              embed: z
                .object({
                  image_url: z.string(),
                  target_url: z.string(),
                  github_markdown: z.string(),
                })
                .nullable(),
            })
            .strict(),
          selection: z.unknown().optional(),
          doc: z.unknown().optional(),
          files: z
            .array(
              z.object({
                path: z.string(),
                size_bytes: z.number().int().nonnegative(),
                content_hash: z.string(),
              }),
            )
            .optional(),
          artifacts: z
            .array(
              z.object({
                path: z.string(),
                type: z.enum(["pdf", "image", "svg", "source"]),
                role: z.enum(["primary", "supporting"]),
                size_bytes: z.number().int().nonnegative(),
                mime_type: z.string(),
                raw_url: z.string().nullable(),
                public_url: z.string().nullable(),
                embed_image_url: z.string().nullable(),
                github_markdown: z.string().nullable(),
              }),
            )
            .optional(),
          versions: z
            .array(
              z.object({
                version: z.number().int().positive(),
                note: z.string().optional(),
                created_at: z.number(),
                created_by_email: z.string().nullable(),
                is_current: z.boolean(),
              }),
            )
            .optional(),
          renders: z
            .array(
              z.object({
                entrypoint: z.string(),
                format: z.string(),
                status: z.string(),
                duration_ms: z.number(),
                error_text: z.string().optional(),
                created_at: z.number(),
              }),
            )
            .optional(),
          storage: z
            .object({
              used_bytes: z.number().int().nonnegative(),
              quota_bytes: z.number().int().positive(),
            })
            .optional(),
          pagination: z
            .record(
              z.string(),
              z.object({ is_done: z.boolean(), next_cursor: z.string().nullable() }),
            )
            .optional(),
        })
        .strict(),
    },
    async (input) =>
      runTool(async () => {
        const elementRef = input.ref_id ? parseElementRef(input.ref_id) : null;
        const ref = elementRef?.canvasRef ?? input.ref;
        if (!ref) throw new Error("Pass exactly one of ref or ref_id.");
        const include = new Set(input.include ?? []);
        const needsDoc =
          include.has("doc") || elementRef !== null || input.doc_projection !== undefined;
        const detail = await ctx.runQuery(internal.canvases.detailByRef, {
          ref,
          includeDoc: needsDoc,
        });
        if (!detail) {
          throw new Error(`canvas_not_found: No canvas found for ref "${ref}".`);
        }

        if (elementRef && detail.canvas.kind !== "canvas") {
          throw new Error("unsupported_element_type: element refs require a native canvas.");
        }
        if (elementRef) {
          const currentNode = await ctx.runQuery(internal.canvases.currentNodeByRef, {
            ref,
            nodeId: elementRef.nodeId,
            pageId: input.page_id,
          });
          if (!currentNode) {
            throw new Error(
              `element_not_found: Canvas "${ref}" exists at version ${detail.canvas.version ?? 0}, ` +
                `but node "${elementRef.nodeId}" does not. Read the current doc or search its nodes.`,
            );
          }
        }

        let canvasFile: CanvasFile | undefined;
        if (needsDoc && detail.canvas.doc_url) {
          const source = await ctx.runQuery(internal.canvases.currentDocStorageByRef, { ref });
          const blob = source ? await ctx.storage.get(source.storageId) : null;
          if (!blob) throw new Error("CanvasDoc storage object is unavailable.");
          canvasFile = CanvasFileSchema.parse(JSON.parse(await blob.text()));
        }
        const selectedPage = canvasFile ? resolveCanvasPage(canvasFile, input.page_id) : undefined;
        if (input.page_id && selectedPage?.id !== input.page_id) {
          throw new Error(`page_not_found: ${input.page_id}`);
        }

        let selection: Record<string, unknown> | undefined;
        if (elementRef) {
          if (!selectedPage) throw new Error("CanvasFile storage object is unavailable.");
          const resolved = resolveElementSelection(selectedPage.doc, elementRef.nodeId);
          if (!resolved) {
            throw new Error(
              `element_not_found: Canvas "${ref}" exists at version ${detail.canvas.version ?? 0}, ` +
                `but node "${elementRef.nodeId}" does not. Read the current doc or search its nodes.`,
            );
          }
          selection = {
            ref_id: formatElementRef(ref, resolved.node.id),
            type: "node",
            node_id: resolved.node.id,
            page_id: selectedPage.id,
            node: resolved.node,
            context: resolved.context,
          };
        }

        const focusedCanvasUrl = new URL(canvasUrl(detail.canvas.canvas_id));
        if (selectedPage && selectedPage.id !== canvasFile?.defaultPageId)
          focusedCanvasUrl.searchParams.set("page", selectedPage.id);
        if (elementRef) focusedCanvasUrl.searchParams.set("node", elementRef.nodeId);

        const projectedDoc = (() => {
          if (!include.has("doc") || !canvasFile || !selectedPage) return undefined;
          const projection = input.doc_projection;
          if (!projection) return canvasFile;
          const canvasDoc = selectedPage.doc;
          const collections = new Set(projection.collections ?? []);
          const nodeIds = new Set(projection.node_ids ?? []);
          const nodes = canvasDoc.nodes.filter((node) => nodeIds.has(node.id));
          const selectedNodeIds = new Set(nodes.map((node) => node.id));
          return {
            version: canvasFile.version,
            defaultPageId: canvasFile.defaultPageId,
            pages: pageSummaries(canvasFile),
            activePage: {
              id: selectedPage.id,
              title: selectedPage.title,
              order: selectedPage.order,
              doc: {
                version: canvasDoc.version,
                title: canvasDoc.title,
                subtitle: canvasDoc.subtitle,
                theme: canvasDoc.theme,
                world: canvasDoc.world,
                counts: {
                  lanes: canvasDoc.lanes.length,
                  stages: canvasDoc.stages.length,
                  labels: canvasDoc.labels.length,
                  nodes: canvasDoc.nodes.length,
                  edges: canvasDoc.edges.length,
                },
                lanes: collections.has("lanes") ? canvasDoc.lanes : undefined,
                stages: collections.has("stages") ? canvasDoc.stages : undefined,
                labels: collections.has("labels") ? canvasDoc.labels : undefined,
                nodes:
                  collections.has("nodes") && nodeIds.size === 0
                    ? canvasDoc.nodes
                    : nodes.length > 0
                      ? nodes
                      : undefined,
                edges: collections.has("edges")
                  ? canvasDoc.edges
                  : selectedNodeIds.size > 0
                    ? canvasDoc.edges.filter(
                        (edge) =>
                          selectedNodeIds.has(edge.source.nodeId) ||
                          selectedNodeIds.has(edge.target.nodeId),
                      )
                    : undefined,
                legend: collections.has("legend") ? canvasDoc.legend : undefined,
              },
            },
            prototype: canvasFile.prototype,
          };
        })();

        const allPagedFacets = ["files", "artifacts", "versions", "renders"] as const;
        const pagedFacets = allPagedFacets.filter((facet) => include.has(facet));
        const facetPages = Object.fromEntries(
          await Promise.all(
            pagedFacets.map(async (facet) => {
              const page = await ctx.runQuery(internal.canvases.detailFacetPageByRef, {
                ref,
                facet,
                expectedVersion: input.pagination?.expected_version,
                paginationOpts: {
                  numItems: input.pagination?.limit ?? 50,
                  cursor: input.pagination?.[`${facet}_cursor`] ?? null,
                  maximumRowsRead: 200,
                },
              });
              if (!page) throw new Error(`canvas_not_found: No canvas found for ref "${ref}".`);
              return [facet, page] as const;
            }),
          ),
        ) as Record<
          "files" | "artifacts" | "versions" | "renders",
          { page: unknown[]; isDone: boolean; continueCursor: string }
        >;

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
            draft_revision: detail.canvas.draft_revision,
            dirty: detail.canvas.dirty,
            draft_edit_count: detail.canvas.draft_edit_count,
            updated_at: detail.canvas.updated_at,
            created_by_email: detail.created_by_email,
            canvas_url: focusedCanvasUrl.toString(),
            present_url:
              detail.canvas.kind === "canvas"
                ? `${canvasUrl(detail.canvas.canvas_id)}/present`
                : null,
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
          selection,
          doc: projectedDoc,
          files: facetPages.files?.page,
          artifacts: facetPages.artifacts?.page.map((rawArtifact) => {
            const artifact = rawArtifact as {
              path: string;
              type: string;
              role: string;
              size_bytes: number;
              mime_type: string;
              raw_url: string | null;
            };
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
          versions: facetPages.versions?.page,
          renders: facetPages.renders?.page,
          storage: include.has("storage") ? detail.storage : undefined,
          pagination:
            pagedFacets.length > 0
              ? Object.fromEntries(
                  pagedFacets.map((facet) => [
                    facet,
                    {
                      is_done: facetPages[facet].isDone,
                      next_cursor: facetPages[facet].isDone
                        ? null
                        : facetPages[facet].continueCursor,
                    },
                  ]),
                )
              : undefined,
        });
      }),
  );

  const FileGetOutputSchema = z.object({
    status: z.literal("ok"),
    ref: z.string(),
    path: z.string(),
    version: z.number(),
    size_bytes: z.number(),
    content_hash: z.string(),
    encoding: z.enum(["utf-8", "base64"]),
    content: z.string(),
    range: z.object({
      kind: z.enum(["full", "lines", "bytes"]),
      start: z.number(),
      end: z.number(),
      total: z.number(),
    }),
    truncated: z.boolean(),
  });

  server.registerTool(
    "canvas_file_get",
    {
      title: "Read one canvas file",
      description:
        "Reads one UTF-8 canvas source file with its current version and content hash. Use line " +
        "or byte ranges for large files instead of canvas_run or a full canvas_get. Ranges are " +
        "zero-copy response projections: line numbers are 1-based and inclusive; byte offsets " +
        "are 0-based with an exclusive end. Full/line content is UTF-8; exact byte ranges are " +
        "base64 so offsets may safely split a multibyte character. Check the encoding field.",
      annotations: { readOnlyHint: true },
      inputSchema: z
        .object({
          ref: RefArg,
          path: z.string(),
          start_line: z.number().int().positive().optional(),
          end_line: z.number().int().positive().optional(),
          start_byte: z.number().int().nonnegative().optional(),
          end_byte: z.number().int().positive().optional(),
        })
        .strict()
        .superRefine((input, check) => {
          const hasLines = input.start_line !== undefined || input.end_line !== undefined;
          const hasBytes = input.start_byte !== undefined || input.end_byte !== undefined;
          if (hasLines && hasBytes) {
            check.addIssue({
              code: "custom",
              message: "Choose either a line range or a byte range, not both.",
            });
          }
          if (input.end_line !== undefined && input.start_line === undefined) {
            check.addIssue({
              code: "custom",
              path: ["start_line"],
              message: "start_line is required when end_line is set.",
            });
          }
          if (input.end_byte !== undefined && input.start_byte === undefined) {
            check.addIssue({
              code: "custom",
              path: ["start_byte"],
              message: "start_byte is required when end_byte is set.",
            });
          }
          if (
            input.start_line !== undefined &&
            input.end_line !== undefined &&
            input.end_line < input.start_line
          ) {
            check.addIssue({
              code: "custom",
              path: ["end_line"],
              message: "end_line must be greater than or equal to start_line.",
            });
          }
          if (
            input.start_byte !== undefined &&
            input.end_byte !== undefined &&
            input.end_byte <= input.start_byte
          ) {
            check.addIssue({
              code: "custom",
              path: ["end_byte"],
              message: "end_byte must be greater than start_byte.",
            });
          }
        }),
      outputSchema: FileGetOutputSchema,
    },
    async (input) =>
      runTool(async () => {
        const source = await loadEditableFile(ctx, input.ref, input.path);
        const bytes = new TextEncoder().encode(source.content);
        const MAX_RESPONSE_BYTES = 128 * 1024;
        let content = source.content;
        let kind: "full" | "lines" | "bytes" = "full";
        let start = 0;
        let end = bytes.byteLength;
        let total = bytes.byteLength;
        let truncated = false;
        let encoding: "utf-8" | "base64" = "utf-8";

        if (input.start_line !== undefined) {
          kind = "lines";
          const lines = source.content.split("\n");
          start = input.start_line;
          end = Math.min(input.end_line ?? input.start_line + 199, lines.length);
          total = lines.length;
          content = lines.slice(start - 1, end).join("\n");
          truncated = end < lines.length;
        } else if (input.start_byte !== undefined) {
          kind = "bytes";
          start = Math.min(input.start_byte, bytes.byteLength);
          const maxRawBytes = Math.floor(MAX_RESPONSE_BYTES / 4) * 3;
          end = Math.min(input.end_byte ?? start + maxRawBytes, bytes.byteLength);
          total = bytes.byteLength;
          if (end - start > maxRawBytes) {
            throw new Error(
              `range_too_large: base64 byte ranges are capped at ${maxRawBytes} raw bytes; request a smaller range.`,
            );
          }
          encoding = "base64";
          content = base64Bytes(bytes.slice(start, end));
          truncated = end < bytes.byteLength;
        } else if (bytes.byteLength > MAX_RESPONSE_BYTES) {
          throw new Error(
            `file_too_large: ${source.path} is ${bytes.byteLength} bytes. Request start_line/end_line or start_byte/end_byte; one response is capped at ${MAX_RESPONSE_BYTES} bytes.`,
          );
        }

        if (new TextEncoder().encode(content).byteLength > MAX_RESPONSE_BYTES) {
          throw new Error(
            `range_too_large: requested content exceeds ${MAX_RESPONSE_BYTES} bytes; request a smaller range.`,
          );
        }

        return result({
          status: "ok",
          ref: input.ref,
          path: source.path,
          version: source.version,
          size_bytes: bytes.byteLength,
          content_hash: source.contentHash,
          encoding,
          content,
          range: { kind, start, end, total },
          truncated,
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
      inputSchema: z
        .object({
          query: z.string().optional(),
          workspace: z.string().optional().describe("Restrict to one workspace slug."),
          kind: z.enum(["canvas", "html", "image", "pdf"]).optional(),
          visibility: z.enum(["private", "public"]).optional(),
          limit: z.number().int().positive().max(100).optional(),
          cursor: z.string().optional().describe("Opaque next_cursor from the previous page."),
          node_cursor: z.string().optional().describe("Opaque next_node_cursor for node matches."),
          workspace_cursor: z
            .string()
            .optional()
            .describe("Opaque next_workspace_cursor for browse results."),
        })
        .strict(),
      outputSchema: z.object({
        workspaces: z
          .array(
            z.object({
              slug: z.string(),
              name: z.string(),
              description: z.string().optional(),
              canvas_count: z.number().int().nonnegative(),
              canvas_count_has_more: z.boolean(),
            }),
          )
          .optional(),
        canvases: z.array(
          z.object({
            ref: z.string(),
            canvas_id: z.string(),
            title: z.string(),
            kind: z.enum(["canvas", "html", "image", "pdf"]),
            visibility: z.enum(["private", "public"]),
            public_slug: z.string().optional(),
            updated_at: z.number(),
            thumbnail_url: z.string().nullable(),
            canvas_url: z.string(),
            share_url: z.string().nullable(),
          }),
        ),
        nodes: z.array(
          z.object({
            ref: z.string(),
            canvas_id: z.string(),
            node_id: z.string(),
            node_title: z.string(),
            eyebrow: z.string().optional(),
          }),
        ),
        has_more: z.boolean(),
        next_cursor: z.string().nullable(),
        nodes_done: z.boolean(),
        next_node_cursor: z.string().nullable(),
        workspaces_done: z.boolean(),
        next_workspace_cursor: z.string().nullable(),
        warnings: z.array(WarningSchema),
      }),
    },
    async (input) =>
      runTool(async () => {
        const found = await ctx.runQuery(internal.canvases.findCanvases, {
          query: input.query,
          workspaceSlug: input.workspace,
          kind: input.kind,
          visibility: input.visibility,
          paginationOpts: {
            numItems: input.limit ?? 25,
            cursor: input.cursor ?? null,
            maximumRowsRead: 500,
          },
        });
        const nodePage = input.query
          ? await ctx.runQuery(internal.canvases.findCanvasNodes, {
              query: input.query,
              workspaceSlug: input.workspace,
              kind: input.kind,
              visibility: input.visibility,
              paginationOpts: {
                numItems: input.limit ?? 25,
                cursor: input.node_cursor ?? null,
                maximumRowsRead: 500,
              },
            })
          : { nodes: [], is_done: true, next_cursor: null };
        // Workspaces are only interesting when browsing, not when searching.
        const workspacePage = input.query
          ? { workspaces: undefined, is_done: true, next_cursor: null }
          : await ctx.runQuery(internal.canvases.findWorkspaces, {
              paginationOpts: {
                numItems: input.limit ?? 25,
                cursor: input.workspace_cursor ?? null,
                maximumRowsRead: 200,
              },
            });

        const warnings: Warning[] = [];
        if (!found.is_done) {
          warnings.push({
            code: "truncated",
            message:
              "More canvases match than were returned. Narrow with workspace/kind or raise limit.",
          });
        }
        if (!nodePage.is_done) {
          warnings.push({
            code: "truncated",
            message: "More CanvasDoc nodes match; continue with next_node_cursor.",
          });
        }
        if (!workspacePage.is_done) {
          warnings.push({
            code: "truncated",
            message: "More workspaces exist; continue with next_workspace_cursor.",
          });
        }

        return result({
          workspaces: workspacePage.workspaces,
          canvases: found.canvases.map((c) => ({
            ...c,
            canvas_url: canvasUrl(c.canvas_id),
            share_url: shareUrl(c.public_slug),
          })),
          nodes: nodePage.nodes,
          has_more: !found.is_done,
          next_cursor: found.next_cursor,
          nodes_done: nodePage.is_done,
          next_node_cursor: nodePage.next_cursor,
          workspaces_done: workspacePage.is_done,
          next_workspace_cursor: workspacePage.next_cursor,
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
        "Archives a workspace/canvas by default; pass purge:true to permanently delete it. " +
        "Individual files and artifacts have no archive state, so those targets require both path " +
        "and purge:true. Purging a workspace also purges every canvas inside it.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          target: z.enum(["workspace", "canvas", "file", "artifact"]),
          path: z.string().optional(),
          purge: z.boolean().optional(),
        })
        .strict()
        .superRefine((input, check) => {
          if (input.target === "file" || input.target === "artifact") {
            if (!input.path) {
              check.addIssue({
                code: "custom",
                path: ["path"],
                message: `path is required for target ${input.target}.`,
              });
            }
            if (input.purge !== true) {
              check.addIssue({
                code: "custom",
                path: ["purge"],
                message: `purge:true is required for target ${input.target}; individual paths cannot be archived.`,
              });
            }
          }
        }),
      outputSchema: z.object({
        deleted: z.array(
          z.object({
            kind: z.enum(["workspace", "canvas", "file", "artifact"]),
            ref: z.string(),
            path: z.string().optional(),
          }),
        ),
        archived: z.boolean(),
        bytes_reclaimed: z.number().int().nonnegative(),
        canvases_deleted: z.number().int().nonnegative().optional(),
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
        "Executes a synchronous JS/TS script in a sandboxed worker against this canvas's files. " +
        "Injected globals include fs (readFileSync/writeFileSync/mkdirSync/readdirSync/existsSync), " +
        "console, fetch, WebSocket, Buffer, URL, timers, and require for path/buffer/util/assert, " +
        "network modules, ApexCharts, D2, and Tailwind. Do not use top-level await; wrap async work " +
        "as `(async () => { ... })().catch(console.error)`. Anything written to /output is collected " +
        "as an artifact. There is no shell and filesystem access is confined to the canvas workspace.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
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
        })
        .strict(),
      outputSchema: z.object({
        status: z.enum(["ok", "failed"]),
        stdout: z.string(),
        stderr: z.string(),
        error: z.string().optional(),
        duration_ms: z.number().optional(),
        artifacts: z.array(
          z.object({
            path: z.string(),
            size_bytes: z.number().int().nonnegative(),
            uploaded: z.boolean(),
          }),
        ),
        warnings: z.array(WarningSchema),
      }),
    },
    async (input) =>
      runTool(async () => {
        const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: input.ref });
        if (!detail) throw new Error(`No canvas found for ref "${input.ref}".`);
        const canvasId = detail.canvas.canvas_id;
        const currentVersion = await ctx.runQuery(internal.canvases.currentVersion, { canvasId });
        if (!currentVersion) throw new Error("Canvas has no current version.");

        const config = getWorkerConfig();
        const sources = await resolveCanvasSources(ctx, canvasId, currentVersion.versionId);

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
        "Returns short-lived URLs for uploading one or up to 50 canvas files out of band. POST " +
        "each file's raw bytes, read storageId from each JSON response, then pass those values as " +
        "files[].upload_id in one canvas_save. This keeps bytes out of the conversation.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.union([
        z
          .object({
            ref: RefArg,
            path: z.string().describe('Where the file will live, e.g. "/assets/logo.png".'),
            content_type: z.string().optional(),
          })
          .strict(),
        z
          .object({
            ref: RefArg,
            files: z
              .array(z.object({ path: z.string(), content_type: z.string().optional() }).strict())
              .min(1)
              .max(50),
          })
          .strict(),
      ]),
      outputSchema: z.object({
        uploads: z.array(
          z.object({
            upload_url: z.string(),
            method: z.literal("POST"),
            upload_id_field: z.literal("storageId"),
            path: z.string(),
            content_type: z.string().optional(),
          }),
        ),
        instructions: z.string(),
      }),
    },
    async (input) =>
      runTool(async () => {
        // Validate the destination now, so a caller can't burn an upload
        // discovering that /cache isn't writable.
        const files = "files" in input ? input.files : [input];
        const normalized = files.map((file) => ({
          ...file,
          path: normalizeCanvasPath(file.path, "write", "path").displayPath,
        }));
        return result({
          uploads: await Promise.all(
            normalized.map(async (file) => ({
              upload_url: await ctx.storage.generateUploadUrl(),
              method: "POST" as const,
              upload_id_field: "storageId" as const,
              path: file.path,
              content_type: file.content_type,
            })),
          ),
          instructions:
            'POST each file to upload_url with its Content-Type. Each response is {"storageId":"..."}; pass each value as upload_id at the matching path in one canvas_save.',
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
