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

test("CanvasDoc semantic patch is validated as one atomic result", () => {
  const node = fixtureDoc.nodes[0];
  assert.ok(node);
  assert.throws(
    () => applyCanvasDocPatch(fixtureDoc, [{ op: "nodes.remove", id: node.id }]),
    /unknown node/,
  );
});
