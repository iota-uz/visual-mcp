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
    ".vc-resize-handle",
  ]) {
    assert.match(immersiveRule, new RegExp(className.replace(".", "\\.")));
  }
});
