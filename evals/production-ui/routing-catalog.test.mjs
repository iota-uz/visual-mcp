import assert from "node:assert/strict";
import test from "node:test";
import { applyDescriptionVariant, catalogMetrics, longContextFiller } from "./routing-catalog.mjs";

const description =
  "Use: Reads one canvas. Do not use: for writes. Prefer: this tool for canvas reads. Side effects: none. Retry: safe. Errors: stable.";

test("current variant preserves freshness reinforcement", () => {
  assert.equal(applyDescriptionVariant(description, "current"), description);
});

test("variants isolate base and routing guidance", () => {
  assert.equal(applyDescriptionVariant(description, "base-only"), "Reads one canvas");
  assert.equal(
    applyDescriptionVariant(description, "compact-routing"),
    "Use: Reads one canvas. Do not use: for writes. Prefer: this tool for canvas reads.",
  );
});

test("catalog metrics and filler are deterministic", () => {
  assert.deepEqual(catalogMetrics([{ name: "x", description: "read" }]), {
    tools: 1,
    characters: 35,
    estimated_tokens: 9,
  });
  assert.equal(longContextFiller(37).length, 37);
  assert.equal(longContextFiller(37), longContextFiller(37));
});
