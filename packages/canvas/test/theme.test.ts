import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("immersive viewports hide every editor-only canvas control", async () => {
  const css = await readFile(new URL("../src/theme.css", import.meta.url), "utf8");
  const immersiveRule = css.match(
    /\.vc-viewport-host\.vc-immersive[\s\S]*?\{\s*display:\s*none;\s*\}/,
  )?.[0];
  assert.ok(immersiveRule);
  for (const className of [
    ".vc-minimap",
    ".vc-inspector",
    ".vc-iframe-guard",
    ".vc-iframe-exit",
    ".vc-toolbar",
    ".vc-resize-handle",
  ]) {
    assert.match(immersiveRule, new RegExp(className.replace(".", "\\.")));
  }
});

test("semantic zoom keeps labels and handles in screen space and hides secondary metadata", async () => {
  const css = await readFile(new URL("../src/theme.css", import.meta.url), "utf8");
  assert.match(css, /calc\(10px \* var\(--vc-camera-inverse\)\)/);
  assert.match(css, /calc\(8px \* var\(--vc-camera-inverse\)\)/);
  assert.match(css, /\.vc-viewport\[data-zoom="low"\] \.vc-caption-subtitle/);
});

test("every size the coarse-pointer block re-values is a token declared on :root", async () => {
  const css = await readFile(new URL("../src/theme.css", import.meta.url), "utf8");
  const coarse = css.match(/\.vc-viewport\[data-pointer="coarse"\]\s*\{([^}]*)\}/)?.[1];
  assert.ok(coarse, "the coarse-pointer block is missing");
  const names = [...coarse.matchAll(/(--vc-[\w-]+):/g)].map((match) => match[1] as string);
  assert.ok(names.length >= 8, `expected a size scale, found ${names.length}`);
  const root = css.match(/^:root\s*\{([\s\S]*?)\n\}/m)?.[1];
  assert.ok(root);
  for (const name of names) {
    // Nothing falls back at the use site — a token that exists only here
    // would render its control at `auto` and nothing would say so.
    assert.match(root, new RegExp(`${name}:`), `${name} is not declared on :root`);
  }
});

test("the interaction hint is reachable and correctly worded without a mouse", async () => {
  const css = await readFile(new URL("../src/theme.css", import.meta.url), "utf8");
  // Hover was the only thing that revealed it, so on a tablet the one
  // instruction an iframe node carries was permanently invisible.
  assert.match(css, /\.vc-node\.selected \.vc-iframe-guard span,\s*\n\.vc-kind-iframe:hover/);
  // Both wordings ship in the markup and CSS picks, because `.vc-world` is
  // replaced wholesale on every re-render.
  assert.match(css, /\[data-pointer="coarse"\] \.vc-iframe-guard \[data-hint="fine"\]/);
  assert.match(css, /\[data-pointer="coarse"\] \.vc-iframe-guard \[data-hint="coarse"\]/);
});

test("a coarse pointer keeps its own long press out of the node body's way", async () => {
  const css = await readFile(new URL("../src/theme.css", import.meta.url), "utf8");
  // The viewport suppresses the iOS callout; the one selectable region opts
  // back in, and gives that up again while nodes are being arranged.
  assert.match(css, /\.vc-viewport \{[\s\S]*?-webkit-touch-callout: none;/);
  assert.match(css, /\.vc-native-body \{[\s\S]*?-webkit-touch-callout: default;/);
  assert.match(css, /\.vc-viewport\.is-tool-move \.vc-native-body \{[\s\S]*?user-select: none;/);
});
