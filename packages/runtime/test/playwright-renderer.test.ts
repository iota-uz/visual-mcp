/**
 * Tests for src/render/playwright-renderer (PLAN.md sections 5, 8.1, 8.2,
 * 6.4, 9).
 *
 * Test runner: node:test + node:assert/strict (see package.json "test").
 * Each test builds its own throwaway fixture directory and cleans it up
 * afterwards. Fixture dirs are created *inside the repo* (under
 * `sessions/.test-tmp/`, matching the real session-workspace convention —
 * "sessions/<session_id>/..." relative to repo root, PLAN.md section 7).
 * This used to matter for a real reason (Tailwind's `@import "tailwindcss"`
 * resolution walking up node_modules from the input CSS file's own
 * directory needed the repo's node_modules in its ancestry) — that
 * dependency masked a production bug (see `buildTailwindCss`'s
 * `ensureTailwindResolvable`: `apps/worker`'s real `hydrate()` workspaces
 * live under `os.tmpdir()`, with no such ancestry, so every test here
 * passed while the real render path silently failed). The dedicated
 * "resolves against a bare OS-tmp directory" test below is the regression
 * test for that; this suite still nests fixtures under the repo for
 * convenience, not because it's required anymore.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright";
import sharp from "sharp";
import { findTailwindStyleBlock, injectBuiltCss } from "../src/render/playwright-renderer/html.js";
import {
  buildTailwindCss,
  installLocalResourceRouting,
  renderFile,
  snapshotCanvas,
} from "../src/render/playwright-renderer/index.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_TMP_ROOT = path.join(REPO_ROOT, "sessions", ".test-tmp");

async function mkFixtureDir(prefix: string): Promise<string> {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  return fs.mkdtemp(path.join(TEST_TMP_ROOT, prefix));
}

test("snapshotCanvas captures one node with padding at the requested scale", async () => {
  const dir = await mkFixtureDir("pw-snapshot-node-");
  try {
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const entrypoint = path.join(srcDir, "canvas.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html><style>html,body{margin:0}.vc-world{position:relative;width:600px;height:400px;background:#eee}.vc-node{position:absolute;left:100px;top:80px;width:200px;height:120px;background:#e11d48;box-shadow:0 8px 20px #0008}</style><div class="vc-world"><div class="vc-node" data-node-id="phone/mockup"></div></div>`,
      "utf8",
    );
    const outputPath = path.join(dir, "output", "node.png");
    const result = await snapshotCanvas({
      entrypoint,
      outputPath,
      workspaceRoot: dir,
      target: { type: "node", nodeId: "phone/mockup" },
      padding: 20,
      scale: 2,
    });
    assert.equal(result.width, 480);
    assert.equal(result.height, 320);
    assert.equal(result.downscaled, false);
    assert.deepEqual((await fs.readFile(outputPath)).subarray(0, 8), PNG_MAGIC);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("snapshotCanvas captures exact world-coordinate regions and rejects outside regions", async () => {
  const dir = await mkFixtureDir("pw-snapshot-region-");
  try {
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const entrypoint = path.join(srcDir, "canvas.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html><style>html,body{margin:0}.vc-world{width:500px;height:300px;background:#2563eb}</style><div class="vc-world"></div>`,
      "utf8",
    );
    const outputPath = path.join(dir, "output", "region.png");
    const result = await snapshotCanvas({
      entrypoint,
      outputPath,
      workspaceRoot: dir,
      target: { type: "region", x: 30, y: 40, width: 90, height: 70 },
    });
    assert.deepEqual([result.width, result.height], [90, 70]);
    await assert.rejects(
      snapshotCanvas({
        entrypoint,
        outputPath,
        workspaceRoot: dir,
        target: { type: "region", x: 450, y: 0, width: 100, height: 50 },
      }),
      /region_outside_canvas/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("snapshotCanvas captures a valid lower region of a world taller than the compositor surface", async () => {
  const dir = await mkFixtureDir("pw-snapshot-tall-region-");
  try {
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const entrypoint = path.join(srcDir, "canvas.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html><style>html,body{margin:0}.vc-world{position:relative;width:16080px;height:27600px;background:white}.vc-node{position:absolute;left:1600px;top:120px;width:1440px;height:27300px}.vc-node iframe{display:block;width:100%;height:100%;border:0}</style><div class="vc-world"><div class="vc-node vc-kind-iframe" data-node-id="long-screen" data-iframe-readiness="ready"><iframe srcdoc="<style>html,body{margin:0;height:27300px}.marker{position:absolute;left:0;top:25680px;width:1440px;height:1540px;background:#ef4444}</style><div class='marker'></div>"></iframe></div></div>`,
      "utf8",
    );
    const outputPath = path.join(dir, "output", "lower-region.png");
    const result = await snapshotCanvas({
      entrypoint,
      outputPath,
      workspaceRoot: dir,
      target: { type: "region", x: 1600, y: 25800, width: 1440, height: 1540 },
    });
    assert.deepEqual([result.width, result.height], [1440, 1540]);
    const pixel = await sharp(await fs.readFile(outputPath))
      .extract({ left: 20, top: 20, width: 1, height: 1 })
      .raw()
      .toBuffer();
    assert.ok(
      pixel[0] && pixel[0] > 200 && (pixel[1] ?? 255) < 100 && (pixel[2] ?? 255) < 100,
      "the translated lower-region iframe marker should be captured",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

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

test("renderFile: CanvasDoc PDF keeps exact world orientation", async () => {
  const dir = await mkFixtureDir("pw-canvas-pdf-");
  try {
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const entrypoint = path.join(srcDir, "canvas.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html><style>html,body{margin:0}.vc-world{width:1200px;height:500px;background:#fff}</style><div class="vc-world"></div>`,
      "utf8",
    );

    const outputPath = path.join(dir, "output", "canvas.pdf");
    await renderFile({
      entrypoint,
      outputPath,
      format: "pdf",
      pdf: { orientation: "landscape", printBackground: true },
    });

    const document = await PDFDocument.load(await fs.readFile(outputPath));
    const page = document.getPage(0);
    assert.ok(page.getWidth() > page.getHeight(), "wide CanvasDoc must produce a wide PDF page");
    assert.ok(Math.abs(page.getWidth() / page.getHeight() - 1202 / 502) < 0.02);
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
 * Unresolved-reference reporting: a page whose assets are missing renders
 * anyway (Chromium draws a broken image), so the *only* signal is the list
 * routing.ts collects. Regression test for canvases that shipped with
 * `<img src="./accident-1.jpg">` and no such file, and rendered "fine".
 * ---------------------------------------------------------------------- */

