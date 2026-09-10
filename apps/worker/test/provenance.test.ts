import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIdentity } from "../src/video/provenance.js";

test("only an explicit hexadecimal build identity can leave the parent environment", () => {
  assert.equal(buildIdentity(undefined), null);
  assert.equal(buildIdentity("an arbitrary credential-like value"), null);
  assert.equal(buildIdentity("A".repeat(40)), "a".repeat(40));
});
