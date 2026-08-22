import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { describeIssues } from "../src/issues.js";
import { applyCanvasDocPatch } from "../src/patch.js";
import { CanvasNodeSchema } from "../src/types.js";

function iframeNode(overrides: Record<string, unknown> = {}) {
  return {
    kind: "iframe",
    id: "calc-mobile-app",
    rect: { x: 0, y: 0, w: 310, h: 708 },
    caption: { title: "Mobile app" },
    anchors: [{ id: "in", side: "left", offset: 0.5 }],
    source: { entrypoint: "/src/screens/32-calc-mobile-app.html" },
    viewport: { width: 284, height: 642 },
    frame: { kind: "phone", time: "09:42" },
    ...overrides,
  };
}

function doc(nodes: Record<string, unknown>[]) {
  return {
    version: 2 as const,
    title: "Calculator",
    world: { width: 4000, height: 4000 },
    lanes: [],
    stages: [],
    labels: [],
    groups: [],
    edges: [],
    nodes,
  };
}

test("a union failure names the branch the author meant, not 'Invalid input'", () => {
  const result = CanvasNodeSchema.safeParse(
    iframeNode({
      frame: { kind: "device", preset: "iphone", display: "clip" },
      viewport: undefined,
    }),
  );
  assert.equal(result.success, false);
  if (result.success) return;
  // Bare zod says only this much, which is the whole reason this exists.
  assert.equal(result.error.issues[0]?.message, "Invalid input");
  const described = describeIssues(result.error);
  assert.match(described ?? "", /frame\.preset/);
  assert.match(described ?? "", /'iphone-safari' \| 'desktop-safari'/);
  // The branches that simply are not this node's kind stay out of it.
  assert.doesNotMatch(described ?? "", /expected "native"|expected "image"/);
});

test("the cross-field rule that fires with a correct preset is readable too", () => {
  const result = CanvasNodeSchema.safeParse(
    iframeNode({
      frame: { kind: "device", preset: "desktop-safari", display: "clip" },
      viewport: { width: 940, height: 660 },
    }),
  );
  assert.equal(result.success, false);
  if (result.success) return;
  const described = describeIssues(result.error) ?? "";
  assert.match(described, /viewport\.width: Desktop · Safari screens are 1280px wide/);
  assert.match(described, /omit viewport/);
});

test("entities are named by id, since that is how the caller addressed them", () => {
  const value = doc([
    iframeNode({ id: "calc-00-as-is" }),
    iframeNode({ id: "calc-mobile-app", frame: { kind: "device", preset: "ios" } }),
  ]);
  const described =
    describeIssues(
      { issues: [{ code: "custom", message: "boom", path: ["nodes", 1, "frame", "preset"] }] },
      { value },
    ) ?? "";
  assert.equal(described, "nodes.1 (calc-mobile-app).frame.preset: boom");
});

test("a plain error is left alone", () => {
  assert.equal(describeIssues(new Error("nope")), null);
  assert.equal(describeIssues("nope"), null);
});

test("a long list is capped rather than dumped", () => {
  const issues = Array.from({ length: 12 }, (_, index) => ({
    code: "custom",
    message: `problem ${index}`,
    path: ["nodes", index],
  }));
  const described = describeIssues({ issues }, { limit: 3 }) ?? "";
  assert.match(described, /\(\+9 more\)$/);
});

test("zod 4's union shape is understood as well as zod 3's", () => {
  // The MCP server validates its own tool inputs with zod 4, which nests
  // branches under `errors` rather than `unionErrors`.
  const described = describeIssues({
    issues: [
      {
        code: "invalid_union",
        message: "Invalid input",
        path: ["operations", 0],
        errors: [
          [{ code: "invalid_value", message: 'Expected "world.update"', path: ["op"] }],
          [{ code: "custom", message: "id is required", path: ["id"] }],
        ],
      },
    ],
  });
  assert.equal(described, "operations.0.id: id is required");
});

test("nodes.update clears an optional field with null", () => {
  const patched = applyCanvasDocPatch(
    // biome-ignore lint/suspicious/noExplicitAny: fixture stands in for a parsed doc
    doc([iframeNode({ id: "calc-mobile-web" })]) as any,
    [
      {
        op: "nodes.update",
        id: "calc-mobile-web",
        changes: {
          frame: { kind: "device", preset: "iphone-safari", display: "clip" },
          viewport: null,
        },
      },
    ],
  );
  const node = patched.nodes[0];
  assert.equal(node?.kind, "iframe");
  if (node?.kind !== "iframe") return;
  // The preset owns the screen size once the stale viewport is out of the way.
  assert.deepEqual(node.viewport, { width: 284, height: 590 });
});

test("without null the stale viewport survives the merge and is rejected by name", () => {
  assert.throws(
    () =>
      applyCanvasDocPatch(
        // biome-ignore lint/suspicious/noExplicitAny: fixture stands in for a parsed doc
        doc([iframeNode({ id: "calc-mobile-web" })]) as any,
        [
          {
            op: "nodes.update",
            id: "calc-mobile-web",
            changes: { frame: { kind: "device", preset: "iphone-safari", display: "clip" } },
          },
        ],
      ),
    (error: Error) =>
      /nodes\.0 \(calc-mobile-web\)\.viewport\.height/.test(error.message) &&
      /full-height/.test(error.message),
  );
});

test("z is still the same zod the schemas were built with", () => {
  // Guards the union shapes above: a zod major bump changes them.
  assert.match(z.string().safeParse(1).error?.issues[0]?.code ?? "", /invalid_type/);
});
