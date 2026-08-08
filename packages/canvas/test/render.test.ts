import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCanvas } from "../src/layout.js";
import { escapeHtml, renderCanvas } from "../src/render.js";
import type { CanvasDoc } from "../src/types.js";

test("escapeHtml neutralizes markup-significant characters", () => {
  assert.equal(
    escapeHtml(`<b>"it's"</b> & more`),
    "&lt;b&gt;&quot;it&#39;s&quot;&lt;/b&gt; &amp; more",
  );
});

test("plain-text fields (caption title) are escaped, not injected as markup", () => {
  const doc: CanvasDoc = {
    version: 1,
    title: "t",
    lanes: [{ id: "l1", label: "L1", role: "primary", height: 200 }],
    stages: [{ id: "s1", index: 0, label: "S1" }],
    nodes: [
      {
        id: "n1",
        lane: "l1",
        stage: "s1",
        shape: "note",
        caption: { title: "<img src=x onerror=alert(1)>" },
      },
    ],
    edges: [],
  };
  const { html } = renderCanvas(layoutCanvas(doc));
  assert.ok(
    !html.includes("<img src=x"),
    "raw markup from a plain-text field must not appear unescaped",
  );
  assert.ok(html.includes("&lt;img"));
});

test("renderCanvas produces one .vc-node per doc node and one path per edge", () => {
  const doc: CanvasDoc = {
    version: 1,
    title: "t",
    lanes: [{ id: "l1", label: "L1", role: "primary", height: 200 }],
    stages: [
      { id: "s1", index: 0, label: "S1" },
      { id: "s2", index: 1, label: "S2" },
    ],
    nodes: [
      { id: "n1", lane: "l1", stage: "s1", shape: "note", caption: { title: "A" } },
      { id: "n2", lane: "l1", stage: "s2", shape: "note", caption: { title: "B" } },
    ],
    edges: [{ from: "n1", to: "n2", kind: "main" }],
  };
  const { html } = renderCanvas(layoutCanvas(doc));
  assert.equal((html.match(/class="vc-node /g) ?? []).length, 2);
  assert.equal((html.match(/<g class="vc-edge /g) ?? []).length, 1);
});
