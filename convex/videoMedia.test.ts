/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { presignSizedUpload } from "./lib/objectStore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
test("gateway upload signing failure preserves unknown effect after durable reservation", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const principalId = await ctx.db.insert("users", {
      email: "gateway@iota.uz",
      name: "Gateway",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Gateway",
      slug: "gateway",
      createdBy: principalId,
    });
    const tokenId = await ctx.db.insert("mcpTokens", {
      userId: principalId,
      name: "fixture",
      prefix: "fixture",
      tokenHash: "a".repeat(64),
      expiresAt: Date.now() + 60000,
    });
    return { workspaceId, tokenId };
  });
  vi.stubEnv("AGENT_GATEWAY_SECRET", "fixture-secret");
  vi.stubEnv("S3_ASSET_ENDPOINT", "");
  const response = await t.fetch("/agent-gateway", {
    method: "POST",
    headers: { authorization: "Bearer fixture-secret", "content-type": "application/json" },
    body: JSON.stringify({
      operation: "video",
      args: {
        tokenId: ids.tokenId,
        name: "prepareUpload",
        input: {
          workspaceId: ids.workspaceId,
          idempotencyKey: "durable-before-sign",
          filename: "fixture.png",
          mimeType: "image/png",
          sizeBytes: 2,
          sha256: "a".repeat(64),
          source: "upload",
        },
      },
    }),
  });
  const payload = await response.json();
  expect(payload.result.error.code).toBe("BACKEND_UNAVAILABLE");
  expect(payload.result.error.effect).toBe("unknown");
  expect(await t.run((ctx) => ctx.db.query("videoMediaUploads").collect())).toHaveLength(1);
});
afterEach(() => vi.unstubAllEnvs());
test("2GB transport signature binds exact content length without moving bytes through Convex", async () => {
  vi.stubEnv("S3_ASSET_ENDPOINT", "https://storage.example.com");
  vi.stubEnv("S3_ASSET_BUCKET", "test");
  vi.stubEnv("S3_ASSET_ACCESS_KEY_ID", "fixture");
  vi.stubEnv("S3_ASSET_SECRET_ACCESS_KEY", "fixture");
  const url = new URL(await presignSizedUpload("fixture", 2000000000));
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
  await expect(presignSizedUpload("fixture", 2000000001)).rejects.toThrow("size");
});
test("media receipt deduplicates exact input and rejects key reuse", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const principalId = await ctx.db.insert("users", {
      email: "media@iota.uz",
      name: "Media",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "media",
      name: "Media",
      createdBy: principalId,
    });
    return { principalId, workspaceId };
  });
  const args = {
    ...ids,
    idempotencyKey: "once",
    filename: "video.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2000000000,
    sha256: "a".repeat(64),
    source: "upload",
  };
  const ref = makeFunctionReference<"mutation">("videoMedia:reserve");
  const a = await t.mutation(ref, args),
    b = await t.mutation(ref, args);
  expect(a._id).toBe(b._id);
  await expect(t.mutation(ref, { ...args, sizeBytes: 1 })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
