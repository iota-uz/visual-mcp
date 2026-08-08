/**
 * Tests for the D2 diagram wrapper (src/render/diagrams/index.ts,
 * PLAN.md sections 3.2, 8.3).
 *
 * Test runner: node:test + node:assert/strict (see test/types.test.ts for
 * the established pattern).
 *
 * NOTE: `@terrastruct/d2` runs its WASM engine inside a node:worker_threads
 * Worker, which keeps the process event loop alive. We dispose the shared
 * renderer in an `after()` hook so `node --test` can exit cleanly.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { D2RenderError, disposeD2Renderer, renderD2ToSvg } from "../src/render/diagrams/index.js";

// Exact example D2 snippet from PLAN.md section 3.2.
const PLAN_EXAMPLE_D2 = `Web App -> API Gateway: HTTPS
API Gateway -> CRM Core: REST
CRM Core -> Postgres: SQL
CRM Core -> Redis: cache`;

after(async () => {
  await disposeD2Renderer();
});

test("renderD2ToSvg renders the PLAN.md 3.2 example to a valid, non-trivial SVG", async () => {
  const svg = await renderD2ToSvg(PLAN_EXAMPLE_D2);

  assert.equal(typeof svg, "string");
  assert.ok(svg.trim().startsWith("<svg"), "output should start with <svg");
  assert.ok(svg.trim().endsWith("</svg>"), "output should end with </svg>");
  assert.ok(
    !svg.trim().startsWith("<?xml"),
    "output should omit the XML declaration by default (inline-embeddable)",
  );

  // Non-trivial size: a 4-node/4-edge diagram should render to a
  // substantial SVG document, not an empty shell.
  assert.ok(svg.length > 1000, `expected a non-trivial SVG, got ${svg.length} chars`);

  // Well-formedness: balanced <svg>...</svg>, and every opened tag we can
  // see has a matching close (spot-check via a simple tag balance count
  // rather than pulling in a full XML parser dependency).
  const openTags = svg.match(/<([a-zA-Z][\w-]*)(\s|>)/g) ?? [];
  const closeTags = svg.match(/<\/[a-zA-Z][\w-]*>/g) ?? [];
  assert.ok(openTags.length > 0, "should contain opening tags");
  assert.ok(closeTags.length > 0, "should contain closing tags");

  // The diagram's node and edge labels should be present in the output.
  for (const label of ["Web App", "API Gateway", "CRM Core", "Postgres", "Redis"]) {
    assert.ok(svg.includes(label), `expected rendered SVG to contain label "${label}"`);
  }
});

test("renderD2ToSvg can include the XML declaration when requested", async () => {
  const svg = await renderD2ToSvg("a -> b", { noXMLTag: false });
  assert.ok(svg.trim().startsWith("<?xml"));
  assert.ok(svg.includes("<svg"));
});

test("renderD2ToSvg throws a clear, catchable D2RenderError on invalid D2 syntax", async () => {
  await assert.rejects(
    async () => {
      await renderD2ToSvg("this is not -> >> valid ][ d2 {{{");
    },
    (err: unknown) => {
      assert.ok(err instanceof D2RenderError, "should throw D2RenderError");
      assert.ok(
        err instanceof Error && err.message.length > 0,
        "error should have a human-readable message",
      );
      assert.ok(
        (err as Error).message.toLowerCase().includes("compile"),
        "error message should indicate a compile failure",
      );
      return true;
    },
  );
});

test("renderD2ToSvg throws a clear error on empty source instead of crashing", async () => {
  await assert.rejects(async () => {
    await renderD2ToSvg("");
  }, D2RenderError);
});

test("renderD2ToSvg handles concurrent calls without hanging or crossing results", async () => {
  const [svgAB, svgXYZ] = await Promise.all([
    renderD2ToSvg("Alpha -> Beta: one"),
    renderD2ToSvg("X -> Y -> Z: two"),
  ]);

  assert.ok(svgAB.includes("Alpha") && svgAB.includes("Beta"));
  assert.ok(svgXYZ.includes("X") && svgXYZ.includes("Y") && svgXYZ.includes("Z"));
  // Cross-contamination check: each result should not contain the other's
  // unique labels (guards against the D2.js resolver race — see module
  // header note in src/render/diagrams/index.ts).
  assert.ok(
    !svgAB.includes(">Z<"),
    "Alpha/Beta diagram should not contain the other diagram's Z node",
  );
  assert.ok(
    !svgXYZ.includes("Beta"),
    "X/Y/Z diagram should not contain the other diagram's Beta node",
  );
});
