import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCanvasFilePatch } from "../src/file-patch.js";
import { type CanvasFile, CanvasFileSchema } from "../src/types.js";

function page(id: string, nodeId = `${id}-node`) {
  return {
    id,
    title: id,
    order: 0,
    doc: {
      version: 2 as const,
      title: id,
      subtitle: "old",
      world: { width: 400, height: 300 },
      lanes: [],
      stages: [],
      labels: [],
      nodes: [
        {
          kind: "native" as const,
          id: nodeId,
          rect: { x: 10, y: 10, w: 100, h: 60 },
          caption: { title: nodeId },
          anchors: [],
          shape: "note" as const,
        },
      ],
      groups: [],
      edges: [],
      drawings: [],
    },
  };
}

test("mixed patch validates prototype references only after the complete batch", () => {
  const first = page("flow", "old");
  const source = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "flow",
    pages: [first],
    prototype: { start: { pageId: "flow", nodeId: "old" }, interactions: [] },
  }) as CanvasFile;
  const replacement = { ...first.doc.nodes[0], id: "new", caption: { title: "new" } };

  const result = applyCanvasFilePatch(source, [
    { op: "page.doc.patch", pageId: "flow", operations: [{ op: "nodes.remove", id: "old" }] },
    { op: "page.doc.patch", pageId: "flow", operations: [{ op: "nodes.add", value: replacement }] },
    { op: "prototype.start.set", start: { pageId: "flow", nodeId: "new" } },
  ]);

  assert.equal(result.file.prototype.start?.nodeId, "new");
  assert.deepEqual(
    result.file.pages[0]?.doc.nodes.map((node) => node.id),
    ["new"],
  );
});

test("page metadata and ordering update in one patch", () => {
  const source = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "a",
    pages: [
      { ...page("a"), order: 0 },
      { ...page("b"), order: 1 },
    ],
    prototype: { interactions: [] },
  });
  const result = applyCanvasFilePatch(source, [
    { op: "page.update", pageId: "a", changes: { title: "Overview", subtitle: null } },
    { op: "pages.reorder", pageIds: ["b", "a"] },
  ]);

  assert.deepEqual(
    result.file.pages.map((item) => item.id),
    ["b", "a"],
  );
  assert.equal(result.file.pages[1]?.title, "Overview");
  assert.equal(result.file.pages[1]?.doc.title, "Overview");
  assert.equal(result.file.pages[1]?.doc.subtitle, undefined);
});
