import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { applyPatch } from "../src/contracts.js";

test("a patch can atomically repair a document from an unsupported breaking revision", () => {
  const Current = z
    .object({ revision: z.literal("2"), payload: z.object({ enabled: z.boolean() }).strict() })
    .strict();
  const legacy = { revision: "1", payload: "legacy-shape" };
  const repaired = applyPatch(
    legacy,
    [
      { op: "test", path: "/revision", value: "1" },
      { op: "replace", path: "/revision", value: "2" },
      { op: "replace", path: "/payload", value: { enabled: true } },
    ],
    Current,
  );
  assert.deepEqual(repaired, { revision: "2", payload: { enabled: true } });
  assert.throws(() =>
    applyPatch(legacy, [{ op: "replace", path: "/revision", value: "2" }], Current),
  );
});
