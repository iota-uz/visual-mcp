/**
 * The MCP surface covers canvas lifecycle, incremental editing, and reusable
 * media. Supported media written under /assets is promoted to the workspace
 * library automatically; explicit asset tools cover library-only work.
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
 * Two zod majors are in play here on purpose (see ./index.ts's header
 * comment): tool schemas use zod v4 (this file's `z` import, which resolves
 * to root's zod@4 — what `@modelcontextprotocol/server` itself requires),
 * while `CanvasDocSchema` comes from `@visual-canvas/canvas` and validates
 * with its own bundled zod v3. Never mix the two schema objects.
 */

import {
  type CallToolResult,
  type McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { frameGuide } from "@visual-canvas/canvas/device-frame.js";
import {
  formatElementRef,
  parseElementRef,
  resolveElementSelection,
} from "@visual-canvas/canvas/element-ref.js";
import { describeIssues } from "@visual-canvas/canvas/issues.js";
import { deleteNodesFromFile, moveNodes } from "@visual-canvas/canvas/layout.js";
import { findNodeOverlaps } from "@visual-canvas/canvas/overlap.js";
import { applyCanvasDocPatch, type CanvasDocPatchOperation } from "@visual-canvas/canvas/patch.js";
import { canvasSnapshotEntryHtml } from "@visual-canvas/canvas/snapshot-entry.js";
import { THEME_CSS } from "@visual-canvas/canvas/theme-css.js";
import type { Theme, ThemeOverride } from "@visual-canvas/canvas/themes.js";
import { THEME_IDS } from "@visual-canvas/canvas/themes.js";
import type { CanvasDoc, CanvasFile } from "@visual-canvas/canvas/types.js";
import {
  CanvasDocSchema,
  CanvasFileSchema,
  resolveCanvasPage,
} from "@visual-canvas/canvas/types.js";
import { normalizeCanvasPath } from "@visual-canvas/runtime/paths/index.js";
import { inferArtifactInfo } from "@visual-canvas/runtime/render/artifact-info.js";
import {
  compileThemeToCssVariables,
  compileThemeToTailwindV4,
  listThemes,
  resolveTheme,
} from "@visual-canvas/runtime/render/themes/index.js";
import {
  getTemplate,
  listTemplates as templateRegistryList,
} from "@visual-canvas/runtime/templates/index.js";
import { z } from "zod";
import type { Id } from "../../../convex/_generated/dataModel.js";
import {
  discardPreparedAssetObject,
  fetchAssetImport,
  type PreparedAssetObject,
  persistAsset,
  prepareAssetObject,
} from "./assets.js";
import { applyExactFileEdits, type PreparedPatchChange, prepareApplyPatch } from "./editEngine.js";
import { projectTextFile, searchText } from "./fileTools.js";
import type { AgentContext } from "./gateway.js";
import { MCP_GUIDES } from "./guides.js";
import { ASSET_MAX_BYTES, ASSET_MIME_TYPES } from "./lib/assetSecurity.js";
import { sha256Hex, sha256HexBytes } from "./lib/hash.js";
import { deleteObject, getObject, presignObject } from "./lib/objectStore.js";
import { slugify } from "./lib/slug.js";
import {
  canvasUrl,
  embedCardUrl,
  embedPngUrl,
  embedTargetUrl,
  githubEmbedMarkdown,
  pngEmbedTargetUrl,
  shareUrl,
} from "./lib/urls.js";
import { callWorker, extractStorageId, getWorkerConfig } from "./lib/worker.js";
import { internal } from "./refs.js";

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
  | "upload_pool_exhausted"
  | "unpublished_changes";

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

type RecommendationCode =
  | "inspect_unresolved_reference"
  | "inspect_node_overlap"
  | "inspect_out_of_bounds_node"
  | "replace_hardcoded_visual_tokens"
  | "add_image_alt_text"
  | "remove_duplicate_device_chrome"
  | "remove_internal_marker"
  | "label_empty_interactive_control"
  | "reduce_custom_color_count"
  | "reduce_custom_radius_count"
  | "reduce_custom_shadow_count"
  | "inspect_changed_canvas";

interface Recommendation {
  code: RecommendationCode;
  message: string;
  location?: { path?: string; page_id?: string; node_id?: string; selector?: string };
  suggested_tool?: { name: string; arguments: Record<string, unknown> };
}

const RecommendationSchema = z.object({
  code: z.enum([
    "inspect_unresolved_reference",
    "inspect_node_overlap",
    "inspect_out_of_bounds_node",
    "replace_hardcoded_visual_tokens",
    "add_image_alt_text",
    "remove_duplicate_device_chrome",
    "remove_internal_marker",
    "label_empty_interactive_control",
    "reduce_custom_color_count",
    "reduce_custom_radius_count",
    "reduce_custom_shadow_count",
    "inspect_changed_canvas",
  ]),
  message: z.string(),
  location: z
    .object({
      path: z.string().optional(),
      page_id: z.string().optional(),
      node_id: z.string().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  suggested_tool: z
    .object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) })
    .optional(),
});

const RECOMMENDATION_LIMIT = 30;

