import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ElementRefError,
  formatElementRef,
  parseElementRef,
  resolveElementSelection,
} from "../src/element-ref.js";
import { fixture } from "./fixture.js";

test("formats and parses a canonical node locator", () => {
  const refId = formatElementRef("osago/fast-settlement", "step/confirmation screen");
  assert.equal(refId, "canvas://osago/fast-settlement?node=step%2Fconfirmation%20screen");
  assert.deepEqual(parseElementRef(refId), {
    canvasRef: "osago/fast-settlement",
    workspaceSlug: "osago",
    canvasSlug: "fast-settlement",
    nodeId: "step/confirmation screen",
  });
});

test("rejects ambiguous and non-canonical element refs", () => {
  for (const value of [
    "canvas://osago/fast-settlement",
    "canvas://osago/fast-settlement?node=a&node=b",
    "canvas://osago/fast-settlement?node=a&version=2",
    "canvas://osago/fast-settlement?node=a#fragment",
    "canvas://osago/fast-settlement?node=space here",
    "https://osago/fast-settlement?node=a",
  ]) {
    assert.throws(() => parseElementRef(value), ElementRefError);
  }
});

test("resolves the complete node and its graph neighborhood", () => {
  const doc = fixture();
  const node = doc.nodes[1];
  if (!node) throw new Error("fixture has no second node");
  const selection = resolveElementSelection(doc, node.id);
  assert.equal(selection?.node, node);
  assert.equal(selection?.context.lane?.id, node.laneId);
  assert.equal(selection?.context.stage?.id, node.stageId);
  assert.deepEqual(
    selection?.context.incoming_edges.map((edge) => edge.id),
    doc.edges.filter((edge) => edge.target.nodeId === node.id).map((edge) => edge.id),
  );
  assert.equal(resolveElementSelection(doc, "deleted"), null);
});
