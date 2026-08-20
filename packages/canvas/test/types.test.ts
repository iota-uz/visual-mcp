import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasDocSchema } from "../src/types.js";
import { fixture } from "./fixture.js";

test("accepts CanvasDoc v2 native, iframe, and image union", () =>
  assert.equal(CanvasDocSchema.safeParse(fixture()).success, true));
test("defaults diagram-only collections for gallery-oriented documents", () => {
  const parsed = CanvasDocSchema.parse({
    version: 2,
    title: "Empty board",
    world: { width: 800, height: 600 },
  });
  assert.deepEqual(
    {
      lanes: parsed.lanes,
      stages: parsed.stages,
      labels: parsed.labels,
      nodes: parsed.nodes,
      edges: parsed.edges,
    },
    { lanes: [], stages: [], labels: [], nodes: [], edges: [] },
  );
});

test("defaults anchors for standalone gallery nodes", () => {
  const parsed = CanvasDocSchema.parse({
    version: 2,
    title: "Gallery",
    world: { width: 800, height: 600 },
    nodes: [
      {
        id: "reference",
        kind: "image",
        rect: { x: 20, y: 20, w: 320, h: 240 },
        caption: { title: "Reference" },
        source: { path: "/assets/reference.png" },
        alt: "Reference",
      },
    ],
  });
  assert.deepEqual(parsed.nodes[0]?.anchors, []);
});
test("accepts a native image node and rejects unsafe image sources", () => {
  const doc = fixture();
  doc.nodes.push({
    id: "reference",
    kind: "image",
    rect: { x: 20, y: 20, w: 320, h: 240 },
    caption: { title: "Reference" },
    anchors: [{ id: "right", side: "right", offset: 0.5 }],
    source: { path: "/assets/reference.webp" },
    fit: "cover",
    focalPosition: { x: 0.25, y: 0.75 },
    alt: "Reference screen",
  });
  assert.equal(CanvasDocSchema.safeParse(doc).success, true);

  const image = doc.nodes.at(-1);
  assert.ok(image?.kind === "image");
  image.source.path = "https://evil.test/reference.webp";
  assert.equal(CanvasDocSchema.safeParse(doc).success, false);
});
test("bounds canvas complexity before persistence", () => {
  const doc = fixture();
  doc.nodes = Array.from({ length: 1_001 }, (_, index) => ({
    ...doc.nodes[0]!,
    id: `node-${index}`,
  }));
  assert.equal(CanvasDocSchema.safeParse(doc).success, false);
});
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
test("phone frames require the canonical content viewport and valid canvas-owned status time", () => {
  const wrongViewport = fixture();
  const viewportNode = wrongViewport.nodes[1]!;
  if (viewportNode.kind === "iframe") viewportNode.viewport = { width: 310, height: 708 };
  const viewportResult = CanvasDocSchema.safeParse(wrongViewport);
  assert.equal(viewportResult.success, false);
  assert.match(JSON.stringify(viewportResult), /canonical 284x642 content area/);

  const wrongTime = fixture();
  const timeNode = wrongTime.nodes[1]!;
  if (timeNode.kind === "iframe" && timeNode.frame.kind === "phone") timeNode.frame.time = "25:70";
  assert.equal(CanvasDocSchema.safeParse(wrongTime).success, false);
});
