/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
test("generated revision CAS preserves concurrent head and stores candidate", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      name: "CAS",
      email: "cas@iota.uz",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "CAS",
      slug: "cas",
      createdBy: ownerUserId,
    });
    const jobId = await ctx.db.insert("videoJobs", {
      workspaceId,
      principalId: ownerUserId,
      idempotencyKey: "edit",
      inputHash: "h",
      request: "{}",
      kind: "image",
      state: "running",
      fence: 1,
      createdAt: 0,
      updatedAt: 0,
      stage: "dispatched",
    });
    return { ownerUserId, workspaceId, jobId };
  });
  const commit = makeFunctionReference<"mutation">("assets:commitAssetVersion");
  const base = {
    scope: "workspace",
    ownerUserId: ids.ownerUserId,
    workspaceId: ids.workspaceId,
    slug: "original",
    name: "Original",
    tags: [],
    kind: "image",
    mimeType: "image/png",
    size: 1,
    originalFilename: "image.png",
    sourceType: "upload",
  };
  const first = await t.mutation(commit, {
    ...base,
    objectKey: "first",
    contentHash: "a".repeat(64),
  });
  const second = await t.mutation(commit, {
    ...base,
    objectKey: "second",
    contentHash: "b".repeat(64),
  });
  const candidate = await t.mutation(commit, {
    ...base,
    objectKey: "candidate",
    contentHash: "c".repeat(64),
    expectedHeadVersionId: first.versionId,
    candidateSlug: "candidate-job",
    provenance: { kind: "provider", jobId: ids.jobId, provider: "openai", actualModel: null },
  });
  expect(candidate.assetId).not.toBe(first.assetId);
  expect(candidate.headAdvanced).toBe(false);
  const head = await t.run((ctx) =>
    ctx.db
      .query("assetVersions")
      .withIndex("by_asset_revision", (q) => q.eq("assetId", first.assetId))
      .order("desc")
      .first(),
  );
  expect(head?._id).toBe(second.versionId);
  const advanced = await t.mutation(commit, {
    ...base,
    objectKey: "advanced",
    contentHash: "d".repeat(64),
    expectedHeadVersionId: second.versionId,
    candidateSlug: "candidate-job-2",
    provenance: { kind: "provider", jobId: ids.jobId, provider: "openai", actualModel: null },
  });
  expect(advanced.assetId).toBe(first.assetId);
  expect(advanced.headAdvanced).toBe(true);
});
