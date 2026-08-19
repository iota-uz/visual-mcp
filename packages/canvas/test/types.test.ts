import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasDocSchema } from "../src/types.js";
import { fixture } from "./fixture.js";

test("accepts CanvasDoc v2 native and iframe union", () =>
  assert.equal(CanvasDocSchema.safeParse(fixture()).success, true));
test("rejects v1", () =>
  assert.equal(CanvasDocSchema.safeParse({ ...fixture(), version: 1 }).success, false));
test("rejects traversal and external iframe URLs", () => {
  for (const entrypoint of [
    "/src/screens/../secret.html",
    "https://evil.test/screen.html",
    "/src/other/screen.html",
  ]) {
    const doc = fixture();
    const node = doc.nodes[1]!;
    if (node.kind === "iframe") node.source.entrypoint = entrypoint;
    assert.equal(CanvasDocSchema.safeParse(doc).success, false);
  }
});
test("rejects unknown edge anchors", () => {
  const doc = fixture();
  doc.edges[0]!.target.anchorId = "missing";
  const result = CanvasDocSchema.safeParse(doc);
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result), /unknown anchor/);
});
test("rejects duplicate IDs and non-positive rects", () => {
  const doc = fixture();
  doc.nodes[1]!.id = "a";
  doc.lanes[0]!.rect.w = 0;
  assert.equal(CanvasDocSchema.safeParse(doc).success, false);
});
test("sandbox and permissions are strict enums", () => {
  const doc = fixture();
  const node = doc.nodes[1]!;
  if (node.kind === "iframe") (node.sandbox as string[]).push("allow-same-origin");
  assert.equal(CanvasDocSchema.safeParse(doc).success, false);
});
