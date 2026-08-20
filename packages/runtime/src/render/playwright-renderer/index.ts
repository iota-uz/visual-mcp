/**
 * Playwright-based HTML -> PNG/SVG/PDF/HTML renderer (PLAN.md sections 5,
 * 8.1, 8.2, tool spec 6.4 `render_file`).
 *
 * Public API: `renderFile(options: RenderFileOptions): Promise<RenderFileResult>`.
 *
 * Pipeline:
 *   1. Read the HTML `entrypoint` file.
 *   2. If it has a `<style>@import "tailwindcss"; ...</style>` block
 *      (PLAN.md section 3.1), build it with the real Tailwind v4 CLI
 *      (see ./tailwind.ts) and splice the resulting CSS back into the
 *      document in place of the raw `@import` block (see ./html.ts).
 *      Plain HTML with no Tailwind entry block is passed through
 *      untouched — Tailwind is optional, not required.
 *   3. format "html": write the (CSS-built) HTML straight to
 *      `outputPath`. No browser is launched for this format.
 *   4. format "png"/"pdf": write the built HTML to a temp file next to
 *      the entrypoint, launch headless Chromium, install local-asset
 *      resource routing (see ./routing.ts — resolves the `/assets/...`
 *      path contract; network sandboxing has been intentionally removed,
 *      remote requests now hit the real network), navigate to it, then:
 *        - "png": `page.screenshot({ fullPage: true })` -> Sharp
 *          optimization -> write PNG (PLAN.md section 8.1).
 *        - "pdf": `page.pdf(...)` with PLAN.md section 5's pagination
 *          (`break-after: page` sections, driven entirely by Chromium's
 *          print engine — no Document builder API) and the `pdf` options
 *          (format/orientation/printBackground/headers-footers).
 *
 * format "svg" is NOT supported for HTML entrypoints and always throws —
 * see the dedicated comment on that branch below for why, and who should
 * route around it.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

import type { PdfOptions, RenderFormat, ViewportOptions } from "../../types.js";
import { findTailwindStyleBlock, injectBuiltCss } from "./html.js";
import {
  inferWorkspaceRoot,
  installLocalResourceRouting,
  type UnresolvedRefDetail,
} from "./routing.js";
import { buildTailwindCss } from "./tailwind.js";

export { inferWorkspaceRoot, installLocalResourceRouting } from "./routing.js";
export { buildTailwindCss } from "./tailwind.js";

export interface RenderFileOptions {
  /** Absolute path to the HTML source file to render. */
  entrypoint: string;
  /** Optional local hash route appended to the browser URL. */
  route?: string;
  /** Absolute path to write the rendered artifact to. Parent directories are created as needed. */
  outputPath: string;
  format: RenderFormat;
  /** Only consulted for "png" (and as the browser viewport for "pdf" layout prior to print). Defaults to 1200x800 @1x. */
  viewport?: ViewportOptions;
  /** Only consulted for format "pdf". */
  pdf?: PdfOptions;
  /**
   * Session workspace root, used to resolve root-relative asset paths like
   * `/assets/js/apexcharts.min.js` (see ./routing.ts). If omitted, it is
   * inferred by walking up from `entrypoint`'s directory looking for a
   * sibling `assets/` dir; falls back to `entrypoint`'s own directory if
   * none is found.
   */
  workspaceRoot?: string;
}

export interface RenderFileResult {
  /** Absolute path the artifact was written to (equal to `outputPath`, resolved). */
  path: string;
  /**
   * Subresources the page asked for and did not get — missing local files,
   * `file:` paths outside the workspace, failed remote requests — as
   * workspace-relative paths (`/src/accident-1.jpg`) or full URLs for
   * remote ones. De-duplicated and capped at `MAX_UNRESOLVED_REFS`.
   *
   * Purely diagnostic: Chromium renders a broken image rather than
   * failing, so a non-empty list accompanies an otherwise successful
   * render and its artifact. Empty for `format: "html"`, which never
   * launches a browser and therefore never resolves a subresource at all.
   */
  unresolvedRefs: string[];
  unresolvedDetails: UnresolvedRefDetail[];
  readiness: { status: "ready" | "partial"; warnings: string[] };
}

