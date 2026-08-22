import assert from "node:assert/strict";
import test from "node:test";
import { findNodeOverlaps } from "../src/overlap.js";

const at = (id: string, x: number, y: number, w = 100, h = 100) => ({ id, rect: { x, y, w, h } });

test("nodes laid edge to edge do not overlap", () => {
  const report = findNodeOverlaps([at("a", 0, 0), at("b", 100, 0), at("c", 0, 100)]);
  assert.equal(report.total, 0);
  assert.deepEqual(report.overlaps, []);
  assert.equal(report.truncated, false);
});

test("an overlapping pair reports both ids, the area and the buried fraction", () => {
  // "b" is half the size of "a" and sits entirely inside it.
  const report = findNodeOverlaps([at("a", 0, 0, 200, 200), at("b", 50, 50, 100, 100)]);
  assert.equal(report.total, 1);
  const [overlap] = report.overlaps;
  assert.ok(overlap);
  assert.equal(overlap.a, "a");
  assert.equal(overlap.b, "b");
  assert.equal(overlap.area, 100 * 100);
  // Fully covered relative to the *smaller* node, not the larger one.
  assert.equal(overlap.fraction, 1);
});

test("a partial corner overlap measures only the intersection", () => {
  const report = findNodeOverlaps([at("a", 0, 0), at("b", 80, 90)]);
  assert.equal(report.total, 1);
  assert.equal(report.overlaps[0]?.area, 20 * 10);
  assert.equal(report.overlaps[0]?.fraction, 200 / 10_000);
});

test("pair identity is stable regardless of input order", () => {
  const forward = findNodeOverlaps([at("zeta", 0, 0), at("alpha", 10, 10)]);
  const reverse = findNodeOverlaps([at("alpha", 10, 10), at("zeta", 0, 0)]);
  assert.deepEqual(forward.overlaps, reverse.overlaps);
  assert.equal(forward.overlaps[0]?.a, "alpha");
});

test("the x sweep does not miss a pair hidden behind an unrelated node", () => {
  // "wide" starts first and spans everything; the sweep must not stop at it.
  const report = findNodeOverlaps([at("wide", 0, 0, 1_000, 20), at("l", 400, 400), at("r", 450, 400)]);
  assert.equal(report.total, 1);
  assert.equal(report.overlaps[0]?.a, "l");
});

test("overlaps come back worst first and cap at the requested limit", () => {
  const nodes = [
    at("a", 0, 0),
    at("b", 90, 0), // 10 x 100 = 1000
    at("c", 500, 0, 200, 200),
    at("d", 550, 0, 200, 200), // 150 x 200 = 30000
  ];
  const all = findNodeOverlaps(nodes);
  assert.equal(all.total, 2);
  assert.equal(all.overlaps[0]?.a, "c");
  assert.equal(all.truncated, false);

  const capped = findNodeOverlaps(nodes, { limit: 1 });
  assert.equal(capped.total, 2);
  assert.equal(capped.overlaps.length, 1);
  assert.equal(capped.truncated, true);
  // The cap keeps the worst offender, not whichever was found first.
  assert.equal(capped.overlaps[0]?.a, "c");
});

test("a zero limit still counts every pair", () => {
  const report = findNodeOverlaps([at("a", 0, 0), at("b", 10, 10)], { limit: 0 });
  assert.equal(report.total, 1);
  assert.equal(report.overlaps.length, 0);
  assert.equal(report.truncated, true);
});
