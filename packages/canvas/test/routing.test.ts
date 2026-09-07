import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCanvas } from "../src/layout.js";
import { routeEdges } from "../src/router.js";
import { clear, crosses, intersects, pointAt } from "../src/routing/geometry.js";
import { orthogonal } from "../src/routing/orthogonal.js";
import {
  type AnchorSide,
  type CanvasDoc,
  CanvasDocSchema,
  type CanvasEdge,
  CanvasEdgeSchema,
  type CanvasNode,
} from "../src/types.js";

const sides: AnchorSide[] = ["top", "right", "bottom", "left"];
const node = (id: string, x: number, y: number, w = 100, h = 100): CanvasNode => ({
  id,
  kind: "native",
  shape: "card",
  rect: { x, y, w, h },
  caption: { title: id },
  anchors: sides.map((side) => ({ id: side, side, offset: 0.5 })),
});
const edge = (source: CanvasEdge["source"], target: CanvasEdge["target"]): CanvasEdge => ({
  id: "link",
  source,
  target,
  kind: "main",
  route: { type: "orthogonal" },
});
const doc = (nodes: CanvasNode[], edges: CanvasEdge[]): CanvasDoc => ({
  version: 2,
  title: "Routing",
  world: { width: 1400, height: 1200 },
  nodes,
  edges,
  lanes: [],
  stages: [],
  groups: [],
  labels: [],
  drawings: [],
  notes: [],
});

test("automatic and normalized ports need no authored anchors; ambiguous ports fail validation", () => {
  const a = node("a", 100, 100),
    b = node("b", 240, 100);
  a.anchors = [];
  b.anchors = [];
  const document = CanvasDocSchema.parse(doc([a, b], [edge({ nodeId: "a" }, { nodeId: "b" })]));
  assert.deepEqual(routeEdges(layoutCanvas(document))[0]!.points, [
    { x: 200, y: 150 },
    { x: 240, y: 150 },
  ]);
  assert.equal(
    CanvasEdgeSchema.safeParse(edge({ nodeId: "a", anchorId: "x", side: "left" }, { nodeId: "b" }))
      .success,
    false,
  );
  assert.equal(
    CanvasEdgeSchema.safeParse(edge({ nodeId: "a", offset: 0.3 }, { nodeId: "b" })).success,
    false,
  );
  assert.equal(
    CanvasEdgeSchema.safeParse(edge({ nodeId: "a", side: "right", offset: 1.1 }, { nodeId: "b" }))
      .success,
    false,
  );
});

test("every port pair routes outside both cards with finite orthogonal geometry", () => {
  for (const source of sides)
    for (const target of sides)
      for (const y of [100, 350]) {
        const nodes = [node("a", 100, 100), node("b", 450, y)],
          path = routeEdges(
            layoutCanvas(
              doc(nodes, [edge({ nodeId: "a", side: source }, { nodeId: "b", side: target })]),
            ),
          )[0]!;
        assert.deepEqual(path.diagnostics, [], `${source} → ${target} at ${y}`);
        assert.doesNotMatch(path.d, /NaN|Infinity/);
        for (let i = 1; i < path.points.length; i++) {
          const a = path.points[i - 1]!,
            b = path.points[i]!;
          assert.ok(a.x === b.x || a.y === b.y);
          assert.ok(
            nodes.every((n) => !crosses(a, b, n.rect)),
            `${source} → ${target} crosses a card`,
          );
        }
      }
});

test("maze routing searches beyond L/Z candidates and never returns silent collisions", () => {
  const obstacles = [
    { x: 100, y: -50, w: 50, h: 260 },
    { x: 250, y: 90, w: 50, h: 300 },
    { x: 400, y: -50, w: 50, h: 260 },
  ];
  const path = orthogonal({ x: 0, y: 100 }, { x: 550, y: 100 }, obstacles);
  assert.equal(path.diagnostic, undefined);
  assert.ok(clear(path.points, obstacles));
  assert.ok(path.points.length >= 4);
  assert.equal(
    orthogonal({ x: 110, y: 100 }, { x: 550, y: 100 }, obstacles).diagnostic,
    "endpoint_blocked",
  );
});

test("via points are traversed in order without diagonal shortcuts or rounding away pins", () => {
  const e = edge({ nodeId: "a", side: "right" }, { nodeId: "b", side: "left" });
  e.route.waypoints = [
    { x: 260, y: 60 },
    { x: 340, y: 60 },
  ];
  const path = routeEdges(layoutCanvas(doc([node("a", 100, 100), node("b", 450, 100)], [e])))[0]!;
  assert.deepEqual(path.diagnostics, []);
  for (const pin of e.route.waypoints)
    assert.ok(
      path.points.slice(1).some((b, i) => {
        const a = path.points[i]!;
        return (
          Math.abs(
            Math.hypot(a.x - pin.x, a.y - pin.y) +
              Math.hypot(pin.x - b.x, pin.y - b.y) -
              Math.hypot(a.x - b.x, a.y - b.y),
          ) < 0.001
        );
      }),
    );
  assert.match(path.d, /L 260 60/);
  e.route.waypoints = [{ x: 150, y: 150 }];
  assert.ok(
    routeEdges(
      layoutCanvas(doc([node("a", 100, 100), node("b", 450, 100)], [e])),
    )[0]!.diagnostics.includes("constraint_conflict"),
  );
});

