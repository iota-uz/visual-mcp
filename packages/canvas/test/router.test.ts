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
    shape: "note",
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

test("fan-out gives branches from one anchor separate outward tracks", () => {
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
  const turningBranches = paths.filter((path) => path.edge.id !== "straight");

  assert.equal(paths.filter((path) => path.junctionPoint).length, 1);
  assert.deepEqual(paths.find((path) => path.junctionPoint)?.junctionPoint, sourcePoint);
  assert.deepEqual(
    turningBranches.map((path) => path.points[0]),
    [sourcePoint, sourcePoint],
  );
  const exits = turningBranches.map((path) => path.points[1]?.x);
  assert.ok(exits.every((x) => x !== undefined && x > sourcePoint.x));
  assert.equal(new Set(exits).size, turningBranches.length, "branches use distinct trunks");
  for (const path of turningBranches) {
    const [start, exit, turn] = path.points;
    assert.ok(start && exit && turn);
    assert.ok(exit.x > start.x, "the route first leaves through the declared right side");
    assert.equal(turn.x, exit.x, "the route turns instead of doubling back over its stem");
  }
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

test("multiple incoming connections converge through separate approach tracks", () => {
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
  assert.equal(new Set(entries).size, paths.length);
  assert.equal(paths.filter((path) => path.mergePoint).length, 1);
  assert.deepEqual(paths.find((path) => path.mergePoint)?.mergePoint, { x: 700, y: 400 });
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
  assert.ok(path.points.length >= 4);
  assert.doesNotMatch(path.d, /NaN|Infinity/);
  assert.notDeepEqual(path.points[0], path.points.at(-1));
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
