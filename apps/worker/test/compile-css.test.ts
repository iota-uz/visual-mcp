/**
 * Tests for the worker's /compile-css logic (src/compile-css.ts) — the
 * Tailwind build step for canvas-node HTML (PLAN.md section 2), which has
 * no single entrypoint file for renderFile's own inline Tailwind step to
 * run against.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { handleCompileCss } from "../src/compile-css.js";

test("handleCompileCss: resolves real utility CSS for classes used across fragments", async () => {
  const result = await handleCompileCss({
    htmlFragments: [
      '<style>@import "tailwindcss";</style><div class="bg-slate-100 p-4">a</div>',
      '<div class="text-5xl font-bold">b</div>',
    ],
  });

  assert.ok(result.css.includes(".bg-slate-100"), "expected the first fragment's class compiled");
  assert.ok(result.css.includes(".text-5xl"), "expected the second fragment's class compiled");
});

test("handleCompileCss: an empty fragment list compiles nothing", async () => {
  const result = await handleCompileCss({ htmlFragments: [] });
  assert.equal(result.css, "");
});

test("handleCompileCss: falls back to a bare import when no fragment declares @theme", async () => {
  const result = await handleCompileCss({
    htmlFragments: ['<div class="p-2">no style block here</div>'],
  });
  assert.ok(result.css.includes(".p-2"), "expected utilities to compile without an explicit block");
});