export type CanvasSnapshotTarget =
  | { type: "canvas" }
  | { type: "node"; nodeId: string }
  | { type: "region"; x: number; y: number; width: number; height: number };

export interface SnapshotCanvasOptions {
  entrypoint: string;
  outputPath: string;
  target: CanvasSnapshotTarget;
  padding?: number;
  scale?: 1 | 2;
  readinessTimeoutMs?: number;
  workspaceRoot?: string;
}

export interface SnapshotCanvasResult extends RenderFileResult {
  width: number;
  height: number;
  downscaled: boolean;
  contentOverflow: boolean;
}

const DEFAULT_VIEWPORT_WIDTH = 1200;
const DEFAULT_VIEWPORT_HEIGHT = 800;
const SNAPSHOT_MAX_DIMENSION = 4096;
const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

/** Captures a native CanvasDoc world, one rendered node, or a world-coordinate region. */
export async function snapshotCanvas(
  options: SnapshotCanvasOptions,
): Promise<SnapshotCanvasResult> {
  const absEntrypoint = path.resolve(options.entrypoint);
  const absOutputPath = path.resolve(options.outputPath);
  const entrypointDir = path.dirname(absEntrypoint);
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(options.workspaceRoot)
    : await inferWorkspaceRoot(absEntrypoint);
  const rawHtml = await fs.readFile(absEntrypoint, "utf8");
  const builtHtml = await buildHtmlWithTailwind(rawHtml, entrypointDir);
  const tempHtmlPath = path.join(entrypointDir, `.snapshot-${randomUUID()}.html`);
  await fs.mkdir(path.dirname(absOutputPath), { recursive: true });
  await fs.writeFile(tempHtmlPath, builtHtml, "utf8");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: DEFAULT_VIEWPORT_WIDTH, height: DEFAULT_VIEWPORT_HEIGHT },
      deviceScaleFactor: options.scale ?? 1,
      javaScriptEnabled: true,
    });
    try {
      const page = await context.newPage();
      const unresolved = await installLocalResourceRouting(page, workspaceRoot);
      const virtualPath = path
        .relative(workspaceRoot, tempHtmlPath)
        .split(path.sep)
        .map(encodeURIComponent)
        .join("/");
      await page.goto(`http://canvas.local/${virtualPath}`, { waitUntil: "networkidle" });
      await expandViewportForIframeCanvas(page);
      await page.evaluate(() => document.fonts?.ready);
      const readiness = await waitForCanvasReadiness(page, options.readinessTimeoutMs).catch(
        (error: unknown) => ({
          status: "partial" as const,
          warnings: [error instanceof Error ? error.message : String(error)],
        }),
      );
      await warmIframeSurfaces(page);

      const world = page.locator(".vc-world").first();
      if ((await world.count()) === 0) throw new Error("snapshot_failed: .vc-world was not found");
      const worldBox = await world.boundingBox();
      if (!worldBox) throw new Error("snapshot_failed: canvas world has no visible bounds");

      let clip: { x: number; y: number; width: number; height: number };
      let contentOverflow = false;
      if (options.target.type === "canvas") {
        clip = worldBox;
      } else if (options.target.type === "node") {
        // Attribute values are compared in the page instead of interpolated into a CSS selector,
        // so arbitrary valid node ids cannot escape the selector.
        const nodeBox = await page.locator("[data-node-id]").evaluateAll((nodes, nodeId) => {
          const match = nodes.find(
            (candidate) => candidate.getAttribute("data-node-id") === nodeId,
          );
          if (!match) return null;
          const rect = match.getBoundingClientRect();
          const element = match as HTMLElement;
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            overflow:
              element.scrollWidth > element.clientWidth ||
              element.scrollHeight > element.clientHeight,
          };
        }, options.target.nodeId);
        if (!nodeBox) throw new Error(`node_not_found: ${options.target.nodeId}`);
        contentOverflow = nodeBox.overflow;
        const padding = options.padding ?? 24;
        clip = {
          x: Math.max(0, nodeBox.x - padding),
          y: Math.max(0, nodeBox.y - padding),
          width: nodeBox.width + padding * 2,
          height: nodeBox.height + padding * 2,
        };
      } else {
        const target = options.target;
        if (
          target.x < 0 ||
          target.y < 0 ||
          target.width <= 0 ||
          target.height <= 0 ||
          target.x + target.width > worldBox.width ||
          target.y + target.height > worldBox.height
        ) {
          throw new Error("region_outside_canvas: region must fit inside the canvas world");
        }
        clip = {
          x: worldBox.x + target.x,
          y: worldBox.y + target.y,
          width: target.width,
          height: target.height,
        };
      }

      // A padded node at the right/bottom edge may extend beyond the document's initial surface.
      const viewportWidth = Math.min(16_000, Math.max(1, Math.ceil(clip.x + clip.width)));
      const viewportHeight = Math.min(16_000, Math.max(1, Math.ceil(clip.y + clip.height)));
      await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
      await warmIframeSurfaces(page);
      const screenshot = await page.screenshot({ type: "png", clip });
      const image = sharp(screenshot).png({ compressionLevel: 9 });
      let metadata = await image.metadata();
      let width = metadata.width ?? 0;
      let height = metadata.height ?? 0;
      let bytes = await image.toBuffer();
      let downscaled = false;

      const dimensionRatio = Math.min(1, SNAPSHOT_MAX_DIMENSION / Math.max(width, height));
      if (dimensionRatio < 1) {
        width = Math.max(1, Math.floor(width * dimensionRatio));
        height = Math.max(1, Math.floor(height * dimensionRatio));
        bytes = await sharp(bytes).resize(width, height).png({ compressionLevel: 9 }).toBuffer();
        downscaled = true;
      }
      while (bytes.length > SNAPSHOT_MAX_BYTES && Math.min(width, height) > 64) {
        const ratio = Math.max(0.5, Math.sqrt(SNAPSHOT_MAX_BYTES / bytes.length) * 0.95);
        width = Math.max(1, Math.floor(width * ratio));
        height = Math.max(1, Math.floor(height * ratio));
        bytes = await sharp(bytes).resize(width, height).png({ compressionLevel: 9 }).toBuffer();
        downscaled = true;
      }
      if (bytes.length > SNAPSHOT_MAX_BYTES) {
        throw new Error("snapshot_too_large: PNG remains larger than 4 MiB after downscaling");
      }
      metadata = await sharp(bytes).metadata();
      await fs.writeFile(absOutputPath, bytes);
      return {
        path: absOutputPath,
        width: metadata.width ?? width,
        height: metadata.height ?? height,
        downscaled,
        contentOverflow,
        unresolvedRefs: unresolved.list(),
        unresolvedDetails: unresolved.details(),
        readiness,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    await fs.rm(tempHtmlPath, { force: true });
  }
}

