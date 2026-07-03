/**
 * Smoke test for the shared types/schemas module and the test runner setup.
 *
 * Test runner: Node's built-in `node:test` + `node:assert`, run via
 * `node --import tsx --test test/**\/*.test.ts` (see package.json "test"
 * script). No extra test-framework dependency — `tsx` is a dev dep only to
 * let `node --test` load `.ts` files directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CreateVisualSessionInputSchema,
  RenderFileInputSchema,
  ListTemplatesInputSchema,
} from "../src/types.js";

test("CreateVisualSessionInputSchema accepts a minimal valid input", () => {
  const parsed = CreateVisualSessionInputSchema.parse({ runtime: "node" });
  assert.equal(parsed.runtime, "node");
});

test("CreateVisualSessionInputSchema rejects an invalid runtime", () => {
  assert.throws(() =>
    CreateVisualSessionInputSchema.parse({ runtime: "python" }),
  );
});

test("RenderFileInputSchema accepts pdf options per PLAN.md section 6.4", () => {
  const parsed = RenderFileInputSchema.parse({
    session_id: "sess_123",
    entrypoint: "/src/report.html",
    output_path: "/output/report.pdf",
    format: "pdf",
    pdf: { format: "A4", orientation: "portrait", printBackground: true },
  });
  assert.equal(parsed.format, "pdf");
  assert.equal(parsed.pdf?.format, "A4");
});

test("ListTemplatesInputSchema allows an empty (kind-less) input", () => {
  const parsed = ListTemplatesInputSchema.parse({});
  assert.equal(parsed.kind, undefined);
});
