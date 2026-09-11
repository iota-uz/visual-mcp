/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("orphan lease observer emits an alerting structured metric without deleting leases", async () => {
  const t = convexTest(schema, modules);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "metrics@iota.uz",
      name: "Metrics",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "metrics",
      name: "Metrics",
      createdBy: userId,
    });
    const assetId = await ctx.db.insert("assets", {
      scope: "workspace",
      workspaceId,
      slug: "kept",
      name: "Kept",
      tags: [],
      kind: "video",
      searchText: "kept",
      createdBy: userId,
      updatedAt: 0,
    });
    await ctx.db.insert("assetVersions", {
      assetId,
      revision: 1,
      objectKey: "kept-object",
      contentHash: "a".repeat(64),
      mimeType: "video/mp4",
      size: 1,
      originalFilename: "kept.mp4",
      sourceType: "upload",
      createdBy: userId,
    });
    for (const [leaseId, objectKey] of [
      ["kept", "kept-object"],
      ["orphan", "orphan-object"],
    ])
      await ctx.db.insert("assetObjectLeases", {
        leaseId,
        objectKey,
        createdAt: Date.now() - 2 * 60 * 60 * 1000,
      });
  });
  const result = await t.mutation(
    makeFunctionReference<"mutation">("assets:observeOrphanObjectLeases"),
    {},
  );
  expect(result).toEqual({ inspected: 2, orphaned: 1 });
  expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
    event: "video_operational_metric",
    metric: "orphan_leases",
    value: 1,
    alert: true,
  });
  expect(await t.run((ctx) => ctx.db.query("assetObjectLeases").take(10))).toHaveLength(2);
  warn.mockRestore();
});
