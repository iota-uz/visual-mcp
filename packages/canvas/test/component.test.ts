import assert from "node:assert/strict";
import test from "node:test";
import {
  CanvasComponentBodySchema,
  componentSize,
  extractComponent,
  insertComponent,
} from "../src/component.js";
import { CanvasDocSchema } from "../src/types.js";

const anchors = [
  { id: "left", side: "left" as const, offset: 0.5 },
  { id: "right", side: "right" as const, offset: 0.5 },
];

const note = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "native" as const,
  shape: "note" as const,
  rect: { x, y, w: 160, h: 100 },
  caption: { title: id },
  anchors,
  ...extra,
});

const edge = (id: string, from: string, to: string) => ({
  id,
  source: { nodeId: from, anchorId: "right" },
  target: { nodeId: to, anchorId: "left" },
  kind: "main" as const,
  route: { type: "orthogonal" as const },
});

const page = () =>
  CanvasDocSchema.parse({
    version: 2,
    title: "Source",
    world: { width: 1600, height: 900 },
    lanes: [{ id: "lane", label: "Lane", role: "primary", rect: { x: 0, y: 0, w: 1600, h: 900 } }],
    stages: [{ id: "stage", index: 0, label: "Stage", rect: { x: 0, y: 0, w: 1600, h: 900 } }],
    nodes: [
      note("login", 400, 300, { laneId: "lane", stageId: "stage" }),
      note("verify", 700, 360, { laneId: "lane", stageId: "stage" }),
      note("unrelated", 1200, 300, { laneId: "lane", stageId: "stage" }),
    ],
    edges: [edge("login-verify", "login", "verify"), edge("verify-out", "verify", "unrelated")],
  });

const target = () =>
  CanvasDocSchema.parse({
    version: 2,
    title: "Target",
    world: { width: 1600, height: 900 },
    nodes: [note("login", 0, 0)],
    edges: [],
  });

test("extraction rebases geometry and keeps only the edges inside the set", () => {
  const body = extractComponent(page(), ["login", "verify"]);
  assert.deepEqual(
    body.nodes.map((node) => [node.id, node.rect.x, node.rect.y]),
    [
      ["login", 0, 0],
      ["verify", 300, 60],
    ],
  );
  // "verify-out" leaves the set, so it describes the page, not the component.
  assert.deepEqual(
    body.edges.map((candidate) => candidate.id),
    ["login-verify"],
  );
  // Lane and stage are page context and must not travel.
  assert.equal(body.nodes[0]?.laneId, undefined);
  assert.equal(body.nodes[0]?.stageId, undefined);
  assert.deepEqual(componentSize(body), { width: 460, height: 160 });
});

test("a component may not carry page context or dangling edges", () => {
  assert.throws(
    () =>
      CanvasComponentBodySchema.parse({
        nodes: [note("a", 0, 0, { laneId: "lane" })],
        edges: [],
      }),
    /lane or stage/,
  );
  assert.throws(
    () =>
      CanvasComponentBodySchema.parse({
        nodes: [note("a", 0, 0)],
        edges: [edge("out", "a", "elsewhere")],
      }),
    /not part of this component/,
  );
});

test("insertion remaps every id, re-binds internal edges and lands at the point", () => {
  const body = extractComponent(page(), ["login", "verify"]);
  const inserted = insertComponent(target(), body, {
    at: { x: 500, y: 200 },
    idPrefix: "flow",
    laneId: undefined,
  });

  // "login" already exists in the target: the copy gets its own id and the
  // original is untouched.
  assert.equal(inserted.nodeIds.login, "flow-login");
  assert.equal(inserted.doc.nodes[0]?.id, "login");
  assert.deepEqual(
    inserted.doc.nodes.map((node) => [node.id, node.rect.x, node.rect.y]),
    [
      ["login", 0, 0],
      ["flow-login", 500, 200],
      ["flow-verify", 800, 260],
    ],
  );
  const copied = inserted.doc.edges[0];
  assert.equal(copied?.id, "flow-login-verify");
  assert.equal(copied?.source.nodeId, "flow-login");
  assert.equal(copied?.target.nodeId, "flow-verify");
  CanvasDocSchema.parse(inserted.doc);
});

test("two insertions of one component are independent", () => {
  const body = extractComponent(page(), ["login", "verify"]);
  const first = insertComponent(target(), body, { at: { x: 0, y: 0 }, idPrefix: "a" });
  const second = insertComponent(first.doc, body, { at: { x: 900, y: 0 }, idPrefix: "a" });

  const ids = second.doc.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, "no id collided");
  assert.deepEqual(ids, ["login", "a-login", "a-verify", "a-login-2", "a-verify-2"]);
  assert.deepEqual(
    second.doc.edges.map((candidate) => candidate.id),
    ["a-login-verify", "a-login-verify-2"],
  );
  // Editing one copy leaves the other alone.
  const moved = {
    ...second.doc,
    nodes: second.doc.nodes.map((node) =>
      node.id === "a-login" ? { ...node, rect: { ...node.rect, x: 42 } } : node,
    ),
  };
  assert.equal(moved.nodes.find((node) => node.id === "a-login-2")?.rect.x, 900);
  CanvasDocSchema.parse(second.doc);
});

test("insertion can attach page context and group what it created", () => {
  const body = extractComponent(page(), ["login", "verify"]);
  const source = page();
  const inserted = insertComponent(source, body, {
    at: { x: 100, y: 700 },
    laneId: "lane",
    stageId: "stage",
    groupLabel: "Login flow",
    idPrefix: "copy",
  });
  assert.equal(inserted.doc.nodes.at(-1)?.laneId, "lane");
  assert.equal(inserted.groupId, "copy-group");
  assert.deepEqual(inserted.doc.groups.at(-1)?.nodeIds, ["copy-login", "copy-verify"]);
  CanvasDocSchema.parse(inserted.doc);
});
