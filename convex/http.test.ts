/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

async function seedUserWithToken(
  t: ReturnType<typeof convexTest>,
): Promise<{ userId: Id<"users">; token: string }> {
  const token = "vct_test-token-plaintext";
  const tokenHash = await sha256Hex(token);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      googleSub: "bootstrap:mcp@iota.uz",
      email: "mcp@iota.uz",
      name: "MCP Caller",
      lastSeenAt: 0,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("mcpTokens", {
      userId,
      name: "test token",
      prefix: token.slice(0, 8),
      tokenHash,
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    }),
  );
  return { userId, token };
}

/** Extracts a JSON-RPC result/error from either a plain-JSON or SSE response body. */
async function parseJsonRpc(res: Response): Promise<{ result?: unknown; error?: unknown }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice("data:".length)
    .trim();
  if (!dataLine) throw new Error(`No SSE data line in response body: ${text}`);
  return JSON.parse(dataLine);
}

async function callTool(
  t: ReturnType<typeof convexTest>,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result?: unknown; error?: unknown }> {
  const res = await t.fetch("/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  expect(res.status).toBe(200);
  // Every successful call schedules tokens.touchLastUsed (see http.ts's
  // verifyAccessToken) via ctx.scheduler.runAfter(0, ...), which convex-test
  // runs on a real setTimeout. A microtask-only await can race ahead of that
  // callback, so give the real event loop one tick to start it (moving it
  // into "inProgress") before draining — otherwise it can fire after this
  // test's `t` instance is torn down, producing an unhandled "write outside
  // of transaction" error. (vi.useFakeTimers() is not an option here: the
  // MCP transport arms its own long-lived SSE keep-alive interval per
  // request, which fake timers' runAllTimers() treats as an infinite loop.)
  await new Promise((resolve) => setTimeout(resolve, 0));
  await t.finishInProgressScheduledFunctions();
  return parseJsonRpc(res);
}

describe("/mcp bearer-auth gate", () => {
  test("401s with an invalid_token challenge when no Authorization header is sent", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_workspaces", arguments: {} },
      }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_token" });
  });

  test("401s for a well-formed but unknown bearer token", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: "Bearer vct_never-minted" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_workspaces", arguments: {} },
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_token" });
  });

  test("401s for a revoked token", async () => {
    const t = convexTest(schema, modules);
    const { userId, token } = await seedUserWithToken(t);
    const tokenHash = await sha256Hex(token);
    const row = await t.run((ctx) =>
      ctx.db
        .query("mcpTokens")
        .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
        .unique(),
    );
    if (!row) throw new Error("seeded token row not found");
    await t.mutation(internal.tokens.revoke, { tokenId: row._id, userId });

    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_workspaces", arguments: {} },
      }),
    });
    expect(res.status).toBe(401);
  });

  // requireBearerAuth is configured here without `requiredScopes`, so a 403
  // (insufficient_scope) path is not currently reachable — only documenting
  // that, not fabricating a test for a code path that can't be exercised.

  test("a valid token is accepted (200, JSON-RPC result, not an error envelope)", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const response = await callTool(t, token, "list_workspaces", {});
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  });
});

describe("/mcp put_canvas_doc", () => {
  async function seedCanvas(t: ReturnType<typeof convexTest>, token: string) {
    const ws = await callTool(t, token, "create_workspace", { name: "Test WS" });
    const wsResult = ws.result as { content: Array<{ text: string }> };
    const { workspace_id } = JSON.parse(wsResult.content[0]?.text ?? "{}");

    const canvas = await callTool(t, token, "create_canvas", {
      workspace_id,
      title: "Doc Canvas",
      kind: "canvas",
    });
    const canvasResult = canvas.result as { content: Array<{ text: string }> };
    const { canvas_id } = JSON.parse(canvasResult.content[0]?.text ?? "{}");
    return canvas_id as string;
  }

  const baseDoc = {
    version: 1,
    title: "Test Canvas",
    lanes: [{ id: "l1", label: "Lane", role: "primary", height: 200 }],
    stages: [{ id: "s1", index: 0, label: "Stage" }],
    nodes: [
      {
        id: "n1",
        lane: "l1",
        stage: "s1",
        shape: "note",
        caption: { title: "Node" },
      },
    ],
    edges: [],
  };

  test("rejects a node with a <script> tag loudly, with a fixable error — not silently stripped", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const canvasId = await seedCanvas(t, token);

    const unsafeDoc = {
      ...baseDoc,
      nodes: [
        {
          ...baseDoc.nodes[0],
          content: { type: "html", html: "<div>hi</div><script>alert(1)</script>" },
        },
      ],
    };

    const response = await callTool(t, token, "put_canvas_doc", {
      canvas_id: canvasId,
      doc: unsafeDoc,
    });
    const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toMatch(/script/i);
  });

  test("rejects an on* event-handler attribute", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const canvasId = await seedCanvas(t, token);

    const unsafeDoc = {
      ...baseDoc,
      nodes: [
        {
          ...baseDoc.nodes[0],
          content: { type: "html", html: '<div onclick="doEvil()">hi</div>' },
        },
      ],
    };

    const response = await callTool(t, token, "put_canvas_doc", {
      canvas_id: canvasId,
      doc: unsafeDoc,
    });
    const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
  });

  test("accepts a well-formed doc with only static HTML/CSS/SVG", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const canvasId = await seedCanvas(t, token);

    const safeDoc = {
      ...baseDoc,
      nodes: [
        {
          ...baseDoc.nodes[0],
          content: { type: "html", html: '<div class="card"><svg><rect/></svg></div>' },
        },
      ],
    };

    const response = await callTool(t, token, "put_canvas_doc", {
      canvas_id: canvasId,
      doc: safeDoc,
    });
    const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}");
    expect(parsed.version).toBe(1);
  });
});
