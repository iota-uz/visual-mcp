import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteNodes,
  deleteNodesFromFile,
  moveNodes,
  nodesFullyInside,
  restoreNodes,
} from "../src/layout.js";
import { CanvasDocSchema, CanvasFileSchema } from "../src/types.js";
import { anchors, fixture } from "./fixture.js";

const note = (id: string, x: number, y: number, w = 100, h = 80) => ({
  id,
  kind: "native" as const,
  shape: "note" as const,
  rect: { x, y, w, h },
  caption: { title: id },
  anchors,
});

const doc = () =>
  CanvasDocSchema.parse({
    version: 2,
    title: "ops",
    world: { width: 1000, height: 800 },
    nodes: [note("a", 0, 0), note("b", 200, 0), note("c", 400, 0)],
    groups: [{ id: "pair", label: "Pair", nodeIds: ["a", "b"] }],
    edges: [
      {
        id: "ab",
        source: { nodeId: "a", anchorId: "right" },
        target: { nodeId: "b", anchorId: "left" },
        kind: "main",
        route: { type: "orthogonal" },
      },
      {
        id: "bc",
        source: { nodeId: "b", anchorId: "right" },
        target: { nodeId: "c", anchorId: "left" },
        kind: "main",
        route: { type: "orthogonal" },
      },
    ],
  });

test("a batch move translates exactly the named nodes and keeps their spacing", () => {
  const moved = moveNodes(doc(), ["a", "c"], 40, -15);
  assert.deepEqual(
    moved.nodes.map((node) => [node.id, node.rect.x, node.rect.y]),
    [
      ["a", 40, -15],
      ["b", 200, 0],
      ["c", 440, -15],
    ],
  );
  // Still a valid document, not just a plausible-looking object.
  CanvasDocSchema.parse(moved);
});

test("a batch move refuses a node the page does not have", () => {
  assert.throws(() => moveNodes(doc(), ["a", "ghost"], 10, 10), /ghost/);
});

test("deleting nodes takes their edges with them and leaves no dangling ends", () => {
  const result = deleteNodes(doc(), ["b"]);
  assert.deepEqual(result.removedNodeIds, ["b"]);
  assert.deepEqual(result.removedEdgeIds.sort(), ["ab", "bc"]);
  assert.deepEqual(result.doc.edges, []);
  assert.deepEqual(
    result.doc.nodes.map((node) => node.id),
    ["a", "c"],
  );
  // The group keeps the member that survived.
  assert.deepEqual(result.doc.groups, [{ id: "pair", label: "Pair", nodeIds: ["a"] }]);
  CanvasDocSchema.parse(result.doc);
});

test("a group emptied by a deletion is removed rather than left behind", () => {
  const result = deleteNodes(doc(), ["a", "b"]);
  assert.deepEqual(result.removedGroupIds, ["pair"]);
  assert.deepEqual(result.doc.groups, []);
  CanvasDocSchema.parse(result.doc);
});

test("restore puts deleted nodes and edges back and ignores ids that returned already", () => {
  const source = doc();
  const removed = deleteNodes(source, ["b"]);
  const back = restoreNodes(
    removed.doc,
    source.nodes.filter((node) => node.id === "b"),
    source.edges,
  );
  assert.deepEqual(
    back.nodes.map((node) => node.id).sort(),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    back.edges.map((edge) => edge.id).sort(),
    ["ab", "bc"],
  );
  CanvasDocSchema.parse(back);
  // A second restore is a no-op rather than a duplicate-id document.
  const again = restoreNodes(back, source.nodes, source.edges);
  assert.equal(again.nodes.length, 3);
  assert.equal(again.edges.length, 2);
});

test("the marquee takes nodes fully inside the area, never ones it merely clips", () => {
  const board = doc();
  assert.deepEqual(nodesFullyInside(board, { x: -10, y: -10, w: 320, h: 200 }), ["a", "b"]);
  // "b" starts at x=200 and is 100 wide: an area ending at 250 only clips it.
  assert.deepEqual(nodesFullyInside(board, { x: -10, y: -10, w: 260, h: 200 }), ["a"]);
  // Edge-flush counts as inside.
  assert.deepEqual(nodesFullyInside(board, { x: 0, y: 0, w: 100, h: 80 }), ["a"]);
});

test("deleting a screen repairs the canvas-level prototype it was wired into", () => {
  const page = fixture();
  const file = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "p1",
    pages: [{ id: "p1", title: "Flow", order: 0, doc: page }],
    prototype: {
      start: { pageId: "p1", nodeId: "b" },
      interactions: [
        {
          id: "go",
          source: { pageId: "p1", nodeId: "b" },
          hotspot: { x: 0, y: 0, width: 10, height: 10 },
          destination: { pageId: "p1", nodeId: "b" },
        },
      ],
    },
  });

  const result = deleteNodesFromFile(file, "p1", ["b"]);
  assert.deepEqual(result.removedInteractionIds, ["go"]);
  assert.equal(result.clearedStart, true);
  assert.equal(result.file.prototype.start, undefined);
  // The file has to survive its own validator: prototype targets are resolved
  // against real nodes, so an unpruned interaction would reject the save.
  CanvasFileSchema.parse(result.file);
});

test("deleting from an unknown page is an error, not a silent no-op", () => {
  const file = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "p1",
    pages: [{ id: "p1", title: "Flow", order: 0, doc: fixture() }],
  });
  assert.throws(() => deleteNodesFromFile(file, "nope", ["a"]), /nope/);
});
