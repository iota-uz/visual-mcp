import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { layoutCanvas, moveGroupNodes, patchNodeRect } from "../src/layout.js";
import { PHONE_FRAME, phoneFrameScale, phoneNodeHeightForWidth } from "../src/phone-frame.js";
import { escapeHtml, renderCanvas } from "../src/render.js";
import { anchorPoint, routeEdges } from "../src/router.js";
import { CanvasDocSchema } from "../src/types.js";
import {
  cameraGridStyle,
  canvasContentBounds,
  clampCanvasScale,
  fitCameraToBounds,
  fitPageCamera,
  iframeActiveCandidates,
  iframePrewarmCandidates,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
} from "../src/viewport.js";
import { anchors, fixture } from "./fixture.js";

test("explicit geometry is deterministic", () => {
  const a = layoutCanvas(fixture());
  const b = layoutCanvas(fixture());
  assert.deepEqual(a, b);
  assert.equal(a.width, 1000);
});
test("move/resize changes anchor coordinates and edge path", () => {
  const doc = fixture();
  const before = routeEdges(layoutCanvas(doc))[0]!.d;
  const changed = patchNodeRect(doc, "b", { x: 650, y: 200, w: 300, h: 350 });
  const canvas = layoutCanvas(changed);
  assert.notEqual(routeEdges(canvas)[0]!.d, before);
  const node = canvas.nodes[1]!;
  assert.deepEqual(anchorPoint(node, node.anchors[0]!), { x: 650, y: 375 });
});
test("moving a group translates every member by the exact same delta", () => {
  const doc = fixture();
  const before = doc.nodes.map((node) => ({ id: node.id, rect: { ...node.rect } }));
  const moved = moveGroupNodes(doc, "flow", 37, -19);
  for (const node of moved.nodes) {
    const original = before.find((candidate) => candidate.id === node.id);
    assert.ok(original);
    assert.equal(node.rect.x - original.rect.x, 37);
    assert.equal(node.rect.y - original.rect.y, -19);
    assert.equal(node.rect.w, original.rect.w);
    assert.equal(node.rect.h, original.rect.h);
  }
  const group = layoutCanvas(moved).groups[0];
  assert.deepEqual(group && { x: group.x, y: group.y, w: group.w, h: group.h }, {
    x: 137,
    y: 81,
    w: 800,
    h: 300,
  });
});
test("waypoint routing is preserved", () => {
  const doc = fixture();
  doc.edges[0]!.route.waypoints = [
    { x: 400, y: 30 },
    { x: 600, y: 30 },
  ];
  assert.match(routeEdges(layoutCanvas(doc))[0]!.d, /400 30 L 600 30/);
});
test("orthogonal routing leaves and enters through the declared anchor sides", () => {
  const doc = fixture();
  doc.nodes[0]!.anchors.push({ id: "bottom", side: "bottom", offset: 0.5 });
  doc.nodes[1]!.anchors.push({ id: "top", side: "top", offset: 0.5 });
  doc.nodes[1]!.rect.y = 320;
  doc.nodes[1]!.rect.h = 80;
  doc.edges[0]!.source = { nodeId: "a", anchorId: "bottom" };
  doc.edges[0]!.target = { nodeId: "b", anchorId: "top" };
  const path = routeEdges(layoutCanvas(doc))[0]!.d;
  assert.match(path, /^M 160 180 L 160 /);
  assert.match(path, /Q 800 [\d.]+ 800 [\d.]+ L 800 320$/);
});
test("orthogonal routing chooses a clear corridor around intervening nodes", () => {
  const doc = fixture();
  doc.nodes[1]!.rect = { x: 700, y: 100, w: 120, h: 80 };
  doc.nodes.push({
    id: "obstacle",
    kind: "native",
    shape: "note",
    laneId: "lane",
    stageId: "s1",
    rect: { x: 400, y: 90, w: 100, h: 100 },
    caption: { title: "Obstacle" },
    anchors,
  });
  const path = routeEdges(layoutCanvas(doc))[0]!.d;
  assert.match(path, / 78(?: |$)/);
  assert.doesNotMatch(path, /^M 220 140 L 700 140$/);
});
test("bezier routing follows the endpoint anchor directions", () => {
  const doc = fixture();
  doc.nodes[0]!.anchors.push({ id: "bottom", side: "bottom", offset: 0.5 });
  doc.nodes[1]!.anchors.push({ id: "top", side: "top", offset: 0.5 });
  doc.edges[0]!.route = { type: "bezier" };
  doc.edges[0]!.source = { nodeId: "a", anchorId: "bottom" };
  doc.edges[0]!.target = { nodeId: "b", anchorId: "top" };
  const path = routeEdges(layoutCanvas(doc))[0]!.d;
  assert.match(path, /^M 160 180 C 160 /);
  assert.match(path, /, 800 [-\d.]+, 800 100$/);
});
test("renderer escapes native text and emits sandboxed iframe", () => {
  const doc = fixture();
  doc.nodes[0]!.caption.title = "<script>x</script>";
  const html = renderCanvas(layoutCanvas(doc), { resolveIframeUrl: () => "/safe/screen" }).html;
  assert.ok(!html.includes("<script>"));
  assert.match(html, /sandbox="allow-scripts allow-forms"/);
  assert.match(html, /data-src="\/safe\/screen"/);
  assert.match(html, /class="vc-iframe-placeholder"/);
  assert.match(html, />Loading screen<\/span>/);
  assert.doesNotMatch(html, /<iframe/);
  assert.equal((html.match(/class="vc-node /g) ?? []).length, 2);
  assert.match(html, /class="vc-group"[^>]*data-group-id="flow"/);
});
test("renderer emits native image nodes without iframe readiness overhead", () => {
  const doc = fixture();
  doc.nodes = [
    {
      id: "reference",
      kind: "image",
      rect: { x: 20, y: 20, w: 320, h: 240 },
      caption: { title: "Reference" },
      anchors: [{ id: "right", side: "right", offset: 0.5 }],
      source: { path: "/assets/reference.webp" },
      fit: "cover",
      focalPosition: { x: 0.25, y: 0.75 },
      alt: "Reference <screen>",
    },
  ];
  doc.groups = [];
  doc.edges = [];
  const html = renderCanvas(layoutCanvas(doc), {
    iframeLoading: "eager",
    resolveImageUrl: () => "/i/token/assets/reference.webp?vcv=7",
  }).html;
  assert.match(html, /class="vc-node vc-kind-image/);
  assert.match(html, /src="\/i\/token\/assets\/reference.webp\?vcv=7"/);
  assert.match(html, /object-fit:cover;object-position:25% 75%/);
  assert.match(html, /alt="Reference &lt;screen&gt;"/);
  assert.doesNotMatch(html, /<iframe/);
});
test("exports can eagerly instantiate every iframe", () => {
  const html = renderCanvas(layoutCanvas(fixture()), { iframeLoading: "eager" }).html;
  assert.match(html, /loading="eager"/);
});
test("targeted exports keep non-target iframe runtimes inert", () => {
  const doc = fixture();
  const iframe = doc.nodes.find((node) => node.kind === "iframe");
  assert.ok(iframe);
  const targetHtml = renderCanvas(layoutCanvas(doc), {
    iframeLoading: "eager",
    shouldLoadIframe: (node) => node.id === iframe.id,
  }).html;
  assert.match(targetHtml, /loading="eager"/);

  const siblingHtml = renderCanvas(layoutCanvas(doc), {
    iframeLoading: "eager",
    shouldLoadIframe: () => false,
  }).html;
  assert.doesNotMatch(siblingHtml, /<iframe/);
  assert.match(siblingHtml, /class="vc-iframe-placeholder"/);
});
test("phone iframe renders one canonical canvas-owned shell and clean content viewport", () => {
  const html = renderCanvas(layoutCanvas(fixture()), { iframeLoading: "eager" }).html;
  assert.equal((html.match(/class="vc-phone-shell"/g) ?? []).length, 1);
  assert.equal((html.match(/class="vc-phone-status"/g) ?? []).length, 1);
  assert.equal((html.match(/class="vc-phone-screen"/g) ?? []).length, 1);
  assert.match(html, /class="vc-iframe-viewport" style="width:284px;height:642px"/);
  assert.match(html, /vc-phone-status-icons/);
  assert.doesNotMatch(html, /class="phone(?:-screen|-status)?"/);
});
test("phone frame scales uniformly and keeps its canonical aspect on resize", () => {
  assert.equal(
    phoneFrameScale(PHONE_FRAME.width, PHONE_FRAME.height + PHONE_FRAME.captionHeight),
    1,
  );
  assert.equal(phoneFrameScale(PHONE_FRAME.width / 2, 10_000), 0.5);
  assert.equal(phoneNodeHeightForWidth(155), PHONE_FRAME.height / 2 + PHONE_FRAME.captionHeight);
});
test("OSAGO mobile routes all use the same canvas phone chrome", async () => {
  const source = await readFile(
    new URL("../../../examples/osago-24/canvas.json", import.meta.url),
    "utf8",
  );
  const doc = CanvasDocSchema.parse(JSON.parse(source));
  const phoneNodes = doc.nodes.filter(
    (node) => node.kind === "iframe" && node.frame.kind === "phone",
  );
  assert.equal(phoneNodes.length, 17);
  for (const node of phoneNodes) {
    assert.deepEqual(node.viewport, { width: 284, height: 642 });
    assert.match(
      node.frame.kind === "phone" ? node.frame.time : "",
      /^(?:[01]\d|2[0-3]|\d):[0-5]\d$/,
    );
  }
});
test("grid follows pan and uses readable zoom levels", () => {
  const before = cameraGridStyle({ x: 28, y: 40, scale: 0.19 });
  const after = cameraGridStyle({ x: 218, y: -30, scale: 0.19 });
  assert.ok(before.size >= 18 && before.size <= 72);
  assert.equal(before.size, after.size);
  assert.notEqual(before.x, after.x);
  assert.notEqual(before.y, after.y);
});
test("camera supports both whole-canvas overviews and close inspection", () => {
  assert.equal(clampCanvasScale(0), 0.005);
  assert.equal(clampCanvasScale(0.001), 0.005);
  assert.equal(clampCanvasScale(1), 1);
  assert.equal(clampCanvasScale(4), 4);
  assert.equal(clampCanvasScale(12), 8);
});
test("camera coordinate conversion and pointer-anchored zoom are exact inverses", () => {
  const view = { x: 120, y: -40, scale: 0.75 };
  const world = { x: 420, y: 280 };
  const screen = worldToScreen(view, world);
  assert.deepEqual(screenToWorld(view, screen), world);
  const zoomed = zoomCameraAt(view, screen, 1.8);
  assert.deepEqual(worldToScreen(zoomed, world), screen);
});
test("fit policy preserves natural frame geometry and never enlarges automatically", () => {
  const mobile = fitCameraToBounds(
    { x: 100, y: 200, width: 390, height: 844 },
    { width: 1200, height: 900 },
    { heightRatio: 0.8 },
  );
  assert.ok((844 * mobile.scale) / 900 >= 0.75 && (844 * mobile.scale) / 900 <= 0.82);
  const small = fitCameraToBounds(
    { x: 0, y: 0, width: 200, height: 100 },
    { width: 1200, height: 900 },
  );
  assert.equal(small.scale, 1);

  const canvas = layoutCanvas(fixture());
  const fitted = fitPageCamera(canvas, { width: 1200, height: 800 });
  const bounds = canvasContentBounds(canvas);
  assert.ok(bounds.width * fitted.scale <= 1200 - 128 + 0.001);
});
test("iframe prewarm is bounded, nearest-first, and disabled at fit-all scale", () => {
  const nodes = [
    { id: "visible", kind: "iframe" as const, x: 100, y: 100, w: 200, h: 300 },
    { id: "nearby", kind: "iframe" as const, x: 1_800, y: 100, w: 200, h: 300 },
    { id: "native", kind: "native" as const, x: 200, y: 100, w: 200, h: 300 },
    { id: "far", kind: "iframe" as const, x: 5_000, y: 100, w: 200, h: 300 },
  ];
  assert.deepEqual(
    iframePrewarmCandidates(nodes, { x: 0, y: 0, scale: 0.5 }, { width: 800, height: 600 }, 2),
    ["visible", "nearby"],
  );
  assert.deepEqual(
    iframePrewarmCandidates(nodes, { x: 0, y: 0, scale: 0.2 }, { width: 800, height: 600 }),
    [],
  );
  assert.deepEqual(
    iframeActiveCandidates(nodes, { x: 0, y: 0, scale: 0.2 }, { width: 800, height: 600 }),
    [],
  );
});
test("resident iframe lifecycle follows the camera independently of prewarm limits", () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({
    id: `screen-${index}`,
    kind: "iframe" as const,
    x: index * 300,
    y: 100,
    w: 240,
    h: 360,
  }));
  const nearStart = iframeActiveCandidates(
    nodes,
    { x: 0, y: 0, scale: 1 },
    { width: 800, height: 600 },
  );
  const nearEnd = iframeActiveCandidates(
    nodes,
    { x: -2_500, y: 0, scale: 1 },
    { width: 800, height: 600 },
  );
  assert.ok(nearStart.includes("screen-0"));
  assert.ok(!nearStart.includes("screen-11"));
  assert.ok(!nearEnd.includes("screen-0"));
  assert.ok(nearEnd.includes("screen-11"));
});
test("OSAGO bundle includes participant actors and their screen connections", async () => {
  const source = await readFile(
    new URL("../../../examples/osago-24/canvas.json", import.meta.url),
    "utf8",
  );
  const doc = CanvasDocSchema.parse(JSON.parse(source));
  assert.equal(doc.lanes.find((lane) => lane.id === "people")?.role, "actors");
  assert.equal(
    doc.nodes.filter((node) => node.kind === "native" && node.shape === "actor").length,
    14,
  );
  const actorEdges = doc.edges.filter((edge) => edge.kind === "actor");
  assert.equal(actorEdges.length, 18);
  assert.ok(actorEdges.some((edge) => edge.target.nodeId === "culprit-scene"));
  assert.ok(actorEdges.some((edge) => edge.target.nodeId === "victim-qr"));
  assert.ok(actorEdges.some((edge) => edge.bidirectional));
  const victim = doc.nodes.find((node) => node.id === "s5-actor-victim");
  assert.equal(victim?.rect.x, 3199);
  assert.equal(victim?.rect.y, 82);
  assert.deepEqual(victim?.kind === "native" ? victim.body?.progress : undefined, {
    value: 1,
    total: 8,
    current: true,
  });
  const victimEdge = doc.edges.find((edge) => edge.id === "s5-actor-victim-screen");
  assert.equal(victimEdge?.source.anchorId, "screen");
  assert.equal(victimEdge?.target.anchorId, "actor-in");
  assert.equal(victimEdge?.route.waypoints?.length, 3);
});
test("actor renderer preserves the reference card composition", async () => {
  const source = await readFile(
    new URL("../../../examples/osago-24/canvas.json", import.meta.url),
    "utf8",
  );
  const doc = CanvasDocSchema.parse(JSON.parse(source));
  const html = renderCanvas(layoutCanvas(doc)).html;
  assert.match(html, /vc-person-icon vc-person-victim/);
  assert.match(html, /vc-person-progress/);
  assert.match(html, />1 \/ 8<\/span>/);
  assert.doesNotMatch(
    html.match(/data-node-id="s5-actor-victim"[\s\S]*?<\/div>/)?.[0] ?? "",
    /vc-badge/,
  );
});
test("escapeHtml escapes markup", () =>
  assert.equal(escapeHtml(`<b>"it's"</b> &`), "&lt;b&gt;&quot;it&#39;s&quot;&lt;/b&gt; &amp;"));
