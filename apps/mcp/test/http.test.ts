import { describe, expect, test } from "vitest";
import type { ActionCtx } from "../../../convex/_generated/server.js";
import { createApp } from "../src/index.js";

const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function gateway(authenticated = true) {
  return {
    authenticate: async () =>
      authenticated
        ? {
            userId: "user" as never,
            tokenId: "token" as never,
            email: "agent@iota.uz",
            expiresAt: Date.now() + 60_000,
          }
        : null,
    actionContext: () =>
      ({
        runQuery: async () => null,
        runMutation: async () => null,
        storage: {},
      }) as unknown as ActionCtx,
  } as never;
}

function parseMcpResponse(text: string): unknown {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const data = text
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  if (!data) throw new Error("SSE response has no data event");
  return JSON.parse(data);
}

describe("Railway MCP service", () => {
  test("reports health without contacting Convex", async () => {
    const response = await createApp(gateway()).request("/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("rejects invalid bearer tokens before parsing MCP", async () => {
    const response = await createApp(gateway(false)).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer invalid" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  test("rejects subscriptions immediately", async () => {
    const response = await createApp(gateway()).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "subscriptions/listen", params: {} }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 7, error: { code: -32601 } });
  });

  test("serves the complete tool catalog through the stateless transport", async () => {
    const response = await createApp(gateway()).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("canvas_save");
    expect(text).toContain("canvas_file_search");
    expect(text).toContain("asset_list");
    expect(text).toContain("becomes reusable workspace assets automatically");
    expect(text).not.toContain("component_insert");
    expect(text).not.toContain("component_save");
  });

  test("publishes the bounded file and snapshot contracts exactly", async () => {
    const response = await createApp(gateway()).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const payload = parseMcpResponse(await response.text()) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: { properties?: Record<string, unknown> };
          outputSchema: { properties?: Record<string, unknown> };
        }>;
      };
    };
    const byName = new Map(payload.result.tools.map((tool) => [tool.name, tool]));
    expect(byName.get("canvas_edit")?.inputSchema.properties).toHaveProperty("edits");
    expect(byName.get("canvas_edit")?.inputSchema.properties).not.toHaveProperty("file_path");
    expect(byName.get("canvas_file_get")?.inputSchema.properties).toHaveProperty("requests");
    expect(byName.get("canvas_file_search")?.outputSchema.properties).toHaveProperty("skipped");
    expect(byName.get("canvas_snapshot")?.inputSchema.properties).toHaveProperty("response_mode");
    expect(byName.get("canvas_snapshot")?.outputSchema.properties).not.toHaveProperty("embed");
  });
});
