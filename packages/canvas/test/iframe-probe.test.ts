import assert from "node:assert/strict";
import test from "node:test";
import { IFRAME_HIT_TEST, iframeContentPoint, iframeHitTestSource } from "../src/iframe-probe.js";

test("iframeContentPoint maps a scaled visual click into layout coords", () => {
  const iframe = {
    getBoundingClientRect: () =>
      ({ left: 100, top: 50, right: 200, bottom: 250, width: 100, height: 200 }) as DOMRect,
    clientWidth: 390,
    clientHeight: 844,
  };
  assert.equal(iframeContentPoint(iframe, 90, 100), null);
  const at = iframeContentPoint(iframe, 150, 150);
  assert.ok(at);
  assert.equal(Math.round(at.x), 195);
  assert.equal(Math.round(at.y), 422);
});

test("the injected probe listens for hit-test and locate", () => {
  const source = iframeHitTestSource();
  assert.match(source, new RegExp(IFRAME_HIT_TEST));
  assert.match(source, /data-vc-id/);
  assert.match(source, /elementFromPoint/);
  assert.match(source, /visual-canvas:locate/);
});
