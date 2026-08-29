/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { sha256Hex } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const secret = "test-agent-gateway-secret";

beforeEach(() => {
  process.env.AGENT_GATEWAY_SECRET = secret;
});
afterEach(() => {
  delete process.env.AGENT_GATEWAY_SECRET;
});

function request(body: unknown, authorization = `Bearer ${secret}`) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify(body),
  };
}

describe("private agent gateway", () => {
  test("rejects callers without the service secret", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/agent-gateway",
      request({ operation: "query", name: "assets:listInternal" }, "Bearer wrong"),
    );
    expect(response.status).toBe(401);
  });

  test("does not dispatch functions outside the fixed allowlist", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/agent-gateway",
      request({ operation: "query", name: "users:listMine", args: {} }),
    );
    expect(response.status).toBe(404);
  });

  test("exposes asset cleanup and promoted upload lookups to the MCP gateway", async () => {
    const t = convexTest(schema, modules);
    const objectResponse = await t.fetch(
      "/agent-gateway",
      request({
        operation: "query",
        name: "assets:objectKeyReferenced",
        args: { objectKey: "blobs/sha256/aa/unreferenced" },
      }),
    );
    expect(objectResponse.status).toBe(200);
    await expect(objectResponse.json()).resolves.toEqual({ result: false });

    const createdBy = await t.run((ctx) =>
      ctx.db.insert("users", { email: "agent@iota.uz", name: "Agent", lastSeenAt: 0 }),
    );
    const { canvasId } = await t.mutation(internal.canvases.upsertByRef, {
      ref: "sandbox/replay-check",
      createdBy,
    });
    const sourceStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["staged"], { type: "image/png" })),
    );

    const response = await t.fetch(
      "/agent-gateway",
      request({
        operation: "query",
        name: "canvases:promotedUploadReplay",
        args: { canvasId, path: "/assets/staged.png", sourceStorageId },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: null });
  });

  test("validates MCP bearer hashes and returns only the principal", async () => {
    const t = convexTest(schema, modules);
    const tokenHash = await sha256Hex("vct_test_token");
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "agent@iota.uz", name: "Agent", lastSeenAt: 0 }),
    );
    await t.run((ctx) =>
      ctx.db.insert("mcpTokens", {
        userId,
        name: "Agent",
        prefix: "vct_test",
        tokenHash,
        expiresAt: Date.now() + 60_000,
      }),
    );
    const response = await t.fetch(
      "/agent-gateway",
      request({ operation: "authenticate", args: { tokenHash } }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { userId, email: "agent@iota.uz" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  });
});
