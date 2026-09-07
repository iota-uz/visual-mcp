import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCanvas } from "../src/layout.js";
import { estimateNoteHeight, noteRect } from "../src/note-metrics.js";
import { applyCanvasDocPatch } from "../src/patch.js";
import { prototypeNodeFlags } from "../src/prototype.js";
import { renderCanvas } from "../src/render.js";
import { canvasSearchRows, noteTitle } from "../src/search-rows.js";
import { CanvasDocSchema, CanvasFileSchema, CanvasNoteSchema } from "../src/types.js";
import { fixture as fixtureDoc } from "./fixture.js";

const note = {
  id: "n-1",
  x: 10,
  y: 20,
  w: 240,
  text: "Move the CTA above the fold\nand make it primary.",
  author: "human" as const,
};

test("CanvasNoteSchema defaults colour and size, bounds width and text, and requires an author", () => {
  const parsed = CanvasNoteSchema.parse(note);
  assert.equal(parsed.color, "yellow");
  assert.equal(parsed.size, "m");
  assert.equal(CanvasNoteSchema.safeParse({ ...note, w: 50 }).success, false);
  assert.equal(CanvasNoteSchema.safeParse({ ...note, w: 5000 }).success, false);
  assert.equal(CanvasNoteSchema.safeParse({ ...note, text: "   " }).success, false);
  assert.equal(CanvasNoteSchema.safeParse({ ...note, text: "x".repeat(5001) }).success, false);
  assert.equal(CanvasNoteSchema.safeParse({ ...note, author: undefined }).success, false);
  assert.equal(CanvasNoteSchema.safeParse({ ...note, h: 100 }).success, false);
});

test("CanvasDoc carries notes with unique ids", () => {
  const doc = CanvasDocSchema.parse({ ...fixtureDoc(), notes: [note] });
  assert.equal(doc.notes.length, 1);
  assert.equal(
    CanvasDocSchema.safeParse({ ...fixtureDoc(), notes: [note, { ...note, x: 0 }] }).success,
    false,
  );
});

test("notes patch operations add, update, replace and remove", () => {
  const doc = CanvasDocSchema.parse(fixtureDoc());
  const added = applyCanvasDocPatch(doc, [
    { op: "notes.add", value: { ...note, author: "agent" } },
  ]);
  assert.equal(added.notes[0]?.author, "agent");
  const moved = applyCanvasDocPatch(added, [
    { op: "notes.update", id: "n-1", changes: { x: 99, color: "blue" } },
  ]);
  assert.equal(moved.notes[0]?.x, 99);
  assert.equal(moved.notes[0]?.color, "blue");
  const removed = applyCanvasDocPatch(moved, [{ op: "notes.remove", id: "n-1" }]);
  assert.equal(removed.notes.length, 0);
  assert.throws(() => applyCanvasDocPatch(doc, [{ op: "notes.remove", id: "missing" }]));
});

test("estimateNoteHeight grows with wrapped lines and size, never below one line", () => {
  const short = estimateNoteHeight({ w: 240, text: "hi", size: "m" });
  const long = estimateNoteHeight({ w: 240, text: "word ".repeat(60), size: "m" });
  const large = estimateNoteHeight({ w: 240, text: "word ".repeat(60), size: "l" });
  assert.ok(short >= 22 + 28);
  assert.ok(long > short);
  assert.ok(large > long);
  assert.deepEqual(noteRect({ x: 1, y: 2, w: 240, text: "hi", size: "s" }).w, 240);
});

test("renderCanvas paints a notes layer with colour, size and author data", () => {
  const doc = CanvasDocSchema.parse({ ...fixtureDoc(), notes: [{ ...note, color: "pink" }] });
  const html = renderCanvas(layoutCanvas(doc)).html;
  assert.match(html, /<div class="vc-notes"><div class="vc-note" tabindex="0" data-note-id="n-1"/);
  assert.match(html, /data-color="pink" data-size="m" data-author="human"/);
  assert.match(html, /Move the CTA above the fold\nand make it primary\./);
});

test("renderCanvas badges prototype nodes and only draws caption actions when asked", () => {
  const doc = CanvasDocSchema.parse(fixtureDoc());
  const first = doc.nodes[0];
  assert.ok(first);
  const flags = new Map([[first.id, { interactive: true, start: true }]]);
  const plain = renderCanvas(layoutCanvas(doc)).html;
  assert.doesNotMatch(plain, /vc-caption-actions/);
  const rich = renderCanvas(layoutCanvas(doc), {
    captionActions: true,
    prototypeFlags: flags,
    resolvePresentUrl: (id) => `/present?node=${id}`,
  }).html;
  assert.match(rich, /is-interactive is-prototype-start/);
  assert.match(rich, new RegExp(`href="/present\\?node=${first.id}"`));
  assert.match(rich, /vc-caption-play is-interactive/);
  assert.match(rich, /data-action="download"/);
});

test("prototypeNodeFlags marks sources on the page and the start node", () => {
  const flags = prototypeNodeFlags(
    {
      start: { pageId: "p1", nodeId: "a" },
      interactions: [
        {
          id: "i1",
          source: { pageId: "p1", nodeId: "a" },
          destination: { pageId: "p1", nodeId: "b" },
          hotspot: { x: 0, y: 0, w: 1, h: 1 },
        },
        {
          id: "i2",
          source: { pageId: "p2", nodeId: "c" },
          destination: { pageId: "p1", nodeId: "a" },
          hotspot: { x: 0, y: 0, w: 1, h: 1 },
        },
      ],
    } as never,
    "p1",
  );
  assert.deepEqual(flags.get("a"), { interactive: true, start: true });
  assert.equal(flags.has("b"), false);
  assert.equal(flags.has("c"), false);
  assert.equal(prototypeNodeFlags(undefined, "p1").size, 0);
});

test("canvasSearchRows indexes nodes and notes with an entity discriminator", () => {
  const file = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "p1",
    pages: [{ id: "p1", title: "Page one", order: 0, doc: { ...fixtureDoc(), notes: [note] } }],
    prototype: { interactions: [] },
  });
  const rows = canvasSearchRows(file);
  const noteRow = rows.find((row) => row.entity === "note");
  assert.ok(noteRow);
  assert.equal(noteRow.entityId, "n-1");
  assert.equal(noteRow.title, "Move the CTA above the fold");
  assert.equal(noteRow.eyebrow, "Human note");
  assert.match(noteRow.searchText, /Page one/);
  assert.ok(rows.filter((row) => row.entity === "node").length >= 1);
  assert.equal(noteTitle(`${"a".repeat(100)}\nsecond`).length, 80);
});
