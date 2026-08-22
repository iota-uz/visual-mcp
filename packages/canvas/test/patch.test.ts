import assert from "node:assert/strict";
import test from "node:test";
import { applyCanvasDocPatch } from "../src/patch.js";
import { fixture } from "./fixture.js";

const fixtureDoc = fixture();

test("CanvasDoc semantic patch updates geometry without replacing the document", () => {
  const node = fixtureDoc.nodes[0];
  assert.ok(node);
  const patched = applyCanvasDocPatch(fixtureDoc, [
    { op: "nodes.update", id: node.id, changes: { rect: { ...node.rect, x: node.rect.x + 40 } } },
  ]);
  assert.equal(patched.nodes[0]?.rect.x, node.rect.x + 40);
  assert.equal(patched.nodes.length, fixtureDoc.nodes.length);
});

test("CanvasDoc semantic patch creates and updates groups", () => {
  const source = { ...fixtureDoc, groups: [] };
  const added = applyCanvasDocPatch(source, [
    { op: "groups.add", value: { id: "pair", label: "Pair", nodeIds: ["a", "b"] } },
  ]);
  const updated = applyCanvasDocPatch(added, [
    { op: "groups.update", id: "pair", changes: { label: "Updated pair" } },
  ]);
  assert.deepEqual(updated.groups, [{ id: "pair", label: "Updated pair", nodeIds: ["a", "b"] }]);
});

test("CanvasDoc semantic patch is validated as one atomic result", () => {
  const node = fixtureDoc.nodes[0];
  assert.ok(node);
  assert.throws(
    () => applyCanvasDocPatch(fixtureDoc, [{ op: "nodes.remove", id: node.id }]),
    /unknown node/,
  );
});

test("CanvasDoc replace clears optional fields and preserves the semantic id", () => {
  const node = fixtureDoc.nodes[0];
  assert.ok(node);
  const patched = applyCanvasDocPatch(fixtureDoc, [
    {
      op: "nodes.replace",
      id: node.id,
      value: {
        kind: "native",
        id: "ignored",
        rect: { ...node.rect, x: node.rect.x + 80 },
        caption: { title: "Replacement" },
        anchors: node.anchors,
        shape: "note",
      },
    },
  ]);
  const replacement = patched.nodes[0];
  assert.ok(replacement);
  assert.equal(replacement.id, node.id);
  assert.equal(replacement.caption.subtitle, undefined);
  assert.equal(replacement.inspector, undefined);
});
