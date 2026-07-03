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

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

import type { PdfOptions, RenderFormat, ViewportOptions } from "../../types.js";
import { buildTailwindCss } from "./tailwind.js";
import { findTailwindStyleBlock, injectBuiltCss } from "./html.js";
import { inferWorkspaceRoot, installLocalResourceRouting } from "./routing.js";

export { inferWorkspaceRoot, installLocalResourceRouting } from "./routing.js";
export { buildTailwindCss } from "./tailwind.js";

export interface RenderFileOptions {
  /** Absolute path to the HTML source file to render. */
  entrypoint: string;
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
}

const DEFAULT_VIEWPORT_WIDTH = 1200;
const DEFAULT_VIEWPORT_HEIGHT = 800;

/** Settle time after navigation for client-side rendering (ApexCharts render()/animations) to finish before capture. */
const RENDER_SETTLE_MS = 300;

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
    return { path: absOutputPath };
  }

  // format is "png" or "pdf" from here on — both need a real browser.
  await renderWithBrowser(builtHtml, entrypointDir, workspaceRoot, absOutputPath, format, options);

  return { path: absOutputPath };
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
): Promise<void> {
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
      await installLocalResourceRouting(page, workspaceRoot);
      await page.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: "networkidle" });
      await page.waitForTimeout(RENDER_SETTLE_MS);

      if (format === "png") {
        const screenshot = await page.screenshot({ type: "png", fullPage: true });
        const optimized = await sharp(screenshot).png({ compressionLevel: 9 }).toBuffer();
        await fs.writeFile(absOutputPath, optimized);
      } else {
        const pdf = options.pdf;
        await page.pdf({
          path: absOutputPath,
          format: pdf?.format ?? "A4",
          landscape: pdf?.orientation === "landscape",
          printBackground: pdf?.printBackground ?? true,
          displayHeaderFooter: pdf?.displayHeaderFooter ?? false,
          headerTemplate: pdf?.headerTemplate,
          footerTemplate: pdf?.footerTemplate,
          margin: pdf?.margin,
        });
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    await fs.rm(tempHtmlPath, { force: true });
  }
}