test("labels use measured curve samples and automatic labels avoid cards", () => {
  const e = edge({ nodeId: "a", side: "bottom" }, { nodeId: "b", side: "left" });
  e.route = { type: "bezier" };
  e.label = { text: "Risk decision", position: 0.3, offset: { x: 0, y: 0 } };
  const path = routeEdges(layoutCanvas(doc([node("a", 100, 100), node("b", 500, 400)], [e])))[0]!;
  assert.deepEqual(path.labelPoint, pointAt(path.points, 0.3));
  const chord = pointAt([path.points[0]!, path.points.at(-1)!], 0.3);
  assert.ok(Math.hypot(path.labelPoint.x - chord.x, path.labelPoint.y - chord.y) > 10);
  const nodes = [node("a", 100, 100, 700, 512), node("b", 840, 100, 700, 512)],
    short = edge({ nodeId: "a", side: "right" }, { nodeId: "b", side: "left" });
  short.label = { text: "Решение принято ✓" };
  const label = routeEdges(layoutCanvas(doc(nodes, [short])))[0]!.label!;
  assert.ok(nodes.every((n) => !intersects(label.bounds, n.rect)));
  assert.ok(label.leader);
  assert.ok(!label.crowded);
});

test("edge order does not alter routing or label placement; moving a card invalidates the cache", () => {
  const nodes = [node("a", 100, 100), node("b", 500, 100), node("c", 350, 400)];
  const edges = [
    edge({ nodeId: "a" }, { nodeId: "b" }),
    { ...edge({ nodeId: "a" }, { nodeId: "c" }), id: "second", label: { text: "Branch" } },
  ];
  const first = routeEdges(layoutCanvas(doc(nodes, edges))),
    second = routeEdges(layoutCanvas(doc(nodes, [...edges].reverse())));
  assert.deepEqual(first, second.reverse());
  const canvas = layoutCanvas(doc(nodes, edges)),
    before = routeEdges(canvas)[0]!.d;
  canvas.nodes[1]!.x += 100;
  assert.notEqual(routeEdges(canvas)[0]!.d, before);
});

test("overlapping endpoints surface a diagnostic and keep a finite visible relationship", () => {
  const path = routeEdges(
    layoutCanvas(
      doc(
        [node("a", 100, 100), node("b", 150, 100)],
        [edge({ nodeId: "a", side: "right" }, { nodeId: "b", side: "left" })],
      ),
    ),
  )[0]!;
  assert.ok(path.diagnostics.length);
  assert.doesNotMatch(path.d, /NaN|Infinity/);
});

test("visibility search escapes a corridor maze that has no clear L or Z route", () => {
  const obstacles = [
    { x: -50, y: -120, w: 100, h: 100 },
    { x: -50, y: 20, w: 100, h: 100 },
    { x: 550, y: -120, w: 100, h: 100 },
    { x: 550, y: 20, w: 100, h: 100 },
    { x: 200, y: -500, w: 40, h: 550 },
    { x: 400, y: -50, w: 40, h: 550 },
  ];
  const path = orthogonal({ x: 0, y: 0 }, { x: 600, y: 0 }, obstacles, {
    sourceNormal: { x: 1, y: 0 },
    targetNormal: { x: -1, y: 0 },
  });
  assert.equal(path.diagnostic, undefined);
  assert.ok(clear(path.points, obstacles));
  assert.ok(path.points.length >= 6);
});

test("incremental drag previews reuse untouched paths; a full render stays deterministic", () => {
  const nodes = [
      node("a", 100, 100),
      node("b", 300, 100),
      node("c", 100, 600),
      node("d", 300, 600),
    ],
    edges = [
      edge({ nodeId: "a" }, { nodeId: "b" }),
      { ...edge({ nodeId: "c" }, { nodeId: "d" }), id: "other" },
    ];
  const canvas = layoutCanvas(doc(nodes, edges)),
    before = routeEdges(canvas);
  canvas.nodes[0]!.x += 10;
  const preview = routeEdges(canvas, true);
  assert.equal(preview[1], before[1]);
  assert.notEqual(preview[0]!.d, before[0]!.d);
  const final = routeEdges(canvas),
    fresh = routeEdges({ ...canvas, doc: structuredClone(canvas.doc) });
  assert.deepEqual(final, fresh);
});

test("whole-canvas exports include external loops without shifting region coordinates", async () => {
  const { canvasSnapshotEntryHtml } = await import("../src/snapshot-entry.js");
  const document = doc(
    [node("a", 0, 0)],
    [edge({ nodeId: "a", side: "left" }, { nodeId: "a", side: "left" })],
  );
  const full = canvasSnapshotEntryHtml(document, "", { type: "canvas" }),
    region = canvasSnapshotEntryHtml(document, "", {
      type: "region",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  assert.match(full, /\.vc-world>div,\.vc-world>svg\{transform:translate/);
  assert.doesNotMatch(region, /\.vc-world>div,\.vc-world>svg\{transform:translate/);
});
