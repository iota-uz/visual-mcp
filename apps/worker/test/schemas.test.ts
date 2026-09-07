import assert from "node:assert/strict";
import { test } from "node:test";
import { SnapshotRequestSchema } from "../src/schemas.js";

const base = {
  sources: [],
  entrypoint: "/src/__export-0.html",
  target: { type: "canvas" as const },
  upload: { putUrl: "https://upload.test/one" },
};

test("SnapshotRequest defaults to the single-capture PNG contract", () => {
  const parsed = SnapshotRequestSchema.parse(base);
  assert.equal(parsed.format, "png");
  assert.equal(parsed.entrypoints, undefined);
});

test("SnapshotRequest accepts a multi-entrypoint PDF", () => {
  const parsed = SnapshotRequestSchema.parse({
    ...base,
    format: "pdf",
    entrypoints: ["/src/__export-0.html", "/src/__export-1.html"],
  });
  assert.equal(parsed.format, "pdf");
  assert.equal(parsed.entrypoints?.length, 2);
});

test("SnapshotRequest rejects entrypoints without format=pdf", () => {
  const result = SnapshotRequestSchema.safeParse({
    ...base,
    entrypoints: ["/src/__export-0.html"],
  });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.error?.issues.map((issue) => issue.path),
    [["entrypoints"]],
  );
});
