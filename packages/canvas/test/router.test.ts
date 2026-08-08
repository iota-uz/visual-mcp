import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCanvas } from "../src/layout.js";
import { RouterError, routeEdges } from "../src/router.js";
import type { CanvasDoc } from "../src/types.js";

function fixture(): CanvasDoc {
  return {
    version: 1,
    title: "fixture",
    grid: { stageWidth: 1000, startX: 100 },
    lanes: [
      { id: "l1", label: "Lane 1", role: "primary", height: 200 },
      { id: "l2", label: "Lane 2", role: "secondary", height: 200 },
    ],
    stages: [
      { id: "s1", index: 0, label: "Stage 1" },
      { id: "s2", index: 1, label: "Stage 2" },
      { id: "s3", index: 2, label: "Stage 3" },
      { id: "s4", index: 3, label: "Stage 4" },
    ],
    nodes: [
      { id: "a", lane: "l1", stage: "s1", shape: "note", caption: { title: "A" } },
      { id: "b", lane: "l1", stage: "s2", shape: "note", caption: { title: "B" } },
      { id: "c", lane: "l2", stage: "s1", shape: "note", caption: { title: "C" } },
      { id: "d", lane: "l2", stage: "s2", shape: "note", caption: { title: "D" } },
      { id: "e", lane: "l2", stage: "s4", shape: "note", caption: { title: "E" } },
    ],
    edges: [],
  };
}

function routeOf(
  doc: CanvasDoc,
  from: string,
  to: string,
  extra: Partial<CanvasDoc["edges"][number]> = {},
) {
  doc.edges.push({ from, to, kind: "main", ...extra });
  const canvas = layoutCanvas(doc);
  const [path] = routeEdges(canvas);
  return path;
}

test("same lane, different stage -> horizontal", () => {
  const path = routeOf(fixture(), "a", "b");
  assert.equal(path?.route, "horizontal");
});

test("same stage, different lane -> vertical", () => {
  const path = routeOf(fixture(), "a", "c");
  assert.equal(path?.route, "vertical");
});

test("adjacent stage, different lane -> orthogonal", () => {
  const path = routeOf(fixture(), "a", "d");
  assert.equal(path?.route, "orthogonal");
});

test("far stage, different lane -> gutter", () => {
  const path = routeOf(fixture(), "a", "e");
  assert.equal(path?.route, "gutter");
});

test("explicit route overrides the auto choice", () => {
  const path = routeOf(fixture(), "a", "b", { route: "orthogonal" });
  assert.equal(path?.route, "orthogonal");
});

test("routeEdges is deterministic for the same canvas", () => {
  const doc = fixture();
  doc.edges.push({ from: "a", to: "e", kind: "main" });
  const canvas = layoutCanvas(doc);
  assert.deepEqual(routeEdges(canvas), routeEdges(canvas));
});

test("throws RouterError for an edge referencing an unknown node", () => {
  const doc = fixture();
  doc.edges.push({ from: "a", to: "missing", kind: "main" });
  const canvas = layoutCanvas(doc);
  assert.throws(() => routeEdges(canvas), RouterError);
});