export async function renderFile(options: RenderFileOptions): Promise<RenderFileResult> {
  const { format } = options;

  if (format === "svg") {
    // Playwright has no SVG output primitive: `page.screenshot()` only
    // emits raster formats (png/jpeg) and `page.pdf()` emits PDF. There is
    // no "export this HTML as SVG" operation to wrap. This is a real,
    // permanent gap for HTML entrypoints, not a TODO.
    //
    // Per PLAN.md section 3.2/8.3, SVG output *is* supported in this
    // system overall — but it comes from the D2 diagram renderer
    // (src/render/diagrams), which asks D2 to emit SVG directly from D2
    // source. The future MCP-server integration layer should route
    // `render_file({ format: "svg" })` to the D2 renderer when
    // `entrypoint` is a `.d2` file, and reject/](or pre-validate) the
    // combination of an `.html` entrypoint with `format: "svg"` before it
    // ever reaches this module. This function enforces that rejection.
    throw new Error(
      'renderFile: format "svg" is not supported for HTML entrypoints. ' +
        "Playwright can only rasterize (png) or print (pdf) a page — it has " +
        "no SVG export. For SVG output, render a .d2 entrypoint through the " +
        "D2 renderer (src/render/diagrams) instead, which emits SVG " +
        "natively from D2 source.",
    );
  }

  const absEntrypoint = path.resolve(options.entrypoint);
  const absOutputPath = path.resolve(options.outputPath);
  const ext = path.extname(absEntrypoint).toLowerCase();
  if (ext !== ".html" && ext !== ".htm") {
    throw new Error(
      `renderFile: entrypoint must be an .html/.htm file, got "${options.entrypoint}"`,
    );
  }

  await fs.mkdir(path.dirname(absOutputPath), { recursive: true });

  const entrypointDir = path.dirname(absEntrypoint);
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(options.workspaceRoot)
    : await inferWorkspaceRoot(absEntrypoint);

  const rawHtml = await fs.readFile(absEntrypoint, "utf8");
  const builtHtml = await buildHtmlWithTailwind(rawHtml, entrypointDir);

  if (format === "html") {
    await fs.writeFile(absOutputPath, builtHtml, "utf8");
    return {
      path: absOutputPath,
      unresolvedRefs: [],
      unresolvedDetails: [],
      readiness: { status: "ready", warnings: [] },
    };
  }

  // format is "png" or "pdf" from here on — both need a real browser.
  const browserResult = await renderWithBrowser(
    builtHtml,
    entrypointDir,
    workspaceRoot,
    absOutputPath,
    format,
    options,
  );

  return {
    path: absOutputPath,
    unresolvedRefs: browserResult.unresolvedRefs,
    unresolvedDetails: browserResult.unresolvedDetails,
    readiness: browserResult.readiness,
  };
}