function boundedRecommendations(items: Recommendation[]): Recommendation[] {
  const seen = new Set<string>();
  const perCode = new Map<Recommendation["code"], number>();
  const deduped = items.filter((item) => {
    const key = `${item.code}:${JSON.stringify(item.location ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const capped = deduped.filter((item) => {
    if (item.code === "inspect_changed_canvas") return true;
    const count = (perCode.get(item.code) ?? 0) + 1;
    perCode.set(item.code, count);
    return count <= 5;
  });
  return capped
    .sort((a, b) =>
      a.code === "inspect_changed_canvas"
        ? -1
        : b.code === "inspect_changed_canvas"
          ? 1
          : `${a.code}:${JSON.stringify(a.location)}`.localeCompare(
              `${b.code}:${JSON.stringify(b.location)}`,
            ),
    )
    .slice(0, RECOMMENDATION_LIMIT);
}

function warningRecommendations(warnings: Warning[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  for (const warning of warnings) {
    if (warning.code === "unresolved_asset") {
      recommendations.push({
        code: "inspect_unresolved_reference" as const,
        message: warning.message,
        location: { path: warning.path },
      });
    }
    if (warning.code === "node_overlap") {
      recommendations.push({
        code: "inspect_node_overlap" as const,
        message: warning.message,
        location: {
          page_id: warning.data?.page_id,
          node_id: warning.data?.node_ids?.[0],
        },
      });
    }
  }
  return recommendations;
}

function scanProductionQuality(
  writtenText: Array<{ path: string; text: string }>,
  file?: CanvasFile,
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  for (const source of writtenText) {
    if (!/\.html?$/i.test(source.path)) continue;
    const html = source.text;
    for (const match of html.matchAll(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi)) {
      recommendations.push({
        code: "add_image_alt_text",
        message: 'Image elements need meaningful alt text (or alt="" when decorative).',
        location: { path: source.path, selector: match[0].slice(0, 120) },
      });
    }
    for (const match of html.matchAll(/<(button|a)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const body = (match[2] ?? "").replace(/<[^>]*>/g, "").trim();
      if (!body && !/\baria-label\s*=|\btitle\s*=/i.test(match[0])) {
        recommendations.push({
          code: "label_empty_interactive_control",
          message: "Interactive controls need visible text or an accessible label.",
          location: { path: source.path, selector: match[0].slice(0, 120) },
        });
      }
    }
    if (/\b(?:data-debug|data-internal|__meta|internal-only)\b/i.test(html)) {
      recommendations.push({
        code: "remove_internal_marker",
        message: "Remove internal/debug markers from production-facing output.",
        location: { path: source.path },
      });
    }
    const colors = new Set(html.match(/#[\da-f]{3,8}\b|\brgba?\([^)]*\)/gi) ?? []);
    if (colors.size > 8)
      recommendations.push({
        code: "reduce_custom_color_count",
        message: `${colors.size} custom colors were found; prefer resolved semantic theme tokens.`,
        location: { path: source.path },
      });
    if (
      colors.size > 0 &&
      !/var\(--color-|(?:bg|text|border)-(?:background|foreground|muted|primary|secondary|border)\b/.test(
        html,
      )
    ) {
      recommendations.push({
        code: "replace_hardcoded_visual_tokens",
        message: "Use semantic theme colors so workspace and canvas branding is preserved.",
        location: { path: source.path },
      });
    }
    const radii = new Set(html.match(/border-radius\s*:[^;}]+/gi) ?? []);
    if (radii.size > 4)
      recommendations.push({
        code: "reduce_custom_radius_count",
        message: `${radii.size} custom radii were found; use the theme radius scale.`,
        location: { path: source.path },
      });
    const shadows = new Set(html.match(/box-shadow\s*:[^;}]+/gi) ?? []);
    if (shadows.size > 4)
      recommendations.push({
        code: "reduce_custom_shadow_count",
        message: `${shadows.size} custom shadows were found; use the theme shadow scale.`,
        location: { path: source.path },
      });
  }
  for (const page of file?.pages ?? []) {
    for (const node of page.doc.nodes) {
      if (
        node.rect.x < 0 ||
        node.rect.y < 0 ||
        node.rect.x + node.rect.w > page.doc.world.width ||
        node.rect.y + node.rect.h > page.doc.world.height
      ) {
        recommendations.push({
          code: "inspect_out_of_bounds_node",
          message: `Node "${node.id}" extends beyond the ${page.doc.world.width}×${page.doc.world.height} world.`,
          location: { page_id: page.id, node_id: node.id },
        });
      }
      if (
        node.kind === "iframe" &&
        node.frame.kind !== "none" &&
        writtenText.some(
          (source) =>
            source.path === node.source.entrypoint &&
            /(?:phone|device|browser)-(?:frame|chrome)|iphone\b/i.test(source.text),
        )
      ) {
        recommendations.push({
          code: "remove_duplicate_device_chrome",
          message:
            "The CanvasDoc device shell and iframe content both appear to draw device chrome.",
          location: { path: node.source.entrypoint, page_id: page.id, node_id: node.id },
        });
      }
    }
  }
  return recommendations;
}

function snapshotRecommendation(args: {
  ref: string;
  version: number;
  draftRevision: number;
  pageId?: string;
  nodeId?: string;
}): Recommendation {
  return {
    code: "inspect_changed_canvas",
    message: args.nodeId
      ? `Inspect changed node "${args.nodeId}" before handoff.`
      : "Inspect the smallest changed canvas target before handoff.",
    location: { page_id: args.pageId, node_id: args.nodeId },
    suggested_tool: {
      name: "canvas_snapshot",
      arguments: {
        ref: args.ref,
        ...(args.pageId ? { page_id: args.pageId } : {}),
        target: args.nodeId ? { type: "node", node_id: args.nodeId } : { type: "canvas" },
        expected_version: args.version,
        expected_draft_revision: args.draftRevision,
      },
    },
  };
}

async function changedFileSnapshotRecommendations(
  ctx: AgentContext,
  args: {
    ref: string;
    version: number;
    draftRevision: number;
    paths: string[];
  },
): Promise<Recommendation[]> {
  const context = await ctx.runQuery(internal.canvases.snapshotContextByRef, { ref: args.ref });
  if (context?.kind !== "canvas" || !context.docStorageId) {
    return [snapshotRecommendation(args)];
  }
  const blob = await ctx.storage.get(context.docStorageId);
  if (!blob) return [snapshotRecommendation(args)];
  const file = CanvasFileSchema.parse(JSON.parse(await blob.text()));
  const changedPaths = new Set(
    args.paths.map((path) => normalizeCanvasPath(path, "read").displayPath),
  );
  const matches = file.pages.flatMap((page) =>
    page.doc.nodes
      .filter(
        (node) =>
          node.kind === "iframe" &&
          changedPaths.has(normalizeCanvasPath(node.source.entrypoint, "read").displayPath),
      )
      .map((node) => ({ pageId: page.id, nodeId: node.id })),
  );
  const unique = matches.filter(
    (match, index) =>
      matches.findIndex(
        (candidate) => candidate.pageId === match.pageId && candidate.nodeId === match.nodeId,
      ) === index,
  );
  if (unique.length === 0) return [snapshotRecommendation(args)];
  return unique.slice(0, 4).map((match) =>
    snapshotRecommendation({
      ...args,
      pageId: match.pageId,
      nodeId: match.nodeId,
    }),
  );
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
    "unpublished_changes",
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

const ThemeOverrideInputSchema = z
  .object({
    colors: z
      .object({
        background: z.string().optional(),
        foreground: z.string().optional(),
        muted: z.string().optional(),
        surface: z.string().optional(),
        mutedForeground: z.string().optional(),
        success: z.string().optional(),
        warning: z.string().optional(),
        danger: z.string().optional(),
        primary: z.string().optional(),
        secondary: z.string().optional(),
        border: z.string().optional(),
      })
      .strict()
      .optional(),
    typography: z
      .object({ fontSans: z.string().optional(), fontMono: z.string().optional() })
      .strict()
      .optional(),
    radius: z
      .object({
        sm: z.string().optional(),
        md: z.string().optional(),
        lg: z.string().optional(),
        xl: z.string().optional(),
      })
      .strict()
      .optional(),
    spacing: z.record(z.string(), z.string()).optional(),
    shadows: z.record(z.string(), z.string()).optional(),
    chartPalette: z.array(z.string()).min(4).max(12).optional(),
    diagramStyle: z
      .object({ nodeRadius: z.string().optional(), edgeStyle: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict();

const ResolvedThemeOutputSchema = z.object({
  name: z.enum(THEME_IDS),
  colors: z.record(z.string(), z.string()),
  typography: z.record(z.string(), z.string()),
  radius: z.record(z.string(), z.string()),
  spacing: z.record(z.string(), z.string()),
  shadows: z.record(z.string(), z.string()),
  chartPalette: z.array(z.string()),
  diagramStyle: z.record(z.string(), z.string()),
});

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
  /*
   * v2 joined the top-level issues and stopped there, which is one level too
   * shallow for a union: a CanvasNode that fails inside its iframe branch
   * reports a single `invalid_union` whose own message is the literal
   * "Invalid input", and the branch that actually names the field is nested
   * underneath. `describeIssues` walks in.
   */
  return describeIssues(err) ?? (err instanceof Error ? err.message : String(err));
}

async function runTool(
  fn: () => Promise<CallToolResult>,
  context?: { operation: string; ref?: string; writeOutcome?: "unknown" },
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    const message = describeError(err);
    if (!context) return { content: [{ type: "text", text: message }], isError: true };
    const code = /^([a-z][a-z0-9_]+):/.exec(message)?.[1] ?? "tool_execution_failed";
    const error = {
      status: "error",
      error: {
        code,
        message,
        operation: context.operation,
        write_outcome: context.writeOutcome ?? "unknown",
      },
      ...(context.ref
        ? {
            recovery: {
              message:
                "The write may have completed. Read the current canvas before changing the payload or retrying.",
              suggested_tool: {
                name: "canvas_get",
                arguments: { ref: context.ref, doc_projection: { summary: true } },
              },
            },
          }
        : {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(error, null, 2) }], isError: true };
  }
}

function runCanvasSave(ref: string) {
  return (fn: () => Promise<CallToolResult>) =>
    runTool(fn, { operation: "canvas_save", ref, writeOutcome: "unknown" });
}

/* ------------------------------------------------------------------------
 * Shared helpers
 * ---------------------------------------------------------------------- */

/** Signed download URLs for every file a canvas has (the worker's `sources`). */
async function resolveCanvasSources(
  ctx: AgentContext,
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
      getUrl: await presignObject(asset.objectKey, "GET", 3600),
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
        "storageId returned by canvas_upload_url. Supported media at /assets paths becomes a reusable workspace asset automatically.",
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

type PreparedSaveChange =
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
  | {
      type: "promote";
      path: string;
      sourceStorageId?: Id<"_storage">;
      objectKey: string;
      contentHash: string;
      mimeType: string;
      size: number;
      kind: "image" | "svg" | "font" | "video" | "data";
      originalFilename: string;
      slug: string;
      name: string;
      objectLeaseId: string;
    }
  | { type: "delete"; path: string };

type PreparedFileResult = {
  path: string;
  size_bytes: number;
  asset_ref?: string;
};

function reusableMime(path: string, contentType?: string): string | null {
  if (!path.startsWith("/assets/")) return null;
  const supplied = contentType?.split(";")[0]?.trim().toLowerCase();
  const inferred = inferArtifactInfo(path).mime.split(";")[0]?.trim().toLowerCase();
  const mime = supplied && supplied !== "application/octet-stream" ? supplied : inferred;
  return mime && mime in ASSET_MIME_TYPES ? mime : null;
}

/**
 * Resolves all `FileInput`s without changing the canvas. Supported media
 * under /assets is validated and copied into content-addressed object
 * storage; `commitSaveContent` creates the workspace asset, immutable
 * revision, and canvas binding in the same database transaction.
 */
async function prepareSaveFiles(
  ctx: AgentContext,
  canvasId: Id<"canvases">,
  userId: Id<"users">,
  files: FileInput[],
): Promise<{
  changes: PreparedSaveChange[];
  filesWritten: PreparedFileResult[];
  writtenText: Array<{ path: string; text: string }>;
  stored: Id<"_storage">[];
  preparedAssets: PreparedAssetObject[];
}> {
  const changes: PreparedSaveChange[] = [];
  const filesWritten: PreparedFileResult[] = [];
  const writtenText: Array<{ path: string; text: string }> = [];
  const stored: Id<"_storage">[] = [];
  const preparedAssets: PreparedAssetObject[] = [];
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
        filesWritten.push({
          path: displayPath,
          size_bytes: asset.size,
          asset_ref: asset.assetRef,
        });
        continue;
      }

      let storageId: Id<"_storage"> | undefined;
      let size: number;
      let contentHash: string;
      let bytes: Uint8Array | undefined;
      let mime: string | null;
      if (file.upload_id) {
        storageId = file.upload_id as Id<"_storage">;
        if (displayPath.startsWith("/assets/")) {
          const replay = await ctx.runQuery(internal.canvases.promotedUploadReplay, {
            canvasId,
            path: displayPath,
            sourceStorageId: storageId,
          });
          if (replay) {
            changes.push({
              type: "asset",
              path: displayPath,
              assetId: replay.assetId,
              assetVersionId: replay.assetVersionId,
            });
            filesWritten.push({
              path: displayPath,
              size_bytes: replay.size,
              asset_ref: replay.assetRef,
            });
            continue;
          }
        }
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
          changes.push({
            type: "write",
            path: displayPath,
            storageId,
            size: existing.size,
            contentHash: existing.contentHash,
          });
          filesWritten.push({ path: displayPath, size_bytes: existing.size });
          continue;
        }
        const metadata = await ctx.storage.getMetadata(storageId);
        if (!metadata) {
          throw new Error(
            `upload_id "${file.upload_id}" does not exist. Upload bytes first, then pass the returned storageId.`,
          );
        }
        size = metadata.size;
        contentHash = metadata.sha256;
        mime = reusableMime(displayPath, metadata.contentType ?? undefined);
        if (mime) {
          if (metadata.size > ASSET_MAX_BYTES) {
            throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
          }
          const blob = await ctx.storage.get(storageId);
          if (!blob) throw new Error(`Unable to read uploaded bytes for ${displayPath}`);
          bytes = new Uint8Array(await blob.arrayBuffer());
        }
      } else {
        const text = file.text as string;
        bytes = new TextEncoder().encode(text);
        const inferred = inferArtifactInfo(relPath).mime;
        size = bytes.byteLength;
        contentHash = await sha256Hex(text);
        writtenText.push({ path: displayPath, text });
        mime = reusableMime(displayPath, inferred);
        if (!mime) {
          storageId = await ctx.storage.store(
            new Blob(
              [
                bytes.buffer.slice(
                  bytes.byteOffset,
                  bytes.byteOffset + bytes.byteLength,
                ) as ArrayBuffer,
              ],
              { type: inferred },
            ),
          );
          stored.push(storageId);
        }
      }

      if (mime && bytes) {
        const originalFilename = relPath.split("/").pop() || "asset";
        const baseName = originalFilename.replace(/\.[^.]+$/, "") || originalFilename;
        const prepared = await prepareAssetObject({
          ctx,
          filename: originalFilename,
          rawBytes: bytes,
          declaredMime: mime,
        });
        preparedAssets.push(prepared);
        changes.push({
          type: "promote",
          path: displayPath,
          sourceStorageId: file.upload_id ? storageId : undefined,
          objectKey: prepared.objectKey,
          contentHash: prepared.contentHash,
          mimeType: prepared.mimeType,
          size: prepared.size,
          kind: prepared.kind,
          originalFilename,
          slug: slugify(baseName),
          name: baseName,
          objectLeaseId: prepared.objectLeaseId,
        });
        filesWritten.push({ path: displayPath, size_bytes: prepared.size });
        continue;
      }

      if (!storageId) throw new Error(`Unable to store ${displayPath}`);
      changes.push({ type: "write", path: displayPath, storageId, size, contentHash });
      filesWritten.push({ path: displayPath, size_bytes: size });
    }
    return { changes, filesWritten, writtenText, stored, preparedAssets };
  } catch (error) {
    await Promise.all([
      ...stored.map((storageId) => ctx.storage.delete(storageId)),
      ...preparedAssets.map((prepared) =>
        discardPreparedAssetObject(ctx, prepared).catch(() => undefined),
      ),
    ]);
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
  z.object({ type: z.literal("group"), group_id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("stage"), stage_id: z.string().min(1) }).strict(),
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

const SnapshotClipSchema = z
  .enum(["frame", "content"])
  .default("frame")
  .describe(
    "frame captures the complete node including device/browser chrome; content clips to the inner iframe or image viewport.",
  );

const SnapshotInputSchema = z
  .object({
    ref: z.string().optional(),
    ref_id: z.string().optional(),
    target: SnapshotTargetSchema.optional(),
    page_id: z.string().optional().describe("Page id; defaults to defaultPageId."),
    expected_version: z.number().int().nonnegative().optional(),
    expected_draft_revision: z.number().int().nonnegative().optional(),
    clip: SnapshotClipSchema,
    padding: z.number().int().min(0).max(256).optional(),
    scale: z.union([z.literal(1), z.literal(2)]).optional(),
    response_mode: z
      .enum(["inline", "link"])
      .default("inline")
      .describe(
        "inline returns a PNG image block when it fits; link returns metadata and a short-lived download_url only.",
      ),
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
    if (input.clip === "content" && !input.ref_id && input.target?.type !== "node") {
      check.addIssue({
        code: "custom",
        path: ["clip"],
        message: "clip=content supports only a node target or ref_id.",
      });
    }
  });

const SnapshotOutputSchema = z
  .object({
    status: z.enum(["ok", "partial"]),
    ref: z.string(),
    ref_id: z.string().optional(),
    version: z.number(),
    draft_revision: z.number().int().nonnegative(),
    page_id: z.string(),
    target: SnapshotTargetSchema,
    clip: z.enum(["frame", "content"]),
    mime_type: z.literal("image/png"),
    width: z.number(),
    height: z.number(),
    size_bytes: z.number(),
    inline: z.boolean(),
    download_url: z.string().optional(),
    cached: z.boolean(),
    warnings: z.array(z.string()),
    diagnostics: z
      .object({
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
      })
      .strict(),
  })
  .strict();

const EmbedTargetInputSchema = z
  .object({
    page_id: z.string().optional().describe("Page id; defaults to defaultPageId."),
    target: SnapshotTargetSchema.default({ type: "canvas" }),
    clip: SnapshotClipSchema,
    scale: z.union([z.literal(1), z.literal(2)]).default(2),
    padding: z.number().int().min(0).max(256).optional(),
  })
  .strict()
  .superRefine((input, check) => {
    if (input.clip === "content" && input.target.type !== "node") {
      check.addIssue({
        code: "custom",
        path: ["clip"],
        message: "clip=content supports only target.type=node.",
      });
    }
  });

export const EmbedInputSchema = z
  .object({
    ref: z.string(),
    pin_version: z
      .boolean()
      .default(false)
      .describe("Pin to the latest published version. Defaults false so the image updates."),
    targets: z
      .array(EmbedTargetInputSchema)
      .min(1)
      .max(50)
      .describe(
        "Required batch of 1-50 preview specifications. Put page_id, target, clip, scale, and padding inside each targets[] item; the former flat top-level target fields are rejected.",
      ),
  })
  .strict();

type SingleEmbedInput = z.infer<typeof EmbedTargetInputSchema> & {
  ref: string;
  pin_version: boolean;
};

const PublicEmbedSchema = z.object({
  image_url: z.string().url(),
  target_url: z.string().url(),
  markdown: z.string(),
  resolved_version: z.number().int().positive(),
  pinned_version: z.number().int().positive().optional(),
});

const PreparedPublicEmbedSchema = PublicEmbedSchema.extend({
  preparation_status: z.enum(["ready", "queued", "updating", "stale", "error"]),
  retry_after_ms: z.number().int().positive().optional(),
});

type PngEmbedMetadata = z.infer<typeof PublicEmbedSchema>;

async function publicEmbedMetadata(
  ctx: AgentContext,
  input: SingleEmbedInput,
  required: boolean,
  prepare = false,
): Promise<{
  embed: PngEmbedMetadata;
  warnings: Warning[];
  pageId: string;
  preparation?: {
    status: "ready" | "queued" | "updating" | "stale" | "error";
    retryAfter?: number;
  };
} | null> {
  const context = await ctx.runQuery(internal.embeds.resolveContextByRef, { ref: input.ref });
  if (!context) {
    if (!required) return null;
    const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: input.ref });
    if (!detail) throw new Error(`canvas_not_found: No canvas found for ref "${input.ref}".`);
    throw new Error("canvas_not_shared: Enable public sharing before requesting an embed URL.");
  }
  if (context.kind !== "canvas" && context.kind !== "html") {
    if (!required) return null;
    throw new Error("unsupported_canvas_kind: PNG embeds support kind=canvas and kind=html.");
  }
  if (context.kind === "html" && input.target.type !== "canvas") {
    if (!required) return null;
    throw new Error("unsupported_embed_target: HTML artifacts support only target=canvas.");
  }
  let pageId = "artifact";
  let alt = context.title;
  if (context.kind === "canvas") {
    if (!context.docStorageId) {
      if (!required) return null;
      throw new Error("embed_unavailable: Published CanvasDoc is unavailable.");
    }
    const blob = await ctx.storage.get(context.docStorageId);
    if (!blob) {
      if (!required) return null;
      throw new Error("embed_unavailable: Published CanvasDoc storage object is unavailable.");
    }
    const file = CanvasFileSchema.parse(JSON.parse(await blob.text()));
    const page = resolveCanvasPage(file, input.page_id);
    if (input.page_id && page.id !== input.page_id) {
      if (!required) return null;
      const source = await ctx.runQuery(internal.canvases.currentDocStorageByRef, {
        ref: input.ref,
      });
      const draftBlob = source ? await ctx.storage.get(source.storageId) : null;
      const draftFile = draftBlob
        ? CanvasFileSchema.parse(JSON.parse(await draftBlob.text()))
        : undefined;
      if (draftFile?.pages.some((candidate) => candidate.id === input.page_id)) {
        throw new Error(
          `target_not_published: Page "${input.page_id}" exists in the current draft but published version ${context.version} does not contain it. Run canvas_checkpoint to publish the current draft.`,
        );
      }
      throw new Error(`page_not_found: ${input.page_id}`);
    }
    pageId = page.id;
    const targetExistsInDraft = async (
      kind: "node" | "group" | "stage",
      id: string,
    ): Promise<boolean> => {
      const source = await ctx.runQuery(internal.canvases.currentDocStorageByRef, {
        ref: input.ref,
      });
      const draftBlob = source ? await ctx.storage.get(source.storageId) : null;
      if (!draftBlob) return false;
      const draftFile = CanvasFileSchema.parse(JSON.parse(await draftBlob.text()));
      const draftPage = resolveCanvasPage(draftFile, input.page_id);
      if (input.page_id && draftPage.id !== input.page_id) return false;
      if (kind === "node") {
        return draftPage.doc.nodes.some((candidate) => candidate.id === id);
      }
      if (kind === "group") {
        return draftPage.doc.groups.some((candidate) => candidate.id === id);
      }
      if (kind === "stage") {
        return draftPage.doc.stages.some((candidate) => candidate.id === id);
      }
      return false;
    };
    const staleTargetError = (kind: "Node" | "Group" | "Stage", id: string) =>
      new Error(
        `target_not_published: ${kind} "${id}" exists in the current draft but published version ${context.version} does not contain it. Run canvas_checkpoint to publish the current draft.`,
      );
    if (input.target.type === "node") {
      const nodeId = input.target.node_id;
      const node = page.doc.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        if (!required) return null;
        if (await targetExistsInDraft("node", nodeId)) throw staleTargetError("Node", nodeId);
        throw new Error(`node_not_found: ${input.target.node_id}`);
      }
      if (input.clip === "content" && node.kind === "native") {
        throw new Error(
          `content_clip_unavailable: Node "${nodeId}" has native content; clip=content requires an iframe or image node.`,
        );
      }
      alt = node.caption.title?.trim() || node.id;
    } else if (input.target.type === "group") {
      const groupId = input.target.group_id;
      const group = page.doc.groups.find((candidate) => candidate.id === groupId);
      if (!group) {
        if (!required) return null;
        if (await targetExistsInDraft("group", groupId)) throw staleTargetError("Group", groupId);
        throw new Error(`group_not_found: ${input.target.group_id}`);
      }
      alt = group.label?.trim() || group.id;
    } else if (input.target.type === "stage") {
      const stageId = input.target.stage_id;
      const stage = page.doc.stages.find((candidate) => candidate.id === stageId);
      if (!stage) {
        if (!required) return null;
        if (await targetExistsInDraft("stage", stageId)) throw staleTargetError("Stage", stageId);
        throw new Error(`stage_not_found: ${input.target.stage_id}`);
      }
      alt = stage.label.trim() || stage.id;
    }
  }
  const scale = input.scale ?? 2;
  if (
    input.target.type === "region" &&
    input.target.width * scale * (input.target.height * scale) > 40_000_000
  ) {
    throw new Error("invalid_region: Region exceeds the 40 megapixel render limit.");
  }
  const padding =
    input.padding ?? (input.clip === "content" || input.target.type === "canvas" ? 0 : 24);
  const version = input.pin_version ? context.version : undefined;
  const imageUrl = embedPngUrl(context.publicSlug, input.target, {
    pageId: context.kind === "canvas" ? pageId : undefined,
    version,
    scale,
    padding,
    clip: input.clip,
  });
  const targetUrl = pngEmbedTargetUrl(
    context.publicSlug,
    input.target,
    context.kind === "canvas" ? pageId : undefined,
  );
  const markdown = githubEmbedMarkdown(alt, imageUrl, targetUrl);
  if (!imageUrl || !targetUrl || !markdown) return null;
  let preparation:
    | { status: "ready" | "queued" | "updating" | "stale" | "error"; retryAfter?: number }
    | undefined;
  if (prepare) {
    const target =
      input.target.type === "node"
        ? ({ type: "node", nodeId: input.target.node_id } as const)
        : input.target.type === "group"
          ? ({ type: "group", groupId: input.target.group_id } as const)
          : input.target.type === "stage"
            ? ({ type: "stage", stageId: input.target.stage_id } as const)
            : input.target;
    const cacheKey = await sha256Hex(
      JSON.stringify({
        renderer: 5,
        canvasId: context.canvasId,
        version: context.version,
        pageId: context.kind === "canvas" ? pageId : "default",
        target,
        clip: input.clip,
        scale,
        padding,
      }),
    );
    const requested = await ctx.runMutation(internal.embeds.requestPreparation, {
      publicSlug: context.publicSlug,
      canvasId: context.canvasId,
      versionId: context.versionId,
      cacheKey,
      pageId: context.kind === "canvas" ? pageId : undefined,
      target,
      clip: input.clip,
      scale,
      padding,
      enforceRateLimit: false,
    });
    preparation = {
      status: requested.status === "rate_limited" ? "queued" : requested.status,
      retryAfter: requested.retryAfter ?? (requested.status === "ready" ? undefined : 3_000),
    };
  }
  return {
    embed: {
      image_url: imageUrl,
      target_url: targetUrl,
      markdown,
      resolved_version: context.version,
      pinned_version: input.pin_version ? context.version : undefined,
    },
    warnings: context.unpublishedChanges
      ? [
          {
            code: "unpublished_changes",
            message: `The embed shows published version ${context.version}; newer draft changes are not public yet.`,
          },
        ]
      : [],
    pageId,
    preparation,
  };
}

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
  ctx: AgentContext,
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
    const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: canvasId });
    const theme = detail?.canvas.resolved_theme as Theme | undefined;
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
      themeTailwindCss: theme ? compileThemeToTailwindV4(theme) : undefined,
      themeRuntimeCss: theme ? compileThemeToCssVariables(theme) : undefined,
      themeJson: theme ? JSON.stringify(theme) : undefined,
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
      await ctx.runMutation(internal.canvases.upsertRenderRecipe, {
        canvasId,
        versionId,
        outputPath: workerResult.relPath,
        entrypoint,
        route: spec.target.type === "file" ? spec.target.route : undefined,
        format: spec.format,
        primary: spec.primary ?? attached.artifact.role === "primary",
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
      });
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
  ctx: AgentContext,
  rawDoc: unknown,
  theme?: Theme,
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
  const parsedDoc = CanvasFileSchema.safeParse(rawDoc);
  if (!parsedDoc.success) {
    // With the raw value in hand the path can say which node, not which index.
    throw new Error(describeIssues(parsedDoc.error, { value: rawDoc }) ?? "Invalid CanvasFile");
  }
  const doc = parsedDoc.data;
  const docJson = JSON.stringify(doc);
  const entry = canvasSnapshotEntryHtml(
    resolveCanvasPage(doc).doc,
    "",
    undefined,
    theme,
    THEME_CSS,
  );
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
          eyebrow: node.caption.tag,
          searchText: [
            page.title,
            node.caption.title,
            node.caption.subtitle,
            node.caption.tag,
            node.annotation?.content,
          ]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join(" "),
        })),
      ),
    },
  };
}

async function saveCanvasFileDraft(
  ctx: AgentContext,
  principal: McpPrincipal,
  canvasId: Id<"canvases">,
  file: CanvasFile,
  options: {
    expectedVersion?: number;
    expectedDraftRevision?: number;
    note?: string;
  },
) {
  const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: canvasId });
  const prepared = await prepareSaveDoc(
    ctx,
    file,
    detail?.canvas.resolved_theme as Theme | undefined,
  );
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

async function loadCanvasFileByRef(ctx: AgentContext, ref: string) {
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
  ctx: AgentContext,
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
  ctx: AgentContext,
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
  files_written: z.array(
    z.object({ path: z.string(), size_bytes: z.number(), asset_ref: z.string().optional() }),
  ),
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
  recommendations: z.array(RecommendationSchema),
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
  ctx: AgentContext,
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
  const response = await getObject(upload.objectKey);
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
  await deleteObject(upload.objectKey).catch(() => undefined);
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

function productionToolDescription(
  name: string,
  base: string | undefined,
  annotations:
    | { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean }
    | undefined,
): string {
  const readOnly = annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint === true;
  const idempotent = annotations?.idempotentHint === true;
  return [
    `Use: ${base ?? name}.`,
    readOnly
      ? "Do not use: when the request requires changing canvas state."
      : "Do not use: for inspection-only requests or when a narrower read tool answers the question.",
    "Prefer: this tool only when its named operation is the smallest operation that matches the request.",
    readOnly
      ? "Side effects: none; this tool reads current durable state."
      : destructive
        ? "Side effects: changes durable state and may remove or replace content named by the input."
        : "Side effects: changes durable state within the addressed canvas or workspace.",
    idempotent
      ? "Retry: safe with identical arguments, subject to explicit version/hash guards."
      : readOnly
        ? "Retry: safe; results may reflect newer durable state."
        : "Retry: first reread returned version/hash/revision fields; an identical retry may repeat the mutation.",
    "Errors: invalid schemas, missing or stale refs, authorization failures, and version/hash conflicts are returned as tool errors with a stable leading code when actionable.",
  ].join(" ");
}

export function registerTools(server: McpServer, ctx: AgentContext, principal: McpPrincipal): void {
  const rawRegisterTool = server.registerTool.bind(server) as (
    ...args: Parameters<McpServer["registerTool"]>
  ) => ReturnType<McpServer["registerTool"]>;
  server.registerTool = ((...args: Parameters<McpServer["registerTool"]>) => {
    const [name, config, callback] = args;
    return rawRegisterTool(
      name,
      {
        ...config,
        description: productionToolDescription(name, config.description, config.annotations),
      },
      callback,
    );
  }) as McpServer["registerTool"];
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
          theme_id: z.enum(THEME_IDS).optional(),
          workspace_brand: ThemeOverrideInputSchema.optional().describe(
            "Workspace-wide semantic token overrides inherited by every canvas.",
          ),
          brand_override: ThemeOverrideInputSchema.optional().describe(
            "Canvas-specific semantic token overrides applied after workspace_brand.",
          ),
          kind: z
            .enum(["canvas", "html", "image", "pdf"])
            .optional()
            .describe("Inferred from doc/renders when omitted. Cannot be changed after creation."),
          doc: z
            .unknown()
            .optional()
            .describe(
              "CanvasFile v3: {version:3, defaultPageId, pages:[{id,title,order,doc:CanvasDocV2}], " +
                "prototype:{start?,interactions}}. The complete multi-page file is saved " +
                `atomically as a durable draft. ${frameGuide()}`,
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
      runCanvasSave(input.ref)(async () => {
        const warnings: Warning[] = [];
        const recommendations: Recommendation[] = [];

        const kind = input.kind ?? (input.doc !== undefined ? "canvas" : "html");
        const upserted = await ctx.runMutation(internal.canvases.upsertByRef, {
          ref: input.ref,
          createdBy: principal.userId,
          title: input.title,
          kind,
          description: input.description,
          themeId: input.theme_id,
          brand: input.brand_override as ThemeOverride | undefined,
          mode: input.mode,
          expectedVersion: input.expected_version,
          deferExistingMetadata: true,
        });
        const canvasId = upserted.canvasId;
        const resolvedTheme = resolveTheme(
          input.theme_id ?? upserted.themeId ?? "clean-saas",
          (input.workspace_brand ?? upserted.workspaceBrand) as ThemeOverride | undefined,
          (input.brand_override ?? upserted.canvasBrand) as ThemeOverride | undefined,
        );

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
          promotedAssets: Array<{
            path: string;
            assetId: Id<"assets">;
            assetVersionId: Id<"assetVersions">;
            revision: number;
            assetRef: string;
          }>;
        } | null = null;
        try {
          preparedFiles = await prepareSaveFiles(
            ctx,
            canvasId,
            principal.userId,
            input.files ?? [],
          );
          let docInput = input.doc;
          if (
            docInput === undefined &&
            kind === "canvas" &&
            (input.theme_id !== undefined ||
              input.workspace_brand !== undefined ||
              input.brand_override !== undefined)
          ) {
            const context = await ctx.runQuery(internal.canvases.snapshotContextByRef, {
              ref: input.ref,
            });
            const blob = context?.docStorageId ? await ctx.storage.get(context.docStorageId) : null;
            if (blob) docInput = JSON.parse(await blob.text());
          }
          preparedDoc =
            docInput === undefined ? undefined : await prepareSaveDoc(ctx, docInput, resolvedTheme);
          if (
            preparedFiles.changes.length > 0 ||
            preparedDoc ||
            input.title !== undefined ||
            input.description !== undefined ||
            input.theme_id !== undefined ||
            input.workspace_brand !== undefined ||
            input.brand_override !== undefined ||
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
                themeId: input.theme_id,
                workspaceBrand: input.workspace_brand as ThemeOverride | undefined,
                canvasBrand: input.brand_override as ThemeOverride | undefined,
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
          await Promise.all(
            (preparedFiles?.preparedAssets ?? []).map((prepared) =>
              discardPreparedAssetObject(ctx, prepared).catch(() => undefined),
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

        const promotedRefByPath = new Map(
          (committed?.promotedAssets ?? []).map((asset) => [asset.path, asset.assetRef]),
        );
        const filesWritten = (preparedFiles?.filesWritten ?? []).map((file) => ({
          ...file,
          asset_ref: file.asset_ref ?? promotedRefByPath.get(file.path),
        }));
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
        recommendations.push(...scanProductionQuality(writtenText, preparedDoc?.doc));

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
        recommendations.push(...warningRecommendations(warnings));
        const stableRef = `${upserted.workspaceSlug}/${upserted.canvasSlug}`;
        if (kind === "canvas" && preparedDoc) {
          const onlyPage =
            preparedDoc.doc.pages.length === 1 ? preparedDoc.doc.pages[0] : undefined;
          const onlyNode = onlyPage?.doc.nodes.length === 1 ? onlyPage.doc.nodes[0] : undefined;
          recommendations.push({
            code: "inspect_changed_canvas",
            message: onlyNode
              ? `Inspect changed node "${onlyNode.id}" before handoff.`
              : "Inspect the changed canvas before handoff.",
            location: { page_id: onlyPage?.id, node_id: onlyNode?.id },
            suggested_tool: {
              name: "canvas_snapshot",
              arguments: {
                ref: stableRef,
                ...(onlyPage ? { page_id: onlyPage.id } : {}),
                target: onlyNode ? { type: "node", node_id: onlyNode.id } : { type: "canvas" },
                expected_version: detail.canvas.version ?? 0,
                expected_draft_revision: detail.canvas.draft_revision,
              },
            },
          });
        } else if ((preparedFiles?.changes.length ?? 0) > 0) {
          recommendations.push(
            ...(await changedFileSnapshotRecommendations(ctx, {
              ref: stableRef,
              version: detail.canvas.version ?? 0,
              draftRevision: detail.canvas.draft_revision,
              paths: preparedFiles?.changes.map((change) => change.path) ?? [],
            })),
          );
        }
        const finalizedRecommendations = boundedRecommendations(recommendations).map((item) => {
          if (item.suggested_tool || !item.location?.node_id) return item;
          return {
            ...item,
            suggested_tool: {
              name: "canvas_snapshot",
              arguments: {
                ref: stableRef,
                ...(item.location.page_id ? { page_id: item.location.page_id } : {}),
                target: { type: "node", node_id: item.location.node_id },
                expected_version: detail.canvas.version ?? 0,
                expected_draft_revision: detail.canvas.draft_revision,
              },
            },
          };
        });
        return result({
          status: degraded ? "partial" : "ok",
          created: upserted.created,
          ref: stableRef,
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
          recommendations: finalizedRecommendations,
        });
      }),
  );

  server.registerTool(
    "canvas_edit",
    {
      title: "Edit canvas files",
      description:
        "Atomically applies one or more exact old_string/new_string edits to UTF-8 canvas files. " +
        "Edits run in array order, so later edits may target text produced earlier in the same " +
        "file. Every match must be unique unless replace_all is explicit; one failure rolls back " +
        "the batch. Pass each current content hash to allow a safe rebase after an unrelated version change.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          edits: z
            .array(
              z
                .object({
                  path: z.string(),
                  old_string: z.string(),
                  new_string: z.string(),
                  replace_all: z.boolean().optional(),
                  expected_hash: z.string().optional(),
                })
                .strict(),
            )
            .min(1)
            .max(50),
          expected_version: z.number().int().nonnegative(),
          expected_draft_revision: z.number().int().nonnegative().optional(),
          note: z.string().optional(),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        files: z.array(
          z.object({
            path: z.string(),
            replacements: z.number().int().positive(),
            previous_hash: z.string(),
            content_hash: z.string(),
          }),
        ),
        total_replacements: z.number().int().positive(),
        requested_version: z.number().int().nonnegative(),
        previous_version: z.number().int().nonnegative(),
        version: z.number().int().positive(),
        draft_revision: z.number().int().nonnegative(),
        dirty: z.boolean(),
        rebased: z.boolean(),
        recommendations: z.array(RecommendationSchema),
      }),
    },
    async (input) =>
      runTool(async () => {
        const paths = [...new Set(input.edits.map((edit) => edit.path))];
        const sources = await Promise.all(
          paths.map((path) => loadEditableFile(ctx, input.ref, path)),
        );
        const first = sources[0];
        if (!first) throw new Error("edits must not be empty");
        if (sources.some((source) => source.canvasId !== first.canvasId)) {
          throw new Error("canvas_mismatch: all edits must target files in one canvas");
        }
        if (sources.some((source) => source.version !== first.version)) {
          throw new Error("version_changed: files were not read from one canvas version; retry.");
        }
        const sourceByPath = new Map(sources.map((source) => [source.path, source]));
        const inputPathToSource = new Map(
          paths.map((path, index) => [path, sources[index] as (typeof sources)[number]]),
        );
        for (const edit of input.edits) {
          const source = inputPathToSource.get(edit.path);
          if (!source) throw new Error(`file_not_found: ${edit.path}`);
          if (
            edit.expected_hash &&
            edit.expected_hash.replace(/^sha256:/, "") !== source.contentHash
          ) {
            throw new Error(
              `hash_conflict: ${JSON.stringify({ path: source.path, expected_hash: edit.expected_hash, current_hash: source.contentHash })}`,
            );
          }
        }
        if (
          first.version !== input.expected_version &&
          input.edits.some((edit) => !edit.expected_hash)
        ) {
          const changedPaths = await ctx.runQuery(internal.canvases.changedPathsSinceVersion, {
            canvasId: first.canvasId,
            expectedVersion: input.expected_version,
          });
          throw new Error(
            `version_conflict: ${JSON.stringify({ expected_version: input.expected_version, current_version: first.version, changed_paths_since: changedPaths, retryable: true, retryable_with_expected_hash: true })}`,
          );
        }
        const edited = applyExactFileEdits(
          new Map(sources.map((source) => [source.path, source.content])),
          input.edits.map((edit) => ({
            path: inputPathToSource.get(edit.path)?.path ?? edit.path,
            oldString: edit.old_string,
            newString: edit.new_string,
            replaceAll: edit.replace_all,
          })),
        );
        const committed = await commitPreparedFileChanges(
          ctx,
          principal,
          first.canvasId,
          first.version,
          input.expected_draft_revision,
          edited.map((file) => ({
            type: "write" as const,
            path: file.path,
            expectedHash: sourceByPath.get(file.path)?.contentHash,
            content: file.content,
          })),
          input.note,
        );
        const committedByPath = new Map(committed.files.map((file) => [file.path, file]));
        const files = edited.map((file) => {
          const source = sourceByPath.get(file.path);
          const contentHash = committedByPath.get(file.path)?.content_hash;
          if (!source || !contentHash) {
            throw new Error(`canvas_edit committed ${file.path} without a content hash`);
          }
          return {
            path: file.path,
            replacements: file.replacements,
            previous_hash: source.contentHash,
            content_hash: contentHash,
          };
        });
        const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: first.canvasId });
        return result({
          status: "ok",
          ref: input.ref,
          files,
          total_replacements: files.reduce((sum, file) => sum + file.replacements, 0),
          requested_version: input.expected_version,
          previous_version: first.version,
          version: committed.version,
          draft_revision: committed.draftRevision,
          dirty: committed.dirty,
          rebased: first.version !== input.expected_version,
          recommendations:
            detail?.canvas.kind === "canvas" || detail?.canvas.kind === "html"
              ? await changedFileSnapshotRecommendations(ctx, {
                  ref: input.ref,
                  version: committed.version,
                  draftRevision: committed.draftRevision,
                  paths: files.map((file) => file.path),
                })
              : [],
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
        recommendations: z.array(RecommendationSchema),
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
        const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref: canvasId });
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
          recommendations:
            detail?.canvas.kind === "canvas" || detail?.canvas.kind === "html"
              ? await changedFileSnapshotRecommendations(ctx, {
                  ref: input.ref,
                  version: committed.version,
                  draftRevision: committed.draftRevision,
                  paths: committed.files.map((file) => file.path),
                })
              : [],
        });
      }),
  );

  const rootChangesSchema = z
    .record(z.string(), z.unknown())
    .describe(
      "Shallow entity-root merge. Nested objects are replaced, not deep-merged; changing rect.x " +
        "requires the complete {x,y,w,h} rect. A null value clears an optional field — the only " +
        "way to unset one without replace, e.g. {frame:{kind:'device',preset:'iphone-safari'}," +
        "viewport:null}.",
    );
  const entityValueSchema = z
    .unknown()
    .describe("Complete CanvasDoc entity, validated as part of the final document.");
  const docPatchCollections = [
    "lanes",
    "stages",
    "labels",
    "nodes",
    "groups",
    "edges",
    "drawings",
  ] as const;
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
    recommendations: z.array(RecommendationSchema),
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
        "rect:{x:10,y:20,w:310,h:708}}}. A null value in changes clears an optional field. " +
        `The final graph is validated atomically. ${frameGuide()}`,
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
        const warnings = dedupeWarnings(
          scanNodeOverlaps([{ id: currentPage.id, title: currentPage.title, doc: patchedDoc }]),
        );
        const operation = input.operations.length === 1 ? input.operations[0] : undefined;
        const targetNodeId =
          operation?.op.startsWith("nodes.") && operation.op !== "nodes.remove"
            ? "id" in operation
              ? operation.id
              : ((operation as { value?: { id?: string } }).value?.id ?? undefined)
            : undefined;
        return result({
          status: "ok",
          ref: input.ref,
          previous_version: input.expected_version,
          version: saved.version,
          draft_revision: saved.draftRevision,
          dirty: saved.dirty,
          page_id: currentPage.id,
          operations: input.operations.length,
          warnings,
          recommendations: boundedRecommendations([
            ...scanProductionQuality([], patchedFile),
            ...warningRecommendations(warnings),
            snapshotRecommendation({
              ref: input.ref,
              version: saved.version,
              draftRevision: saved.draftRevision,
              pageId: currentPage.id,
              nodeId: targetNodeId,
            }),
          ]),
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
    recommendations: z.array(RecommendationSchema),
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
        const warnings = dedupeWarnings(
          scanNodeOverlaps([{ id: page.id, title: page.title, doc: movedDoc }]),
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
          warnings,
          recommendations: boundedRecommendations([
            ...scanProductionQuality([], nextFile),
            ...warningRecommendations(warnings),
            snapshotRecommendation({
              ref: input.ref,
              version: saved.version,
              draftRevision: saved.draftRevision,
              pageId: page.id,
              nodeId: nodeIds.length === 1 ? nodeIds[0] : undefined,
            }),
          ]),
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
    recommendations: z.array(RecommendationSchema),
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
          recommendations: [
            snapshotRecommendation({
              ref: input.ref,
              version: saved.version,
              draftRevision: saved.draftRevision,
              pageId: page.id,
            }),
          ],
        });
      }),
  );
  /* --- comments: the human → agent → human feedback loop --- */

  const CommentThreadSchema = z.object({
    comment_id: z.string(),
    canvas_id: z.string(),
    page_id: z.string(),
    node_id: z.string().optional(),
    point: z.object({ x: z.number(), y: z.number() }).optional(),
    body: z.string(),
    status: z.enum(["open", "completed", "resolved"]),
    author_kind: z.enum(["human", "agent"]),
    created_at: z.number(),
    updated_at: z.number(),
    completion: z
      .object({
        summary: z.string(),
        version: z.number().int().nonnegative(),
        draft_revision: z.number().int().nonnegative(),
        at: z.number(),
      })
      .optional(),
    resolved_at: z.number().optional(),
    replies: z.array(
      z.object({
        reply_id: z.string(),
        body: z.string(),
        author_kind: z.enum(["human", "agent"]),
        created_at: z.number(),
      }),
    ),
  });

  const CommentIdArg = z.string().describe("comment_id from comment_list or comment_create.");

  /** A malformed id would otherwise surface as a raw Convex validator error. */
  const resolveCommentId = async (commentId: string) => {
    const resolved = await ctx.runQuery(internal.comments.resolveId, { id: commentId });
    if (!resolved) throw new Error(`comment_not_found: ${commentId}`);
    return resolved;
  };

  const canvasIdByRef = async (ref: string) => {
    const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref, includeDoc: false });
    if (!detail) throw new Error(`canvas_not_found: No canvas found for ref "${ref}".`);
    return detail.canvas.canvas_id as Id<"canvases">;
  };

  server.registerTool(
    "comment_create",
    {
      title: "Comment on a canvas",
      description:
        "Pins a comment to one node (node_id) or to a point on a Page (at), so a person and an " +
        "agent can talk about a specific thing rather than the whole document. Comments an agent " +
        "writes are labelled as such. New comments start `open`; work through them with " +
        "comment_list, then comment_complete.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          page_id: z.string().optional().describe("Defaults to the file's default Page."),
          node_id: z.string().optional().describe("Anchor the comment to this node."),
          at: z
            .object({ x: z.number(), y: z.number() })
            .strict()
            .optional()
            .describe("World point for a comment on empty page space. Ignored with node_id."),
          body: z.string().min(1).max(4_000),
        })
        .strict(),
      outputSchema: CommentThreadSchema,
    },
    async (input) =>
      runTool(async () => {
        const loaded = await loadCanvasFileByRef(ctx, input.ref);
        const page = resolveCanvasPage(loaded.file, input.page_id);
        if (input.page_id && page.id !== input.page_id) {
          throw new Error(`page_not_found: ${input.page_id}`);
        }
        // Checked against the document itself, which this tool has already
        // read: a comment anchored to a node that is not there would be a
        // note nobody can find.
        if (input.node_id && !page.doc.nodes.some((node) => node.id === input.node_id)) {
          throw new Error(
            `node_not_found: "${input.node_id}" is not a node on page "${page.id}". ` +
              "Read the page with canvas_get to see its node ids.",
          );
        }
        const thread = await ctx.runMutation(internal.comments.create, {
          canvasId: loaded.detail.canvas.canvas_id as Id<"canvases">,
          pageId: page.id,
          nodeId: input.node_id,
          point: input.at,
          body: input.body,
          authorId: principal.userId,
          authorKind: "agent",
        });
        return result(thread);
      }),
  );

  server.registerTool(
    "comment_list",
    {
      title: "Read canvas comments",
      description:
        "Lists comment threads on a canvas, oldest first. Defaults to the open ones — the work " +
        "queue a person left for the agent. Narrow to one Page or one node, or pass status to " +
        "review what has already been completed or resolved.",
      annotations: { readOnlyHint: true },
      inputSchema: z
        .object({
          ref: RefArg,
          page_id: z.string().optional(),
          node_id: z.string().optional(),
          status: z.enum(["open", "completed", "resolved", "all"]).optional(),
          limit: z.number().int().positive().max(200).optional(),
        })
        .strict(),
      outputSchema: z.object({
        comments: z.array(CommentThreadSchema),
        open_count: z.number().int().nonnegative(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = await canvasIdByRef(input.ref);
        const [comments, openCount] = await Promise.all([
          ctx.runQuery(internal.comments.list, {
            canvasId,
            pageId: input.page_id,
            nodeId: input.node_id,
            status: input.status ?? "open",
            limit: input.limit,
          }),
          ctx.runQuery(internal.comments.openCount, { canvasId }),
        ]);
        return result({ comments, open_count: openCount });
      }),
  );

  server.registerTool(
    "comment_reply",
    {
      title: "Reply in a comment thread",
      description:
        "Adds a message to one thread without changing its status. Use it to ask a question or " +
        "report progress; use comment_complete to say the work is done.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({ comment_id: CommentIdArg, body: z.string().min(1).max(4_000) })
        .strict(),
      outputSchema: CommentThreadSchema,
    },
    async (input) =>
      runTool(async () =>
        result(
          await ctx.runMutation(internal.comments.reply, {
            commentId: await resolveCommentId(input.comment_id),
            body: input.body,
            authorId: principal.userId,
            authorKind: "agent",
          }),
        ),
      ),
  );

  server.registerTool(
    "comment_complete",
    {
      title: "Mark a comment completed",
      description:
        "Records that the requested change has been made, with a short summary of what changed. " +
        "The canvas version and draft revision are stamped from the canvas itself, so the person " +
        "who left the comment can go and look at exactly that revision. This is not the end of " +
        "the loop: only the person who asked can mark a comment resolved.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          comment_id: CommentIdArg,
          summary: z
            .string()
            .min(1)
            .max(4_000)
            .describe("What you changed, in the reader's terms — not a diff."),
        })
        .strict(),
      outputSchema: CommentThreadSchema,
    },
    async (input) =>
      runTool(async () =>
        result(
          await ctx.runMutation(internal.comments.complete, {
            commentId: await resolveCommentId(input.comment_id),
            summary: input.summary,
            actorId: principal.userId,
          }),
        ),
      ),
  );

  server.registerTool(
    "comment_status",
    {
      title: "Resolve or reopen a comment",
      description:
        'Reopens a comment (status:"open") when the work needs another pass, or resolves one ' +
        '(status:"resolved"). Resolving is refused for comments a person wrote: confirming ' +
        "someone else's feedback is theirs to do, and comment_complete is how an agent reports " +
        "its own work. An agent may resolve notes it left itself.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z
        .object({ comment_id: CommentIdArg, status: z.enum(["resolved", "open"]) })
        .strict(),
      outputSchema: CommentThreadSchema,
    },
    async (input) =>
      runTool(async () =>
        result(
          await ctx.runMutation(internal.comments.setStatus, {
            commentId: await resolveCommentId(input.comment_id),
            status: input.status,
            actorId: principal.userId,
            actorKind: "agent",
          }),
        ),
      ),
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
        "Atomically snapshots the complete durable draft — all Pages, prototype state, files and asset bindings — as one immutable version. If the canvas is already shared publicly, the checkpoint also becomes its new published share/embed revision.",
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
        published: z.boolean(),
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
          published: checkpoint.published,
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
          page.page.map(async ({ object_key, ...asset }) => ({
            ...asset,
            preview_url: await presignObject(object_key, "GET", 900),
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
          preview_url: await presignObject(asset.objectKey, "GET", 900),
        };
        if (!input.include_preview || !asset.mimeType.startsWith("image/")) return result(payload);
        const response = await getObject(asset.objectKey);
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
            objectKey: `staging/${principal.userId}/${crypto.randomUUID()}`,
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
            objectKey: file.objectKey,
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
              upload_url: await presignObject(file.objectKey, "PUT", 3600),
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
        "Validates MIME/size/hash, stores one immutable object, " +
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

  /* --- canvas_embed --------------------------------------------------- */
  server.registerTool(
    "canvas_embed",
    {
      title: "Create public canvas embed",
      description:
        "Prepares up to 50 public previews and returns canvas.iota.uz PNG URLs plus ready-to-paste linked Markdown for the latest " +
        "published canvas, nodes, groups, stages, or regions without putting image bytes in the MCP response. " +
        "Pass every page_id, target, clip, scale, and padding inside a required targets[] item; flat top-level target fields are not accepted. " +
        "For iframe/image nodes, clip=content captures only the inner viewport without device/browser chrome. " +
        "URLs update after the next public canvas_checkpoint unless pin_version=true. Draft content is never exposed.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: EmbedInputSchema,
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        embeds: z.array(
          z.object({
            page_id: z.string(),
            target: SnapshotTargetSchema,
            clip: z.enum(["frame", "content"]),
            embed: PreparedPublicEmbedSchema,
          }),
        ),
        warnings: z.array(WarningSchema),
      }),
    },
    async (input) =>
      runTool(async () => {
        const embeds = [];
        const warnings: Warning[] = [];
        for (const target of input.targets) {
          const metadata = await publicEmbedMetadata(
            ctx,
            { ...target, ref: input.ref, pin_version: input.pin_version },
            true,
            true,
          );
          if (!metadata) throw new Error("embed_unavailable: Unable to construct embed metadata.");
          warnings.push(...metadata.warnings);
          embeds.push({
            page_id: metadata.pageId,
            target: target.target,
            clip: target.clip,
            embed: {
              ...metadata.embed,
              preparation_status: metadata.preparation?.status ?? "error",
              retry_after_ms: metadata.preparation?.retryAfter,
            },
          });
        }
        return result({
          status: "ok",
          ref: input.ref,
          embeds,
          warnings,
        });
      }),
  );

  /* --- canvas_snapshot ------------------------------------------------ */
  server.registerTool(
    "canvas_snapshot",
    {
      title: "Snapshot canvas selection",
      description:
        "Returns a PNG image block for a complete HTML artifact or for a native canvas, node, group, stage, or exact world-coordinate " +
        "region. For iframe/image nodes, clip=content captures only the inner viewport without device/browser chrome. " +
        "Pass a copied ref_id to see that native node immediately. The capture is rendered from " +
        "the current durable draft revision, not from transient browser state. PNGs above 5 MB " +
        "are not inlined; choose response_mode=link to avoid image tokens for inspection that only needs a URL.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: SnapshotInputSchema,
      outputSchema: SnapshotOutputSchema,
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
        if (context.kind !== "canvas" && context.kind !== "html") {
          throw new Error(
            "unsupported_canvas_kind: canvas_snapshot supports kind=canvas and kind=html.",
          );
        }
        const isNativeCanvas = context.kind === "canvas";
        if (!isNativeCanvas && (target.type !== "canvas" || input.page_id)) {
          throw new Error(
            "unsupported_snapshot_target: HTML artifacts support only the complete canvas target.",
          );
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

        let doc: CanvasDoc | undefined;
        let pageId = "artifact";
        let workerEntrypoint: string;
        if (isNativeCanvas) {
          if (!context.docStorageId) throw new Error("snapshot_failed: CanvasDoc is unavailable.");
          const docBlob = await ctx.storage.get(context.docStorageId);
          if (!docBlob)
            throw new Error("snapshot_failed: CanvasDoc storage object is unavailable.");
          const file = CanvasFileSchema.parse(JSON.parse(await docBlob.text()));
          const page = resolveCanvasPage(file, input.page_id);
          if (input.page_id && page.id !== input.page_id)
            throw new Error(`page_not_found: ${input.page_id}`);
          doc = page.doc;
          pageId = page.id;
          workerEntrypoint = "/src/__canvas.html";
        } else {
          const htmlSource =
            context.files.find((source) => source.relPath === "/src/index.html") ??
            context.files.find(
              (source) =>
                source.relPath.endsWith(".html") && source.relPath !== "/src/__canvas.html",
            );
          if (!htmlSource) {
            throw new Error("snapshot_failed: HTML artifact has no HTML entrypoint.");
          }
          workerEntrypoint = htmlSource.relPath;
        }
        if (target.type === "node" && doc) {
          const node = doc.nodes.find((candidate) => candidate.id === target.node_id);
          if (!node || !resolveElementSelection(doc, target.node_id)) {
            throw new Error(
              `node_not_found: node "${target.node_id}" does not exist at version ${context.version}.`,
            );
          }
          if (input.clip === "content" && node.kind === "native") {
            throw new Error(
              `content_clip_unavailable: Node "${target.node_id}" has native content; clip=content requires an iframe or image node.`,
            );
          }
        }

        if (target.type === "group" && doc) {
          if (!doc.groups.some((group) => group.id === target.group_id)) {
            throw new Error(`group_not_found: ${target.group_id}`);
          }
        }

        if (target.type === "stage" && doc) {
          if (!doc.stages.some((stage) => stage.id === target.stage_id)) {
            throw new Error(`stage_not_found: ${target.stage_id}`);
          }
        }

        const padding =
          input.padding ?? (input.clip === "content" || target.type === "canvas" ? 0 : 24);
        const scale = input.scale ?? 1;
        const normalizedTarget =
          target.type === "node"
            ? { type: "node" as const, nodeId: target.node_id }
            : target.type === "group"
              ? { type: "group" as const, groupId: target.group_id }
              : target.type === "stage"
                ? { type: "stage" as const, stageId: target.stage_id }
                : target;
        const detail = await ctx.runQuery(internal.canvases.detailByRef, { ref });
        const theme = detail?.canvas.resolved_theme as Theme | undefined;
        const cacheKey = await sha256Hex(
          JSON.stringify({
            renderer: 3,
            draftRevision: context.draftRevision,
            pageId,
            target: normalizedTarget,
            clip: input.clip,
            padding,
            scale,
            theme,
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
                getUrl: await presignObject(asset.objectKey, "GET", 3600),
              })),
            )),
          ];
          let temporaryEntryStorageId: Id<"_storage"> | undefined;
          if (doc) {
            // Native canvases stage a target-aware immutable export page. Reusing the
            // eager page would load every sibling iframe before the worker knows which
            // node/region was requested.
            const cssBlob = context.cssStorageId
              ? await ctx.storage.get(context.cssStorageId)
              : null;
            const entryBytes = new TextEncoder().encode(
              canvasSnapshotEntryHtml(
                doc,
                cssBlob ? await cssBlob.text() : "",
                normalizedTarget,
                undefined,
                THEME_CSS,
              ),
            );
            temporaryEntryStorageId = await ctx.storage.store(
              new Blob([entryBytes], { type: "text/html" }),
            );
            const getUrl = await ctx.storage.getUrl(temporaryEntryStorageId);
            if (!getUrl) {
              await ctx.storage.delete(temporaryEntryStorageId);
              throw new Error("snapshot_failed: unable to stage immutable export page.");
            }
            const entryIndex = sources.findIndex((source) => source.relPath === workerEntrypoint);
            if (entryIndex >= 0) sources.splice(entryIndex, 1);
            sources.push({ relPath: workerEntrypoint, getUrl });
          }

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
                    entrypoint: workerEntrypoint,
                    target: normalizedTarget,
                    clip: input.clip,
                    padding,
                    scale,
                    readinessTimeoutMs: input.timeout_ms,
                    upload: { putUrl },
                    themeTailwindCss: theme ? compileThemeToTailwindV4(theme) : undefined,
                    themeRuntimeCss: theme ? compileThemeToCssVariables(theme) : undefined,
                    themeJson: theme ? JSON.stringify(theme) : undefined,
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
            if (temporaryEntryStorageId) {
              await ctx.storage.delete(temporaryEntryStorageId).catch(() => undefined);
            }
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
        const linkOnly = input.response_mode === "link";
        const requiresDownload = tooLargeToInline || linkOnly;
        const bytes = requiresDownload ? null : new Uint8Array(await blob.arrayBuffer());
        if (requiresDownload && snapshot.status === "partial") {
          // Partial captures are never returned by getSnapshotCache. A link
          // response still needs one deterministic cleanup-owned row so its
          // URL remains valid without accumulating one row per retry.
          snapshot = await ctx.runMutation(internal.canvases.putSnapshotCache, {
            canvasId: context.canvasId,
            versionId: context.versionId,
            cacheKey: `${cacheKey}:download`,
            storageId: snapshot.storageId,
            size: snapshot.size,
            width: snapshot.width,
            height: snapshot.height,
            status: snapshot.status,
            warnings: snapshot.warnings,
            diagnostics: snapshot.diagnostics,
          });
        }
        const downloadUrl = requiresDownload
          ? ((await ctx.storage.getUrl(snapshot.storageId)) ?? undefined)
          : undefined;
        if (!cached && snapshot.status === "partial" && !requiresDownload) {
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
              : doc
                ? { x: 0, y: 0, width: doc.world.width, height: doc.world.height }
                : null;
          if (!bounds) {
            regionsTruncated = false;
          } else {
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
        }
        const warnings = tooLargeToInline
          ? [...new Set([...snapshot.warnings, "snapshot_too_large"])]
          : [...snapshot.warnings];
        const metadata = SnapshotOutputSchema.parse({
          status: tooLargeToInline ? ("partial" as const) : snapshot.status,
          ref,
          ref_id: canonicalRefId,
          version: context.version,
          draft_revision: context.draftRevision,
          page_id: pageId,
          target,
          clip: input.clip,
          mime_type: snapshot.mimeType,
          width: snapshot.width,
          height: snapshot.height,
          size_bytes: snapshot.size,
          inline: !requiresDownload,
          download_url: downloadUrl,
          cached,
          warnings: [...new Set(warnings)],
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
        });
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
            .array(
              z.enum(["doc", "files", "artifacts", "versions", "renders", "storage", "comments"]),
            )
            .optional(),
          doc_projection: z
            .object({
              summary: z.boolean().optional(),
              node_ids: z.array(z.string()).max(100).optional(),
              collections: z
                .array(
                  z.enum(["lanes", "stages", "labels", "nodes", "edges", "drawings", "legend"]),
                )
                .max(7)
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
              theme_id: z.enum(THEME_IDS),
              workspace_brand: ThemeOverrideInputSchema.optional(),
              brand_override: ThemeOverrideInputSchema.optional(),
              resolved_theme: ResolvedThemeOutputSchema,
              // Always present, so an agent reading a canvas notices the
              // feedback waiting on it without having to ask a second tool.
              open_comments: z.number().int().nonnegative(),
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
          comments: z.array(CommentThreadSchema).optional(),
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
              z.object({
                is_done: z.boolean(),
                next_request: z
                  .object({
                    ref: z.string(),
                    include: z.array(z.enum(["files", "artifacts", "versions", "renders"])),
                    pagination: z
                      .object({
                        limit: z.number().int().positive(),
                        expected_version: z.number().int().nonnegative(),
                        files_cursor: z.string().optional(),
                        artifacts_cursor: z.string().optional(),
                        versions_cursor: z.string().optional(),
                        renders_cursor: z.string().optional(),
                      })
                      .strict(),
                  })
                  .strict()
                  .nullable(),
              }),
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
        if (input.doc_projection) include.add("doc");
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
                world: canvasDoc.world,
                counts: {
                  lanes: canvasDoc.lanes.length,
                  stages: canvasDoc.stages.length,
                  labels: canvasDoc.labels.length,
                  nodes: canvasDoc.nodes.length,
                  edges: canvasDoc.edges.length,
                  drawings: canvasDoc.drawings.length,
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
                drawings: collections.has("drawings") ? canvasDoc.drawings : undefined,
                legend: collections.has("legend") ? canvasDoc.legend : undefined,
              },
            },
            prototype: canvasFile.prototype,
          };
        })();

        const canvasId = detail.canvas.canvas_id as Id<"canvases">;
        const [openComments, commentThreads] = await Promise.all([
          ctx.runQuery(internal.comments.openCount, { canvasId }),
          include.has("comments")
            ? ctx.runQuery(internal.comments.list, {
                canvasId,
                // Scoped to the Page being read when there is one: the
                // comments that matter are the ones on what you are looking at.
                pageId: selectedPage?.id ?? input.page_id,
                status: "open",
              })
            : Promise.resolve(undefined),
        ]);

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

        const canonicalRef = detail.workspace_slug
          ? `${detail.workspace_slug}/${detail.canvas.slug}`
          : detail.canvas.canvas_id;
        return result({
          canvas: {
            ref: canonicalRef,
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
            theme_id: detail.canvas.theme_id,
            workspace_brand: detail.canvas.workspace_brand,
            brand_override: detail.canvas.brand_override,
            resolved_theme: detail.canvas.resolved_theme,
            open_comments: openComments,
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
          comments: commentThreads,
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
                      next_request: facetPages[facet].isDone
                        ? null
                        : {
                            ref: canonicalRef,
                            include: [facet],
                            pagination: {
                              limit: input.pagination?.limit ?? 50,
                              expected_version: detail.canvas.version ?? 0,
                              [`${facet}_cursor`]: facetPages[facet].continueCursor,
                            },
                          },
                    },
                  ]),
                )
              : undefined,
        });
      }),
  );

  const FileReadRequestSchema = z
    .object({
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
        check.addIssue({ code: "custom", message: "Choose either lines or bytes, not both." });
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
    });

  const FileProjectionOutputSchema = z.object({
    path: z.string(),
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
      title: "Read canvas files",
      description:
        "Reads up to 20 UTF-8 canvas source files in one bounded call with current version and content hashes. Use line " +
        "or byte ranges for large files instead of repeated calls or a full canvas_get. Ranges are " +
        "zero-copy response projections: line numbers are 1-based and inclusive; byte offsets " +
        "are 0-based with an exclusive end. Full/line content is UTF-8; exact byte ranges are " +
        "base64 so offsets may safely split a multibyte character. Check the encoding field.",
      annotations: { readOnlyHint: true },
      inputSchema: z
        .object({
          ref: RefArg,
          requests: z.array(FileReadRequestSchema).min(1).max(20),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        version: z.number(),
        response_bytes: z.number().int().nonnegative(),
        files: z.array(FileProjectionOutputSchema),
      }),
    },
    async (input) =>
      runTool(async () => {
        const MAX_FILE_RESPONSE_BYTES = 128 * 1024;
        const MAX_TOTAL_RESPONSE_BYTES = 512 * 1024;
        const sources = await Promise.all(
          input.requests.map((request) => loadEditableFile(ctx, input.ref, request.path)),
        );
        const first = sources[0];
        if (!first) throw new Error("requests must not be empty");
        if (sources.some((source) => source.version !== first.version)) {
          throw new Error("version_changed: files were not read from one canvas version; retry.");
        }
        const files = sources.map((source, index) => {
          const request = input.requests[index];
          if (!request) throw new Error("request_projection_mismatch");
          const projection = projectTextFile(
            source.content,
            {
              startLine: request.start_line,
              endLine: request.end_line,
              startByte: request.start_byte,
              endByte: request.end_byte,
            },
            MAX_FILE_RESPONSE_BYTES,
          );
          return {
            path: source.path,
            size_bytes: new TextEncoder().encode(source.content).byteLength,
            content_hash: source.contentHash,
            encoding: projection.encoding,
            content: projection.content,
            range: projection.range,
            truncated: projection.truncated,
            responseBytes: projection.responseBytes,
          };
        });
        const responseBytes = files.reduce((sum, file) => sum + file.responseBytes, 0);
        if (responseBytes > MAX_TOTAL_RESPONSE_BYTES) {
          throw new Error(
            `response_too_large: projected content is ${responseBytes} bytes; one batch is capped at ${MAX_TOTAL_RESPONSE_BYTES} bytes.`,
          );
        }

        return result({
          status: "ok",
          ref: input.ref,
          version: first.version,
          response_bytes: responseBytes,
          files: files.map(({ responseBytes: _responseBytes, ...file }) => file),
        });
      }),
  );

  server.registerTool(
    "canvas_file_search",
    {
      title: "Search canvas files",
      description:
        "Searches current UTF-8 canvas source files for a literal string and returns bounded line matches. " +
        "Use this to locate text or identifiers before canvas_file_get or canvas_edit; it does not search canvas titles or CanvasDoc nodes.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z
        .object({
          ref: RefArg,
          query: z.string().min(1).max(1_000),
          case_sensitive: z.boolean().default(false),
          path_prefixes: z.array(z.string()).min(1).max(20).optional(),
          context_lines: z.number().int().min(0).max(5).default(0),
          max_matches: z.number().int().positive().max(200).default(50),
        })
        .strict(),
      outputSchema: z.object({
        status: z.literal("ok"),
        ref: z.string(),
        version: z.number().int().nonnegative(),
        query: z.string(),
        matches: z.array(
          z.object({
            path: z.string(),
            line: z.number().int().positive(),
            column: z.number().int().positive(),
            preview: z.string(),
          }),
        ),
        scanned_files: z.number().int().nonnegative(),
        scanned_bytes: z.number().int().nonnegative(),
        skipped: z.array(
          z.object({
            path: z.string(),
            reason: z.literal("binary_file"),
          }),
        ),
        truncated: z.boolean(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const detail = await ctx.runQuery(internal.canvases.detailByRef, {
          ref: input.ref,
          includeFiles: true,
        });
        if (!detail) throw new Error(`canvas_not_found: No canvas found for ref "${input.ref}".`);
        const candidates = (detail.files ?? []).filter(
          (file) =>
            /\.(?:html?|css|m?js|cjs|jsx|tsx?|json|md|txt|svg|xml|ya?ml|d2)$/i.test(file.path) &&
            (!input.path_prefixes ||
              input.path_prefixes.some((prefix) => file.path.startsWith(prefix))),
        );
        const MAX_SCANNED_FILES = 100;
        const MAX_SCANNED_BYTES = 2 * 1024 * 1024;
        const SEARCH_BATCH_SIZE = 8;
        const matches: Array<{ path: string; line: number; column: number; preview: string }> = [];
        const skipped: Array<{ path: string; reason: "binary_file" }> = [];
        let scannedFiles = 0;
        let scannedBytes = 0;
        let loadedBudgetBytes = 0;
        let truncated = candidates.length > MAX_SCANNED_FILES;
        const limitedCandidates = candidates.slice(0, MAX_SCANNED_FILES);
        candidateBatches: for (let offset = 0; offset < limitedCandidates.length; ) {
          if (matches.length >= input.max_matches) {
            truncated = true;
            break;
          }
          const chunk: (typeof limitedCandidates)[number][] = [];
          let chunkBytes = 0;
          while (offset < limitedCandidates.length && chunk.length < SEARCH_BATCH_SIZE) {
            const candidate = limitedCandidates[offset];
            if (!candidate) break;
            if (loadedBudgetBytes + chunkBytes + candidate.size_bytes > MAX_SCANNED_BYTES) {
              truncated = true;
              break;
            }
            chunk.push(candidate);
            chunkBytes += candidate.size_bytes;
            offset += 1;
          }
          if (chunk.length === 0) break;
          loadedBudgetBytes += chunkBytes;
          const loaded = await Promise.all(
            chunk.map(async (candidate) => {
              try {
                return {
                  candidate,
                  source: await loadEditableFile(ctx, input.ref, candidate.path),
                };
              } catch (error) {
                if (error instanceof Error && error.message.startsWith("binary_file:")) {
                  return { candidate, source: null };
                }
                throw error;
              }
            }),
          );
          for (const { candidate, source } of loaded) {
            if (!source) {
              skipped.push({ path: candidate.path, reason: "binary_file" });
              continue;
            }
            if (matches.length >= input.max_matches) {
              truncated = true;
              break candidateBatches;
            }
            scannedFiles += 1;
            scannedBytes += candidate.size_bytes;
            const remaining = input.max_matches - matches.length;
            matches.push(
              ...searchText(source.content, input.query, {
                caseSensitive: input.case_sensitive,
                contextLines: input.context_lines,
                maxMatches: remaining,
              }).map((match) => ({ path: source.path, ...match })),
            );
          }
        }
        return result({
          status: "ok",
          ref: input.ref,
          version: detail.canvas.version ?? 0,
          query: input.query,
          matches,
          scanned_files: scannedFiles,
          scanned_bytes: scannedBytes,
          skipped,
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
        "Executes an async JS/TS script in a sandboxed worker against this canvas's files; top-level await is supported. " +
        "Injected globals include fs (readFileSync/writeFileSync/mkdirSync/readdirSync/existsSync), " +
        "console, fetch, WebSocket, Buffer, URL, timers, and require for path/buffer/util/assert, " +
        "network modules, ApexCharts, D2, and Tailwind. The canvas global accumulates typed CanvasDoc " +
        "operations; canvas.commit() requests one validated, revision-checked draft transaction after " +
        "the script succeeds. Anything written to /output is collected as an artifact. There is no " +
        "shell and filesystem access is confined to the canvas workspace.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z
        .object({
          ref: RefArg,
          code: z.string(),
          page_id: z
            .string()
            .optional()
            .describe("Canvas Page to mutate; defaults to defaultPageId."),
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
        canvas: z
          .object({
            committed: z.boolean(),
            page_id: z.string(),
            previous_revision: z.number().int().nonnegative(),
            revision: z.number().int().nonnegative(),
            operations_applied: z.number().int().nonnegative(),
            created_node_ids: z.array(z.string()),
          })
          .optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const detail = await ctx.runQuery(internal.canvases.detailByRef, {
          ref: input.ref,
          includeDoc: true,
        });
        if (!detail) throw new Error(`No canvas found for ref "${input.ref}".`);
        const canvasId = detail.canvas.canvas_id;
        const initialVersion = detail.canvas.version ?? 0;
        const initialDraftRevision = detail.canvas.draft_revision;
        const currentVersion = await ctx.runQuery(internal.canvases.currentVersion, { canvasId });
        if (!currentVersion) throw new Error("Canvas has no current version.");

        let initialFile: CanvasFile | undefined;
        let initialPageId: string | undefined;
        if (detail.canvas.kind === "canvas" && detail.canvas.doc_url) {
          const response = await fetch(detail.canvas.doc_url);
          if (!response.ok) throw new Error(`Unable to load CanvasDoc: HTTP ${response.status}`);
          initialFile = CanvasFileSchema.parse(await response.json());
          const page = resolveCanvasPage(initialFile, input.page_id);
          if (input.page_id && page.id !== input.page_id) {
            throw new Error(`page_not_found: ${input.page_id}`);
          }
          initialPageId = page.id;
        }

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
          canvas?: {
            commitRequested: boolean;
            operations: unknown[];
            createdNodeIds: string[];
          };
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
        let patchedFile: CanvasFile | undefined;
        const requestedCommit =
          workerResult.success && workerResult.canvas?.commitRequested === true;
        const canvasOperations = workerResult.canvas?.operations ?? [];
        if (requestedCommit) {
          if (!initialFile || !initialPageId) {
            throw new Error("canvas_commit_unsupported: canvas.commit() requires kind=canvas.");
          }
          if (canvasOperations.length === 0 || canvasOperations.length > 100) {
            throw new Error("canvas_commit_invalid: expected between 1 and 100 operations.");
          }
          const page = resolveCanvasPage(initialFile, initialPageId);
          const patchedDoc = applyCanvasDocPatch(
            page.doc,
            canvasOperations as CanvasDocPatchOperation[],
          );
          patchedFile = CanvasFileSchema.parse({
            ...initialFile,
            pages: initialFile.pages.map((candidate) =>
              candidate.id === page.id ? { ...candidate, doc: patchedDoc } : candidate,
            ),
          });
        }
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

        let canvasCommit:
          | {
              committed: boolean;
              page_id: string;
              previous_revision: number;
              revision: number;
              operations_applied: number;
              created_node_ids: string[];
            }
          | undefined;
        if (patchedFile && initialPageId) {
          try {
            const saved = await saveCanvasFileDraft(ctx, principal, canvasId, patchedFile, {
              expectedVersion: initialVersion,
              expectedDraftRevision: initialDraftRevision,
              note: `canvas_run commit (${canvasOperations.length})`,
            });
            canvasCommit = {
              committed: true,
              page_id: initialPageId,
              previous_revision: initialDraftRevision,
              revision: saved.draftRevision,
              operations_applied: canvasOperations.length,
              created_node_ids: workerResult.canvas?.createdNodeIds ?? [],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/draft conflict|version conflict/i.test(message)) {
              throw new Error(`revision_conflict: ${message}`);
            }
            throw error;
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
          canvas: canvasCommit,
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
      title: "Upload files for a canvas save",
      description:
        "Returns short-lived URLs for uploading one or up to 50 files out of band. POST each " +
        "file's raw bytes, read storageId from each JSON response, then pass those values as " +
        "files[].upload_id in one canvas_save. Supported media at /assets paths becomes reusable " +
        "workspace assets automatically; /src source and /output artifacts remain canvas-local.",
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
            'POST each file to upload_url with its Content-Type. Each response is {"storageId":"..."}; pass each value as upload_id at the matching path in one canvas_save. Supported /assets media is added to the workspace library automatically.',
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
export function registerResources(server: McpServer, ctx: AgentContext): void {
  for (const guide of MCP_GUIDES) {
    server.registerResource(
      `guide-${guide.id}`,
      `canvas://guides/${guide.id}`,
      {
        title: guide.title,
        description: guide.description,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide.text }],
      }),
    );
  }

  server.registerResource(
    "template-catalog",
    "canvas://templates",
    {
      title: "Canonical template catalog",
      description:
        "Compact metadata for choosing one production UI example before loading its source.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            templateRegistryList().map((template) => ({
              id: template.id,
              name: template.name,
              kind: template.kind,
              description: template.description,
              useWhen: template.useWhen,
              avoidWhen: template.avoidWhen,
              compatibleThemes: template.compatibleThemes,
              resource: `canvas://templates/${template.id}`,
              previewResource: `canvas://templates/${template.id}/preview`,
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "theme-catalog",
    "canvas://themes",
    {
      title: "Semantic theme catalog",
      description: "Available base theme IDs and their complete semantic token sets.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            listThemes().map((theme) => ({
              ...theme,
              tailwindCss: compileThemeToTailwindV4(theme),
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );
  for (const theme of listThemes()) {
    server.registerResource(
      `theme-${theme.name}`,
      `canvas://themes/${theme.name}`,
      {
        title: theme.name,
        description: `Complete semantic tokens for ${theme.name}.`,
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { ...theme, tailwindCss: compileThemeToTailwindV4(theme) },
              null,
              2,
            ),
          },
        ],
      }),
    );
  }
  server.registerResource(
    "workspace-theme",
    new ResourceTemplate("canvas://workspaces/{workspace}/theme", { list: undefined }),
    {
      title: "Resolved workspace theme",
      description: "Base theme with the named workspace's brand overrides applied.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const workspaceSlug = String(variables.workspace ?? "");
      const workspace = await ctx.runQuery(internal.workspaces.getThemeBySlug, {
        slug: workspaceSlug,
      });
      if (!workspace) throw new Error(`workspace_not_found: ${workspaceSlug}`);
      const theme = resolveTheme(workspace.themeId, workspace.brand as ThemeOverride | undefined);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { ...theme, tailwindCss: compileThemeToTailwindV4(theme) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

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
                `Use when: ${full.useWhen.join("; ")}`,
                `Avoid when: ${full.avoidWhen.join("; ")}`,
                `Supported viewports: ${JSON.stringify(full.supportedViewports)}`,
                `Required states: ${full.requiredStates.join(", ")}`,
                `Design characteristics: ${full.designCharacteristics.join(", ")}`,
                `Compatible themes: ${full.compatibleThemes.join(", ")}`,
                `Preview: canvas://templates/${full.id}/preview`,
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
    server.registerResource(
      `template-preview-${template.id}`,
      `canvas://templates/${template.id}/preview`,
      {
        title: `${template.name} preview source`,
        description: `Renderable ${template.preview.format} preview at ${template.preview.viewport.width}×${template.preview.viewport.height}.`,
        mimeType: template.preview.format === "html" ? "text/html" : "text/plain",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: template.preview.format === "html" ? "text/html" : "text/plain",
            text: template.exampleCode,
          },
        ],
      }),
    );
  }
}
