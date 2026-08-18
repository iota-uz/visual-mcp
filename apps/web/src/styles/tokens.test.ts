/**
 * apps/web duplicates packages/canvas's palette rather than importing it —
 * see the header of ./tokens.css for why. Hand-kept sync rots silently, so
 * this test is the thing that notices.
 *
 * Divergences are legitimate, but they have to be *declared*: a pair marked
 * `diverge` is asserted to still differ, so re-syncing it by accident (or
 * "fixing" the contrast token back to the canvas value) fails here too.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Every `--name: value;` declaration in a stylesheet's :root block(s). */
function customProperties(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    const [, name, value] = match;
    // The regex can't match without both groups; the guard is for
    // `noUncheckedIndexedAccess`, which types tuple access as possibly undefined.
    if (name && value && !out.has(name)) out.set(name, value.trim());
  }
  return out;
}

const app = customProperties(read("./tokens.css"));
const canvas = customProperties(read("../../../../packages/canvas/src/theme.css"));

type Pair = { app: string; canvas: string; note?: string };

/** Values that must stay identical for the chrome to read as one product. */
const SYNCED: Pair[] = [
  { app: "--app-ink", canvas: "--vc-ink" },
  { app: "--app-ink-soft", canvas: "--vc-ink-soft" },
  { app: "--app-paper", canvas: "--vc-paper" },
  { app: "--app-white", canvas: "--vc-white" },
  { app: "--app-line", canvas: "--vc-line" },
  { app: "--app-font-mono", canvas: "--vc-mono" },
  { app: "--app-accent", canvas: "--vc-role-primary" },
  { app: "--app-success", canvas: "--vc-tone-live" },
  { app: "--app-warning", canvas: "--vc-tone-partial" },
  // Kind colours are the viewer's lane roles, so a canvas card and the
  // canvas it opens are tinted the same.
  { app: "--app-kind-canvas", canvas: "--vc-role-primary" },
  { app: "--app-kind-html", canvas: "--vc-role-support" },
  { app: "--app-kind-image", canvas: "--vc-role-secondary" },
  { app: "--app-kind-pdf", canvas: "--vc-role-exception" },
];

/** Deliberate departures. Re-syncing one of these is also a regression. */
const DIVERGENT: Pair[] = [
  {
    app: "--app-muted",
    canvas: "--vc-muted",
    note: "the canvas value is ~4.0:1 on white; the app carries body-sized hints in it and needs AA",
  },
  {
    app: "--app-font-body",
    canvas: "--vc-body",
    note: "the app names -apple-system and Segoe UI explicitly; the canvas leaves it to system-ui",
  },
];

describe("app tokens against the canvas palette", () => {
  it.each(SYNCED)("$app tracks $canvas", ({ app: appName, canvas: canvasName }) => {
    expect(app.get(appName), `${appName} is not declared`).toBeDefined();
    expect(canvas.get(canvasName), `${canvasName} is not declared`).toBeDefined();
    expect(app.get(appName)).toBe(canvas.get(canvasName));
  });

  it.each(DIVERGENT)("$app deliberately differs from $canvas", ({ app: a, canvas: c, note }) => {
    expect(app.get(a), `${a} is not declared`).toBeDefined();
    expect(canvas.get(c), `${c} is not declared`).toBeDefined();
    expect(app.get(a), note).not.toBe(canvas.get(c));
  });
});
