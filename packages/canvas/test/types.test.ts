/**
 * Tests for the CanvasDoc invariant (PLAN.md section 2): node HTML is
 * rendered on the app origin, not a sandboxed iframe, so unsafe content must
 * be rejected loudly on write rather than silently stripped.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasDocSchema, findUnsafeHtml } from "../src/types.js";

function baseDoc() {
  return {
    version: 1 as const,
    title: "t",
    lanes: [{ id: "l1", label: "L1", role: "primary", height: 200 }],
    stages: [{ id: "s1", index: 0, label: "S1" }],
    nodes: [] as unknown[],
    edges: [] as unknown[],
  };
}

test("findUnsafeHtml is clean for plain markup", () => {
  assert.deepEqual(findUnsafeHtml('<div class="card"><b>hi</b></div>'), []);
});

test("findUnsafeHtml flags <script>", () => {
  assert.ok(findUnsafeHtml("<script>alert(1)</script>").length > 0);
});

test("findUnsafeHtml flags inline event handlers", () => {
  assert.ok(findUnsafeHtml('<div onclick="doIt()">x</div>').length > 0);
});

test("findUnsafeHtml flags javascript: URLs", () => {
  assert.ok(findUnsafeHtml('<a href="javascript:alert(1)">x</a>').length > 0);
});

test("findUnsafeHtml flags <iframe> and <object>", () => {
  assert.ok(findUnsafeHtml('<iframe src="//evil"></iframe>').length > 0);
  assert.ok(findUnsafeHtml('<object data="evil.swf"></object>').length > 0);
});

test("CanvasDocSchema rejects a node with <script> content", () => {
  const doc = {
    ...baseDoc(),
    nodes: [
      {
        id: "n1",
        lane: "l1",
        stage: "s1",
        shape: "note",
        caption: { title: "n" },
        content: { type: "html", html: "<script>alert(1)</script>" },
      },
    ],
  };
  const result = CanvasDocSchema.safeParse(doc);
  assert.equal(result.success, false);
});

test("CanvasDocSchema accepts safe static HTML content", () => {
  const doc = {
    ...baseDoc(),
    nodes: [
      {
        id: "n1",
        lane: "l1",
        stage: "s1",
        shape: "note",
        caption: { title: "n" },
        content: { type: "html", html: "<div><b>safe</b></div>" },
      },
    ],
  };
  const result = CanvasDocSchema.safeParse(doc);
  assert.equal(result.success, true);
});

test("CanvasDocSchema rejects an unknown lane role", () => {
  const doc = baseDoc();
  doc.lanes[0].role = "not-a-role";
  const result = CanvasDocSchema.safeParse(doc);
  assert.equal(result.success, false);
});