async function buildHtmlWithTailwind(rawHtml: string, scanDir: string): Promise<string> {
  const block = findTailwindStyleBlock(rawHtml);
  if (!block) return rawHtml; // plain HTML/CSS, no Tailwind entry block — pass through
  const builtCss = await buildTailwindCss(block.rawCss, scanDir);
  return injectBuiltCss(rawHtml, block, builtCss);
}

async function renderWithBrowser(
  builtHtml: string,
  entrypointDir: string,
  workspaceRoot: string,
  absOutputPath: string,
  format: "png" | "pdf",
  options: RenderFileOptions,
): Promise<{
  unresolvedRefs: string[];
  unresolvedDetails: UnresolvedRefDetail[];
  readiness: { status: "ready" | "partial"; warnings: string[] };
}> {
  // Written next to the entrypoint (not in a temp dir elsewhere) so it
  // stays inside `workspaceRoot` and resolves the same way the original
  // entrypoint would under the routing policy in ./routing.ts.
  const tempHtmlPath = path.join(entrypointDir, `.rendered-${randomUUID()}.html`);
  await fs.writeFile(tempHtmlPath, builtHtml, "utf8");

  const browser = await chromium.launch({ headless: true });
  try {
    const viewport = {
      width: options.viewport?.width ?? DEFAULT_VIEWPORT_WIDTH,
      height: options.viewport?.height ?? DEFAULT_VIEWPORT_HEIGHT,
    };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: options.viewport?.deviceScaleFactor ?? 1,
      javaScriptEnabled: true,
    });
    try {
      const page = await context.newPage();
      const unresolved = await installLocalResourceRouting(page, workspaceRoot);
      const virtualPath = path
        .relative(workspaceRoot, tempHtmlPath)
        .split(path.sep)
        .map(encodeURIComponent)
        .join("/");
      await page.goto(`http://canvas.local/${virtualPath}${options.route ?? ""}`, {
        waitUntil: "networkidle",
      });
      const iframeCanvasFitsViewport = await expandViewportForIframeCanvas(page);
      await page.evaluate(() => document.fonts?.ready);
      const readiness = await waitForCanvasReadiness(page);
      await warmIframeSurfaces(page);

      if (format === "png") {
        const screenshot = await page.screenshot({
          type: "png",
          fullPage: !iframeCanvasFitsViewport,
        });
        const optimized = await sharp(screenshot).png({ compressionLevel: 9 }).toBuffer();
        await fs.writeFile(absOutputPath, optimized);
      } else {
        const pdf = options.pdf;
        const world = await page
          .locator(".vc-world")
          .first()
          .evaluate((element) => ({
            width: (element as HTMLElement).offsetWidth,
            height: (element as HTMLElement).offsetHeight,
          }))
          .catch(() => null);
        await page.pdf({
          path: absOutputPath,
          ...(world
            ? {
                width: `${world.width + 2}px`,
                height: `${world.height + 2}px`,
                preferCSSPageSize: true,
              }
            : { format: pdf?.format ?? "A4" }),
          // A CanvasDoc world already supplies its exact page geometry. Passing
          // landscape as well makes Chromium swap those explicit dimensions,
          // clipping wide canvases into a tall page.
          landscape: world ? false : pdf?.orientation === "landscape",
          printBackground: pdf?.printBackground ?? true,
          displayHeaderFooter: pdf?.displayHeaderFooter ?? false,
          headerTemplate: pdf?.headerTemplate,
          footerTemplate: pdf?.footerTemplate,
          margin: pdf?.margin,
        });
      }

      // Read after capture: `networkidle` + the settle timeout mean every
      // subresource the page was going to request has already been decided
      // by the route handler, including ones a late-running script added.
      return {
        unresolvedRefs: unresolved.list(),
        unresolvedDetails: unresolved.details(),
        readiness,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    await fs.rm(tempHtmlPath, { force: true });
  }
}

