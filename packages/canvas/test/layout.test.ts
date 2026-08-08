import assert from "node:assert/strict";
import { test } from "node:test";
import { LayoutError, layoutCanvas } from "../src/layout.js";
import type { CanvasDoc } from "../src/types.js";

function fixture(): CanvasDoc {
  return {
    version: 1,
    title: "fixture",
    grid: { stageWidth: 1000, startX: 100 },
    lanes: [
      { id: "l1", label: "Lane 1", role: "primary", height: 200 },
      { id: "l2", label: "Lane 2", role: "secondary", height: 150 },
    ],
    stages: [
      { id: "s1", index: 0, label: "Stage 1" },
      { id: "s2", index: 1, label: "Stage 2" },
    ],
    nodes: [
      { id: "n1", lane: "l1", stage: "s1", shape: "note", caption: { title: "N1" } },
      { id: "n2", lane: "l1", stage: "s1", shape: "note", caption: { title: "N2" } },
      { id: "n3", lane: "l2", stage: "s2", shape: "actor", caption: { title: "N3" } },
    ],
    edges: [],
  };
}

test("layoutCanvas is deterministic for the same doc", () => {
  const a = layoutCanvas(fixture());
  const b = layoutCanvas(fixture());
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(a.lanes, b.lanes);
  assert.deepEqual(a.stages, b.stages);
});

test("stages are positioned left-to-right using grid.startX/stageWidth", () => {
  const canvas = layoutCanvas(fixture());
  assert.equal(canvas.stages[0]?.x, 100);
  assert.equal(canvas.stages[1]?.x, 1100);
});

test("lanes stack vertically in declaration order with no gap", () => {
  const canvas = layoutCanvas(fixture());
  assert.equal(canvas.lanes[0]?.y, 0);
  assert.equal(canvas.lanes[1]?.y, 200);
});

test("nodes without an explicit slot are placed in insertion order within their cell", () => {
  const canvas = layoutCanvas(fixture());
  const n1 = canvas.nodes.find((n) => n.id === "n1");
  const n2 = canvas.nodes.find((n) => n.id === "n2");
  assert.ok(n1 && n2);
  assert.ok(n2.x > n1.x, "second node in the same lane+stage cell should sit to the right");
});

test("throws LayoutError for a node referencing an unknown lane", () => {
  const doc = fixture();
  doc.nodes.push({
    id: "bad",
    lane: "missing",
    stage: "s1",
    shape: "note",
    caption: { title: "x" },
  });
  assert.throws(() => layoutCanvas(doc), LayoutError);
});

test("throws LayoutError for a node referencing an unknown stage", () => {
  const doc = fixture();
  doc.nodes.push({
    id: "bad",
    lane: "l1",
    stage: "missing",
    shape: "note",
    caption: { title: "x" },
  });
  assert.throws(() => layoutCanvas(doc), LayoutError);
});
