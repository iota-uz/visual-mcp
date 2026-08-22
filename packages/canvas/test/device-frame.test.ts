import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVICE_PRESETS,
  deviceFrameScale,
  deviceNodeHeightForWidth,
  deviceShellSize,
  renderDeviceFrame,
} from "../src/device-frame.js";
import { layoutCanvas } from "../src/layout.js";
import { PHONE_FRAME } from "../src/phone-frame.js";
import { renderCanvas } from "../src/render.js";
import { CanvasDocSchema, IframeNodeSchema } from "../src/types.js";

const iframeNode = (frame: Record<string, unknown>, viewport?: Record<string, number>) => ({
  id: "screen",
  kind: "iframe",
  rect: { x: 0, y: 0, w: 320, h: 760 },
  caption: { title: "Landing" },
  anchors: [],
  source: { entrypoint: "/src/screens/landing.html" },
  ...(viewport ? { viewport } : {}),
  frame,
});

const docWith = (node: unknown) =>
  CanvasDocSchema.parse({
    version: 2,
    title: "Device",
    world: { width: 1200, height: 900 },
    nodes: [node],
    edges: [],
  });

test("a device preset supplies its own viewport, so the author declares no sizes", () => {
  const node = IframeNodeSchema.parse(iframeNode({ kind: "device", preset: "iphone-safari" }));
  assert.deepEqual(node.viewport, DEVICE_PRESETS["iphone-safari"].viewport);
  assert.equal(node.frame.kind === "device" && node.frame.display, "clip");
  // Cosmetic defaults exist so a minimal frame still renders a real address bar.
  assert.equal(node.frame.kind === "device" && node.frame.time, "09:42");

  const desktop = IframeNodeSchema.parse(iframeNode({ kind: "device", preset: "desktop-safari" }));
  assert.deepEqual(desktop.viewport, { width: 1280, height: 800 });
});

test("the iPhone Safari shell keeps the canonical handset body", () => {
  const shell = deviceShellSize("iphone-safari");
  assert.equal(shell.width, PHONE_FRAME.width);
  assert.equal(shell.height, PHONE_FRAME.height);
  // Safari chrome comes out of the content area rather than growing the body.
  assert.equal(shell.screenHeight, PHONE_FRAME.screenHeight);
});

test("clip pins the preset height and full-height only ever grows it", () => {
  const preset = DEVICE_PRESETS["iphone-safari"];
  assert.throws(() =>
    IframeNodeSchema.parse(
      iframeNode({ kind: "device", preset: "iphone-safari" }, { width: 284, height: 1400 }),
    ),
  );
  const tall = IframeNodeSchema.parse(
    iframeNode(
      { kind: "device", preset: "iphone-safari", display: "full-height" },
      { width: 284, height: 1400 },
    ),
  );
  assert.equal(tall.viewport.height, 1400);
  // The body grows with the page; the chrome stays exactly as tall.
  const shell = deviceShellSize("iphone-safari", 1400);
  assert.equal(shell.height - deviceShellSize("iphone-safari").height, 1400 - preset.viewport.height);

  assert.throws(
    () =>
      IframeNodeSchema.parse(
        iframeNode(
          { kind: "device", preset: "iphone-safari", display: "full-height" },
          { width: 284, height: 200 },
        ),
      ),
    /full-height/,
  );
  assert.throws(
    () =>
      IframeNodeSchema.parse(
        iframeNode({ kind: "device", preset: "iphone-safari" }, { width: 390, height: 590 }),
      ),
    /284px wide/,
  );
});

test("every other frame kind still has to declare its own viewport", () => {
  assert.throws(
    () => IframeNodeSchema.parse(iframeNode({ kind: "browser" })),
    /viewport is required/,
  );
  assert.throws(
    () => IframeNodeSchema.parse(iframeNode({ kind: "phone", time: "09:42" })),
    /viewport is required/,
  );
});

