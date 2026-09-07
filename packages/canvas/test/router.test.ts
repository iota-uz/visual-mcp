import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCanvas } from "../src/layout.js";
import { renderCanvas } from "../src/render.js";
import { routeEdges } from "../src/router.js";
import type { CanvasDoc, CanvasEdge, CanvasNode } from "../src/types.js";

const anchors = [
  { id: "top", side: "top" as const, offset: 0.5 },
  { id: "right", side: "right" as const, offset: 0.5 },
  { id: "bottom", side: "bottom" as const, offset: 0.5 },
  { id: "left", side: "left" as const, offset: 0.5 },
];

function node(id: string, x: number, y: number, w = 100, h = 100): CanvasNode {
  return {
    id,
    kind: "native",
    shape: "card",
    rect: { x, y, w, h },
    caption: { title: id },
    anchors,
  };
}

function edge(
  id: string,
  sourceNode: string,
  sourceAnchor: string,
  targetNode: string,
  targetAnchor: string,
): CanvasEdge {
  return {
    id,
    source: { nodeId: sourceNode, anchorId: sourceAnchor },
    target: { nodeId: targetNode, anchorId: targetAnchor },
    kind: "main",
    route: { type: "orthogonal" },
  };
}

function doc(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasDoc {
  return {
    version: 2,
    title: "routing cases",
    world: { width: 1200, height: 900 },
    lanes: [],
    stages: [],
    labels: [],
    nodes,
    groups: [],
    edges,
  };
}

test("fan-out forms one short trunk and turns branches in opposite directions", () => {
  const canvas = layoutCanvas(
    doc(
      [
        node("source", 100, 350),
        node("straight", 800, 350),
        node("upper", 500, 80),
        node("lower", 500, 680),
      ],
      [
        edge("straight", "source", "right", "straight", "left"),
        edge("upper", "source", "right", "upper", "left"),
        edge("lower", "source", "right", "lower", "left"),
      ],
    ),
  );
  const paths = routeEdges(canvas);
  const sourcePoint = { x: 200, y: 400 };
  const junctionPoint = { x: 224, y: 400 };
  const turningBranches = paths.filter((path) => path.edge.id !== "straight");

  assert.equal(paths.filter((path) => path.junctionPoint).length, 1);
  assert.deepEqual(paths.find((path) => path.junctionPoint)?.junctionPoint, junctionPoint);
  assert.deepEqual(
    turningBranches.map((path) => path.points[0]),
    [sourcePoint, sourcePoint],
  );
  const [upper, lower] = turningBranches;
  assert.ok(upper && lower);
  assert.deepEqual(upper.points[1], junctionPoint);
  assert.deepEqual(lower.points[1], junctionPoint);
  assert.equal(upper.points[2]?.x, junctionPoint.x);
  assert.equal(lower.points[2]?.x, junctionPoint.x);
  assert.ok((upper.points[2]?.y ?? sourcePoint.y) < sourcePoint.y);
  assert.ok((lower.points[2]?.y ?? sourcePoint.y) > sourcePoint.y);
  assert.equal(paths.find((path) => path.edge.id === "straight")?.points.length, 2);
});

test("parallel and reciprocal connections use distinct tracks", () => {
  const canvas = layoutCanvas(
    doc(
      [node("a", 100, 300), node("b", 700, 300)],
      [edge("forward", "a", "right", "b", "left"), edge("reverse", "b", "left", "a", "right")],
    ),
  );
  const [forward, reverse] = routeEdges(canvas);
  assert.ok(forward && reverse);
  const forwardTrack = forward.points.find((point) => point.y !== 350)?.y;
  const reverseTrack = reverse.points.find((point) => point.y !== 350)?.y;
  assert.notEqual(forwardTrack, undefined);
  assert.notEqual(reverseTrack, undefined);
  assert.notEqual(forwardTrack, reverseTrack);
  assert.ok(forward.d !== reverse.d, "opposite arrows must not paint the same line twice");
});

test("multiple incoming connections converge through one shared approach trunk", () => {
  const canvas = layoutCanvas(
    doc(
      [node("upper", 100, 100), node("lower", 100, 600), node("target", 700, 350)],
      [
        edge("from-upper", "upper", "right", "target", "left"),
        edge("from-lower", "lower", "right", "target", "left"),
      ],
    ),
  );
  const paths = routeEdges(canvas);
  const entries = paths.map((path) => path.points.at(-2)?.x);
  assert.deepEqual(entries, [676, 676]);
  assert.equal(paths.filter((path) => path.mergePoint).length, 1);
  assert.deepEqual(paths.find((path) => path.mergePoint)?.mergePoint, { x: 676, y: 400 });
});

test("a connection back to the same anchor becomes a visible external loop", () => {
  const canvas = layoutCanvas(
    doc([node("screen", 300, 300)], [edge("retry", "screen", "right", "screen", "right")]),
  );
  const path = routeEdges(canvas)[0];
  assert.ok(path);
  assert.deepEqual(path.points[0], path.points.at(-1));
  assert.ok(path.points.length >= 7);
  assert.ok(new Set(path.points.map((point) => `${point.x}:${point.y}`)).size >= 5);
  assert.doesNotMatch(path.d, /NaN|Infinity/);
});

test("a target behind the source still leaves and enters on the declared sides", () => {
  const canvas = layoutCanvas(
    doc(
      [node("source", 500, 100), node("target", 180, 500)],
      [edge("backward", "source", "right", "target", "left")],
    ),
  );
  const path = routeEdges(canvas)[0];
  assert.ok(path);
  const [source, exit, firstTurn] = path.points;
  const beforeEntry = path.points.at(-2);
  const target = path.points.at(-1);
  assert.ok(source && exit && firstTurn && beforeEntry && target);
  assert.ok(exit.x > source.x);
  assert.equal(firstTurn.x, exit.x);
  assert.ok(beforeEntry.x < target.x);
});

test("short links remain finite and do not collapse into a zero-length arrow", () => {
  const canvas = layoutCanvas(
    doc([node("a", 100, 300), node("b", 215, 300)], [edge("short", "a", "right", "b", "left")]),
  );
  const path = routeEdges(canvas)[0];
  assert.ok(path);
  assert.deepEqual(path.points, [
    { x: 200, y: 350 },
    { x: 215, y: 350 },
  ]);
  assert.doesNotMatch(path.d, /NaN|Infinity/);
  assert.notDeepEqual(path.points[0], path.points.at(-1));
});

test("40px gutters between tall screens stay straight in every direction", () => {
  for (const gap of [1, 15, 40, 48, 72]) {
    for (const vertical of [false, true]) {
      for (const reverse of [false, true]) {
        const nodes = vertical
          ? [node("a", 100, 100, 512, 700), node("b", 100, 800 + gap, 512, 700)]
          : [node("a", 100, 100, 700, 512), node("b", 800 + gap, 100, 700, 512)];
        const from = vertical ? "bottom" : "right";
        const to = vertical ? "top" : "left";
        const connection = reverse
          ? edge("link", "b", to, "a", from)
          : edge("link", "a", from, "b", to);
        const path = routeEdges(layoutCanvas(doc(nodes, [connection])))[0]!;
        assert.equal(path.points.length, 2, `${gap}px, vertical=${vertical}, reverse=${reverse}`);
        assert.equal(
          Math.hypot(path.points[1]!.x - path.points[0]!.x, path.points[1]!.y - path.points[0]!.y),
          gap,
        );
        assert.doesNotMatch(path.d, /NaN|Infinity|Q/);
      }
    }
  }
});

test("backward links go around their endpoint cards instead of through them", () => {
  const path = routeEdges(
    layoutCanvas(
      doc(
        [node("source", 600, 300), node("target", 100, 300)],
        [edge("backward", "source", "right", "target", "left")],
      ),
    ),
  )[0]!;
  assert.ok(path.points.some((point) => point.y < 300 || point.y > 400));
  for (let i = 1; i < path.points.length - 2; i++) {
    const a = path.points[i]!;
    const b = path.points[i + 1]!;
    if (a.y === b.y && a.y > 300 && a.y < 400) {
      for (const [left, right] of [
        [100, 200],
        [600, 700],
      ]) {
        assert.ok(Math.max(a.x, b.x) <= left! || Math.min(a.x, b.x) >= right!);
      }
    }
  }
});

test("edge rendering adds crossing halos and one junction port per fan-out", () => {
  const canvas = layoutCanvas(
    doc(
      [node("source", 100, 350), node("upper", 600, 100), node("lower", 600, 650)],
      [
        { ...edge("upper", "source", "right", "upper", "left"), label: { text: "yes" } },
        { ...edge("lower", "source", "right", "lower", "left"), label: { text: "no" } },
      ],
    ),
  );
  const html = renderCanvas(canvas).html;
  assert.equal((html.match(/class="vc-edge-halo"/g) ?? []).length, 2);
  assert.equal((html.match(/class="vc-edge-line"/g) ?? []).length, 2);
  assert.equal((html.match(/class="vc-edge-junction"/g) ?? []).length, 1);
});

test("a mixed orthogonal and bezier fan-out keeps its junction on the shared anchor", () => {
  const bezier = {
    ...edge("curve", "source", "right", "upper", "left"),
    route: { type: "bezier" as const },
  };
  const canvas = layoutCanvas(
    doc(
      [node("source", 100, 350), node("upper", 600, 100), node("lower", 600, 650)],
      [bezier, edge("lower", "source", "right", "lower", "left")],
    ),
  );
  const paths = routeEdges(canvas);
  assert.deepEqual(paths.find((path) => path.junctionPoint)?.junctionPoint, { x: 200, y: 400 });
});

test("arrowheads paint after every edge halo so reciprocal tips cannot be erased", () => {
  const html = renderCanvas(
    layoutCanvas(
      doc(
        [node("a", 100, 300), node("b", 700, 300)],
        [edge("forward", "a", "right", "b", "left"), edge("reverse", "b", "left", "a", "right")],
      ),
    ),
  ).html;
  assert.ok(html.indexOf('class="vc-edge-heads"') > html.lastIndexOf('class="vc-edge-halo"'));
  assert.equal((html.match(/marker-end="url\(#vc-arrow-main\)"/g) ?? []).length, 2);
});