async function expandViewportForIframeCanvas(page: import("playwright").Page): Promise<boolean> {
  const dimensions = await page.evaluate(() => {
    if (!document.querySelector(".vc-kind-iframe")) return null;
    return {
      width: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)),
      height: Math.ceil(
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      ),
    };
  });
  if (!dimensions) return false;
  // Chromium can capture this canvas class in a single compositor surface;
  // keeping all iframe nodes inside that surface avoids blank OOPIF tiles.
  const width = Math.min(dimensions.width, 16_000);
  const height = Math.min(dimensions.height, 16_000);
  await page.setViewportSize({ width, height });
  return width === dimensions.width && height === dimensions.height;
}

/**
 * Chromium does not always allocate a compositor surface for an out-of-view
 * OOPIF before a full-page capture. Readiness alone proves the screen loaded,
 * but an iframe that has never intersected the viewport can still be captured
 * as a blank rectangle. Visit every iframe node and wait for two compositor
 * frames, then restore the world origin. This is deterministic and tied to
 * rendering progress rather than an arbitrary settle timeout.
 */
async function warmIframeSurfaces(page: import("playwright").Page): Promise<void> {
  await page.evaluate(async () => {
    for (const node of document.querySelectorAll<HTMLElement>(".vc-kind-iframe")) {
      if (!node.querySelector("iframe")) continue;
      node.scrollIntoView({ block: "center", inline: "center" });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function waitForCanvasReadiness(
  page: import("playwright").Page,
  timeoutMs = 15_000,
): Promise<{ status: "ready" | "partial"; warnings: string[] }> {
  const count = await page.locator(".vc-kind-iframe iframe").count();
  if (count === 0) return { status: "ready", warnings: [] };
  try {
    await page.waitForFunction(
      () => {
        const nodes = [...document.querySelectorAll<HTMLElement>(".vc-kind-iframe")].filter(
          (node) => node.querySelector("iframe"),
        );
        return (
          nodes.length > 0 &&
          nodes.every((node) =>
            ["ready", "partial", "failed"].includes(node.dataset.iframeReadiness ?? ""),
          )
        );
      },
      undefined,
      { timeout: timeoutMs },
    );
  } catch {
    const pending = await page
      .locator(".vc-kind-iframe:has(iframe):not([data-iframe-readiness])")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.nodeId ?? "unknown"),
      );
    throw new Error(`iframe readiness timeout: ${pending.join(", ")}`);
  }
  const states = await page.locator(".vc-kind-iframe:has(iframe)").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: (node as HTMLElement).dataset.nodeId ?? "unknown",
      state: (node as HTMLElement).dataset.iframeReadiness ?? "failed",
      detail: (node as HTMLElement).dataset.iframeReadinessDetail ?? "",
    })),
  );
  const bad = states
    .filter((state) => state.state !== "ready")
    .map((state) => `${state.id}: ${state.state}${state.detail ? ` (${state.detail})` : ""}`);
  if (states.some((state) => state.state === "failed"))
    throw new Error(`iframe readiness failed: ${bad.join("; ")}`);
  return { status: bad.length ? "partial" : "ready", warnings: bad };
}