test("node geometry derives from the shell, and the shell scales into the node", () => {
  const height = deviceNodeHeightForWidth("iphone-safari", PHONE_FRAME.width);
  assert.equal(height, PHONE_FRAME.height + PHONE_FRAME.captionHeight);
  assert.equal(deviceFrameScale("iphone-safari", PHONE_FRAME.width, height), 1);
  assert.equal(
    deviceFrameScale("iphone-safari", PHONE_FRAME.width / 2, 10_000),
    0.5,
    "the tighter axis wins",
  );
  // A full-height mockup is a taller shell, so the same node width scales it down.
  assert.ok(
    deviceFrameScale("iphone-safari", PHONE_FRAME.width, height, 1_400) <
      deviceFrameScale("iphone-safari", PHONE_FRAME.width, height),
  );
});

test("the iPhone shell renders an iOS status bar and Safari controls around live HTML", () => {
  const html = renderDeviceFrame({
    preset: "iphone-safari",
    screenContent: '<iframe src="/src/screens/landing.html"></iframe>',
    viewport: DEVICE_PRESETS["iphone-safari"].viewport,
    display: "clip",
    url: "acme.example/checkout",
    time: "10:15",
    scale: 1,
  });
  assert.match(html, /vc-device-shell vc-device-phone vc-device-iphone-safari/);
  assert.match(html, /data-display="clip"/);
  assert.match(html, /class="vc-device-status"/);
  assert.match(html, />10:15</);
  assert.match(html, /vc-device-toolbar-bottom/);
  assert.match(html, /acme\.example\/checkout/);
  // The screen stays a real iframe, not a picture of one.
  assert.match(html, /<iframe src="\/src\/screens\/landing\.html"><\/iframe>/);
  assert.match(html, /width:284px;height:590px/);
  assert.doesNotMatch(html, /vc-device-lights/);
});

test("the desktop shell renders window controls above the page", () => {
  const html = renderDeviceFrame({
    preset: "desktop-safari",
    screenContent: "<iframe></iframe>",
    viewport: DEVICE_PRESETS["desktop-safari"].viewport,
    display: "clip",
    scale: 0.5,
  });
  assert.match(html, /vc-device-window/);
  assert.match(html, /vc-device-lights/);
  assert.match(html, /vc-device-toolbar-top/);
  // No handset status bar on a desktop window.
  assert.doesNotMatch(html, /class="vc-device-status"/);
  assert.match(html, /example\.com/);
  assert.match(html, /--vc-device-scale:0\.5/);
});

test("a device address is escaped, never interpolated as markup", () => {
  const html = renderDeviceFrame({
    preset: "desktop-safari",
    screenContent: "",
    viewport: DEVICE_PRESETS["desktop-safari"].viewport,
    display: "clip",
    url: '<img src=x onerror="alert(1)">',
    scale: 1,
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("renderCanvas puts the shell inside the node and keeps the screen interactive", () => {
  const doc = docWith(
    iframeNode({ kind: "device", preset: "iphone-safari", url: "acme.example" }),
  );
  const { html } = renderCanvas(layoutCanvas(doc), { iframeLoading: "eager" });
  assert.match(html, /vc-shape-iframe-device/);
  assert.match(html, /vc-frame-device/);
  assert.match(html, /vc-device-shell/);
  assert.match(html, /<iframe[^>]+src="\/src\/screens\/landing\.html"/);
  assert.match(html, /acme\.example/);
});

test("a full-height device node renders the whole page inside the shell", () => {
  const doc = docWith(
    iframeNode(
      { kind: "device", preset: "desktop-safari", display: "full-height" },
      { width: 1280, height: 2400 },
    ),
  );
  const { html } = renderCanvas(layoutCanvas(doc), { iframeLoading: "eager" });
  assert.match(html, /data-display="full-height"/);
  assert.match(html, /width:1280px;height:2400px/);
  const shell = deviceShellSize("desktop-safari", 2400);
  assert.match(html, new RegExp(`--vc-device-height:${shell.height}px`));
});
