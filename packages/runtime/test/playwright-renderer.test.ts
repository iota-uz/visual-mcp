/**
 * Tests for src/render/playwright-renderer (PLAN.md sections 5, 8.1, 8.2,
 * 6.4, 9).
 *
 * Test runner: node:test + node:assert/strict (see package.json "test").
 * Each test builds its own throwaway fixture directory and cleans it up
 * afterwards. Fixture dirs are created *inside the repo* (under
 * `sessions/.test-tmp/`, matching the real session-workspace convention —
 * "sessions/<session_id>/..." relative to repo root, PLAN.md section 7)
 * rather than under the OS temp dir: Tailwind v4's `@import "tailwindcss"`
 * resolution walks up node_modules starting from the input CSS file's own
 * directory (bundler-style resolution), so the fixture must live somewhere
 * that has this repo's node_modules in its ancestry for the Tailwind build
 * step to find the `tailwindcss` package at all.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";
import { findTailwindStyleBlock, injectBuiltCss } from "../src/render/playwright-renderer/html.js";
import {
  buildTailwindCss,
  installLocalResourceRouting,
  renderFile,
} from "../src/render/playwright-renderer/index.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_TMP_ROOT = path.join(REPO_ROOT, "sessions", ".test-tmp");

async function mkFixtureDir(prefix: string): Promise<string> {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  return fs.mkdtemp(path.join(TEST_TMP_ROOT, prefix));
}

/* ------------------------------------------------------------------------
 * (a) plain HTML + Tailwind class -> PNG produced, non-empty, valid magic
 * ---------------------------------------------------------------------- */

test("renderFile: HTML+Tailwind entrypoint renders to a valid, non-empty PNG", async () => {
  const dir = await mkFixtureDir("pw-renderer-png-");
  try {
    const srcDir = path.join(dir, "src");
    const outputDir = path.join(dir, "output");
    await fs.mkdir(srcDir, { recursive: true });

    const entrypoint = path.join(srcDir, "mockup.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html>
<html>
  <head>
    <style>
      @import "tailwindcss";
      @theme {
        --color-brand: #2563eb;
      }
    </style>
  </head>
  <body class="m-0 bg-slate-100 font-sans">
    <main class="w-[600px] h-[400px] p-16">
      <section class="rounded-3xl bg-white p-10 shadow-xl">
        <h1 class="text-4xl font-bold text-brand">Hello Tailwind</h1>
      </section>
    </main>
  </body>
</html>`,
      "utf8",
    );

    const outputPath = path.join(outputDir, "mockup.png");
    const result = await renderFile({
      entrypoint,
      outputPath,
      format: "png",
      viewport: { width: 600, height: 400 },
    });

    assert.equal(result.path, outputPath);
    const bytes = await fs.readFile(outputPath);
    assert.ok(bytes.length > 0, "PNG output should be non-empty");
    assert.deepEqual(
      bytes.subarray(0, 8),
      PNG_MAGIC,
      "output should start with the PNG magic byte sequence",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------
 * (b) multipage HTML (break-after: page) -> multipage PDF
 * ---------------------------------------------------------------------- */

test("renderFile: multipage HTML with break-after:page sections renders a multipage PDF", async () => {
  const dir = await mkFixtureDir("pw-renderer-pdf-");
  try {
    const srcDir = path.join(dir, "src");
    const outputDir = path.join(dir, "output");
    await fs.mkdir(srcDir, { recursive: true });

    const entrypoint = path.join(srcDir, "report.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html>
<html>
  <head>
    <style>@import "tailwindcss";</style>
  </head>
  <body class="font-sans">
    <section class="p-16" style="break-after: page;">
      <h1 class="text-3xl font-bold">Page One</h1>
    </section>
    <section class="p-16" style="break-after: page;">
      <h1 class="text-3xl font-bold">Page Two</h1>
    </section>
    <section class="p-16">
      <h1 class="text-3xl font-bold">Page Three</h1>
    </section>
  </body>
</html>`,
      "utf8",
    );

    const outputPath = path.join(outputDir, "report.pdf");
    const result = await renderFile({
      entrypoint,
      outputPath,
      format: "pdf",
      pdf: { format: "A4", orientation: "portrait", printBackground: true },
    });

    assert.equal(result.path, outputPath);
    const bytes = await fs.readFile(outputPath);
    assert.ok(bytes.length > 0, "PDF output should be non-empty");
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-", "should have a valid PDF header");

    const pdfDoc = await PDFDocument.load(bytes);
    assert.equal(
      pdfDoc.getPageCount(),
      3,
      "three break-after:page sections should paginate into three PDF pages",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------
 * (c) local workspace assets still resolve via root-relative paths
 *
 * Network sandboxing was intentionally removed from this module (remote
 * requests now hit the real network via route.continue() instead of being
 * aborted) — that path is no longer asserted here, since asserting a real
 * outbound fetch's success would make this test depend on network
 * reachability from the test environment. Local file:// asset routing is
 * unrelated to network access and still fully covered below.
 * ---------------------------------------------------------------------- */

test("installLocalResourceRouting: serves local workspace assets via root-relative paths", async () => {
  const dir = await mkFixtureDir("pw-renderer-routing-");
  try {
    const assetsDir = path.join(dir, "assets");
    const srcDir = path.join(dir, "src");
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(
      path.join(assetsDir, "marker.js"),
      "window.__localAssetLoaded = true;",
      "utf8",
    );

    const entrypoint = path.join(srcDir, "asset-routing-test.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html>
<html>
  <head>
    <script src="/assets/marker.js"></script>
  </head>
  <body></body>
</html>`,
      "utf8",
    );

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await installLocalResourceRouting(page, dir);

      const { pathToFileURL } = await import("node:url");
      await page.goto(pathToFileURL(entrypoint).href, { waitUntil: "load" });

      const localAssetLoaded = await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__localAssetLoaded,
      );

      assert.equal(
        localAssetLoaded,
        true,
        "root-relative /assets/... request should resolve to the workspace's assets/ dir",
      );
    } finally {
      await browser.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------------
 * Focused unit coverage for the smaller building blocks
 * ---------------------------------------------------------------------- */

test("findTailwindStyleBlock + injectBuiltCss round-trip", () => {
  const html = `<html><head><style>@import "tailwindcss";\n@theme { --color-brand: #111; }</style></head><body class="bg-brand"></body></html>`;
  const block = findTailwindStyleBlock(html);
  assert.ok(block, "should find the tailwind style block");
  const injected = injectBuiltCss(html, block!, ".bg-brand { background-color: #111; }");
  assert.ok(injected.includes(".bg-brand { background-color: #111; }"));
  assert.ok(!injected.includes('@import "tailwindcss"'));
});

test("findTailwindStyleBlock returns null for plain HTML with no tailwind import", () => {
  const html = `<html><head><style>body { color: red; }</style></head><body></body></html>`;
  assert.equal(findTailwindStyleBlock(html), null);
});

test("buildTailwindCss compiles real utility classes referenced by a scanned HTML file", async () => {
  const dir = await mkFixtureDir("pw-renderer-tw-unit-");
  try {
    await fs.writeFile(
      path.join(dir, "page.html"),
      `<div class="bg-slate-100 text-brand"></div>`,
      "utf8",
    );
    const built = await buildTailwindCss(
      `@import "tailwindcss";\n@theme { --color-brand: #2563eb; }`,
      dir,
    );
    assert.match(built, /bg-slate-100/);
    assert.match(built, /text-brand/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
