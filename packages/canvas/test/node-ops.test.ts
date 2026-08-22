import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteNodes,
  deleteNodesFromFile,
  moveNodes,
  nodesFullyInside,
  restoreNodes,
  restoreNodesIntoFile,
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
  const back = restoreNodes(removed.doc, {
    nodes: source.nodes.filter((node) => node.id === "b"),
    edges: source.edges,
  });
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
  const again = restoreNodes(back, { nodes: source.nodes, edges: source.edges });
  assert.equal(again.nodes.length, 3);
  assert.equal(again.edges.length, 2);
});

test("restore puts group membership back, both shrunk and emptied", () => {
  const source = doc();
  // "b" only shrinks the group; "a" and "b" together destroy it.
  const shrunk = deleteNodes(source, ["b"]);
  assert.deepEqual(shrunk.changedGroups, [{ id: "pair", label: "Pair", nodeIds: ["a", "b"] }]);
  const backShrunk = restoreNodes(shrunk.doc, {
    nodes: source.nodes.filter((node) => node.id === "b"),
    edges: source.edges,
    groups: shrunk.changedGroups,
  });
  assert.deepEqual(backShrunk.groups, [{ id: "pair", label: "Pair", nodeIds: ["a", "b"] }]);
  CanvasDocSchema.parse(backShrunk);

  const emptied = deleteNodes(source, ["a", "b"]);
  const backEmptied = restoreNodes(emptied.doc, {
    nodes: source.nodes.filter((node) => node.id !== "c"),
    edges: source.edges,
    groups: emptied.changedGroups,
  });
  assert.deepEqual(backEmptied.groups, [{ id: "pair", label: "Pair", nodeIds: ["a", "b"] }]);
  CanvasDocSchema.parse(backEmptied);
});

test("restore drops group members and edges the document no longer has", () => {
  const source = doc();
  const removed = deleteNodes(source, ["a", "b"]);
  // Undo arrives after someone else's edit: only "b" can come back.
  const back = restoreNodes(removed.doc, {
    nodes: source.nodes.filter((node) => node.id === "b"),
    edges: source.edges,
    groups: removed.changedGroups,
  });
  assert.deepEqual(back.groups, [{ id: "pair", label: "Pair", nodeIds: ["b"] }]);
  // "ab" would dangle off the still-missing "a", so it stays out.
  assert.deepEqual(
    back.edges.map((edge) => edge.id),
    ["bc"],
  );
  CanvasDocSchema.parse(back);
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

  // Undo has to bring the wiring back too, or the canvas looks recovered
  // while its prototype has quietly lost a hotspot and its start screen.
  const back = restoreNodesIntoFile(result.file, "p1", result.undo);
  assert.deepEqual(back.prototype.start, { pageId: "p1", nodeId: "b" });
  assert.deepEqual(
    back.prototype.interactions.map((interaction) => interaction.id),
    ["go"],
  );
  CanvasFileSchema.parse(back);
});

test("restore leaves out prototype wiring whose endpoints did not come back", () => {
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
          source: { pageId: "p1", nodeId: "a" },
          hotspot: { x: 0, y: 0, width: 10, height: 10 },
          destination: { pageId: "p1", nodeId: "b" },
        },
      ],
    },
  });
  const result = deleteNodesFromFile(file, "p1", ["a", "b"]);
  // Only "a" is restored, so the hotspot into "b" must stay pruned.
  const back = restoreNodesIntoFile(result.file, "p1", {
    ...result.undo,
    nodes: result.undo.nodes.filter((node) => node.id === "a"),
  });
  assert.deepEqual(back.prototype.interactions, []);
  assert.equal(back.prototype.start, undefined);
  CanvasFileSchema.parse(back);
});

test("deleting from an unknown page is an error, not a silent no-op", () => {
  const file = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "p1",
    pages: [{ id: "p1", title: "Flow", order: 0, doc: fixture() }],
  });
  assert.throws(() => deleteNodesFromFile(file, "nope", ["a"]), /nope/);
});
