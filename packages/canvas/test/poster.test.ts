import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasPoster, canvasPosterForDoc, POSTER_MAX_RECTS } from "../src/poster.js";
import { CanvasDocSchema, CanvasFileSchema } from "../src/types.js";
import { fixture } from "./fixture.js";

const emptyDoc = () =>
  CanvasDocSchema.parse({ version: 2, title: "Empty", world: { width: 800, height: 600 } });

function docWithNodes(rects: Array<{ id: string; x: number; y: number; w: number; h: number }>) {
  return CanvasDocSchema.parse({
    version: 2,
    title: "Generated",
    world: { width: 4000, height: 4000 },
    nodes: rects.map(({ id, ...rect }) => ({
      id,
      kind: "native",
      shape: "card",
      rect,
      caption: { title: id },
    })),
  });
}

test("an empty canvas is a poster with no rectangles, not the absence of one", () => {
  const poster = canvasPosterForDoc(emptyDoc());
  assert.deepEqual(poster, { format: 1, ar: 4 / 3, n: 0, p: 1, rects: [] });
});

test("normalises node rects into per-mille of their bounding box", () => {
  const poster = canvasPosterForDoc(
    docWithNodes([
      { id: "a", x: 100, y: 100, w: 100, h: 100 },
      { id: "b", x: 300, y: 300, w: 100, h: 100 },
    ]),
  );
  // The box is 100,100 → 400,400: the first node starts at the origin and
  // the second ends at the far corner.
  assert.deepEqual(poster.rects[0], { x: 0, y: 0, w: 333, h: 333 });
  assert.deepEqual(poster.rects[1], { x: 667, y: 667, w: 333, h: 333 });
  assert.equal(poster.ar, 1);
});

test("keeps the largest nodes, and says how many there really were", () => {
  const many = Array.from({ length: 500 }, (_, index) => ({
    id: `n${String(index).padStart(3, "0")}`,
    x: index * 10,
    y: 0,
    w: index + 1,
    h: 10,
  }));
  const poster = canvasPosterForDoc(docWithNodes(many));
  assert.equal(poster.n, 500);
  assert.equal(poster.rects.length, POSTER_MAX_RECTS);
  // Largest by area first — an arbitrary 32 in document order would be a
  // different picture every time the file is re-serialised.
  const widths = poster.rects.map((rect) => rect.w);
  assert.deepEqual(
    widths,
    [...widths].sort((a, b) => b - a),
  );
  assert.equal(widths[0], Math.max(...widths));
});

test("is deterministic for the same document", () => {
  const doc = docWithNodes([
    { id: "b", x: 0, y: 0, w: 10, h: 10 },
    { id: "a", x: 20, y: 0, w: 10, h: 10 },
  ]);
  assert.deepEqual(canvasPosterForDoc(doc), canvasPosterForDoc(doc));
});

test("clamps an extreme aspect so a timeline letterboxes instead of vanishing", () => {
  const wide = canvasPosterForDoc(docWithNodes([{ id: "a", x: 0, y: 0, w: 40000, h: 100 }]));
  const tall = canvasPosterForDoc(docWithNodes([{ id: "a", x: 0, y: 0, w: 100, h: 40000 }]));
  assert.equal(wide.ar, 4);
  assert.equal(tall.ar, 0.25);
});

test("carries the lane role, and the node kind when it is not native", () => {
  const poster = canvasPosterForDoc(CanvasDocSchema.parse(fixture()));
  assert.deepEqual(
    poster.rects.map((rect) => [rect.r, rect.k]),
    [
      ["primary", "iframe"],
      ["primary", undefined],
    ],
  );
});

test("omits the role for a node that sits in no lane", () => {
  const poster = canvasPosterForDoc(docWithNodes([{ id: "a", x: 0, y: 0, w: 10, h: 10 }]));
  assert.equal("r" in (poster.rects[0] ?? {}), false);
});

test("covers the page a click opens, and counts the rest", () => {
  const doc = CanvasDocSchema.parse(fixture());
  const file = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "second",
    pages: [
      { id: "first", title: "First", order: 0, doc: emptyDoc() },
      { id: "second", title: "Second", order: 1, doc },
    ],
  });
  const poster = canvasPoster(file);
  assert.equal(poster.p, 2);
  // The default page is the one a viewer opens, so it is the one shown.
  assert.equal(poster.n, doc.nodes.length);
});