test("renderFile: reports missing subresources in unresolvedRefs without failing the render", async () => {
  const dir = await mkFixtureDir("pw-renderer-unresolved-");
  try {
    const srcDir = path.join(dir, "src");
    const assetsDir = path.join(dir, "assets");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(assetsDir, { recursive: true });

    // One asset that exists (must NOT be reported) and two that don't.
    await fs.writeFile(
      path.join(assetsDir, "present.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>`,
      "utf8",
    );

    const entrypoint = path.join(srcDir, "broken-refs.html");
    await fs.writeFile(
      entrypoint,
      `<!doctype html>
<html>
  <head><style>body { background: url("./myid-face-camera-v1.png"); }</style></head>
  <body>
    <img src="/assets/present.svg">
    <img src="./accident-1.jpg">
    <img src="./accident-1.jpg">
  </body>
</html>`,
      "utf8",
    );

    const outputPath = path.join(dir, "output", "broken-refs.png");
    const result = await renderFile({ entrypoint, outputPath, format: "png" });

    assert.deepEqual(
      [...result.unresolvedRefs].sort(),
      ["/src/accident-1.jpg", "/src/myid-face-camera-v1.png"],
      "missing refs should be workspace-relative and de-duplicated; the present asset absent",
    );
    assert.deepEqual(
      result.unresolvedDetails
        .map(({ ref, resourceType, reason }) => ({ ref, resourceType, reason }))
        .sort((left, right) => left.ref.localeCompare(right.ref)),
      [
        {
          ref: "/src/accident-1.jpg",
          resourceType: "image",
          reason: "missing_local_file",
        },
        {
          ref: "/src/myid-face-camera-v1.png",
          resourceType: "image",
          reason: "missing_local_file",
        },
      ],
      "structured diagnostics should name the resource kind and failure reason",
    );
    // Non-fatal: the PNG was still written.
    const bytes = await fs.readFile(result.path);
    assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("renderFile: unresolvedRefs is empty when nothing is missing", async () => {
  const dir = await mkFixtureDir("pw-renderer-resolved-");
  try {
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const entrypoint = path.join(srcDir, "clean.html");
    await fs.writeFile(entrypoint, `<!doctype html><html><body><h1>ok</h1></body></html>`, "utf8");

    const result = await renderFile({
      entrypoint,
      outputPath: path.join(dir, "output", "clean.png"),
      format: "png",
    });

    assert.deepEqual(result.unresolvedRefs, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("renderFile: waits for deterministic iframe readiness before capture", async () => {
  const dir = await mkFixtureDir("pw-ready-");
  try {
    await fs.mkdir(path.join(dir, "src", "screens"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src", "screens", "runtime.html"),
      `<script>setTimeout(()=>parent.postMessage({type:'visual-canvas:readiness',state:'ready'},'*'),120)</script><h1>loaded</h1>`,
    );
    const entrypoint = path.join(dir, "src", "canvas.html");
    await fs.writeFile(
      entrypoint,
      `<div class="vc-kind-iframe" data-node-id="screen"><iframe sandbox="allow-scripts" src="/src/screens/runtime.html"></iframe></div><script>addEventListener('message',e=>{for(const f of document.querySelectorAll('iframe'))if(f.contentWindow===e.source)f.closest('.vc-kind-iframe').dataset.iframeReadiness=e.data.state})</script>`,
    );
    const result = await renderFile({
      entrypoint,
      outputPath: path.join(dir, "output", "ready.png"),
      format: "png",
      workspaceRoot: dir,
    });
    assert.deepEqual(result.readiness, { status: "ready", warnings: [] });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("renderFile: paints iframe content that starts outside the viewport", async () => {
  const dir = await mkFixtureDir("pw-offscreen-iframe-");
  try {
    await fs.mkdir(path.join(dir, "src", "screens"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src", "screens", "runtime.html"),
      `<style>html,body{margin:0;width:100%;height:100%;background:#e11d48}</style><script>parent.postMessage({type:'visual-canvas:readiness',state:'ready'},'*')</script>`,
    );
    const entrypoint = path.join(dir, "src", "canvas.html");
    await fs.writeFile(
      entrypoint,
      `<style>html,body{margin:0;width:4000px;height:600px}.vc-kind-iframe{position:absolute;left:3500px;top:100px;width:300px;height:300px}.vc-kind-iframe iframe{width:100%;height:100%;border:0}</style><script>addEventListener('message',e=>{for(const f of document.querySelectorAll('iframe'))if(f.contentWindow===e.source)f.closest('.vc-kind-iframe').dataset.iframeReadiness=e.data.state})</script><div class="vc-kind-iframe" data-node-id="offscreen"><iframe sandbox="allow-scripts" src="/src/screens/runtime.html"></iframe></div>`,
    );
    const result = await renderFile({
      entrypoint,
      outputPath: path.join(dir, "output", "offscreen.png"),
      format: "png",
      workspaceRoot: dir,
      viewport: { width: 800, height: 600 },
    });
    const pixels = await sharp(result.path)
      .extract({ left: 3500, top: 100, width: 300, height: 300 })
      .raw()
      .toBuffer();
    let redPixels = 0;
    for (let index = 0; index < pixels.length; index += 3)
      if (pixels[index] > 180 && pixels[index + 1] < 80) redPixels += 1;
    assert.ok(redPixels > 80_000, `offscreen iframe painted only ${redPixels} red pixels`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("renderFile: never-ready iframe fails with its node id", async () => {
  const dir = await mkFixtureDir("pw-never-ready-");
  try {
    await fs.mkdir(path.join(dir, "src", "screens"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "screens", "runtime.html"), `<h1>never signals</h1>`);
    const entrypoint = path.join(dir, "src", "canvas.html");
    await fs.writeFile(
      entrypoint,
      `<div class="vc-kind-iframe" data-node-id="missing-ready"><iframe sandbox="allow-scripts" src="/src/screens/runtime.html"></iframe></div>`,
    );
    await assert.rejects(
      () =>
        renderFile({
          entrypoint,
          outputPath: path.join(dir, "output", "never.png"),
          format: "png",
          workspaceRoot: dir,
        }),
      /iframe readiness timeout: missing-ready/,
    );
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

test("buildTailwindCss resolves 'tailwindcss' against a bare OS-tmp directory, no repo ancestry", async () => {
  // Regression test: apps/worker's real hydrate() workspaces are exactly
  // this shape (os.tmpdir()-rooted, no node_modules anywhere above them) —
  // this used to throw "Can't resolve 'tailwindcss'" before
  // ensureTailwindResolvable existed.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-tw-bare-"));
  try {
    await fs.writeFile(path.join(dir, "page.html"), `<div class="p-4"></div>`, "utf8");
    const built = await buildTailwindCss('@import "tailwindcss";', dir);
    assert.match(built, /\.p-4/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
