import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentContext } from "../src/gateway.js";
import { createApp } from "../src/index.js";

const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

beforeEach(() => vi.stubEnv("SPA_ORIGIN", "https://canvas.example"));
afterEach(() => vi.unstubAllEnvs());

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
      }) as unknown as AgentContext,
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

  test("checkpoints through the gateway without requiring a direct Convex action", async () => {
    const context = {
      runQuery: async () => null,
      runMutation: async () => ({
        canvasId: "canvas",
        versionId: "version",
        version: 2,
        draftRevision: 7,
        dirty: false,
        published: true,
      }),
      storage: {},
    } as unknown as AgentContext;
    const checkpointGateway = {
      ...gateway(),
      actionContext: () => context,
    } as never;

    const response = await createApp(checkpointGateway).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "canvas_checkpoint", arguments: { ref: "workspace/canvas" } },
      }),
    });
    const payload = parseMcpResponse(await response.text()) as {
      result: { isError?: boolean; structuredContent?: Record<string, unknown> };
    };

    expect(payload.result.isError, JSON.stringify(payload)).not.toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      status: "ok",
      ref: "workspace/canvas",
      version: 2,
      draft_revision: 7,
    });
  });

  test("saves through the gateway without requiring a direct Convex action", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        canvasId: "canvas",
        workspaceSlug: "workspace",
        canvasSlug: "canvas",
        created: true,
        overwroteOtherAuthor: false,
        themeId: "clean-saas",
      })
      .mockResolvedValueOnce({
        versionId: "version",
        version: 1,
        previousVersion: 0,
        changed: true,
        draftRevision: 1,
        dirty: false,
        promotedAssets: [],
      });
    const context = {
      runQuery: async () => ({
        canvas: {
          kind: "canvas",
          title: "Canvas",
          version: 1,
          draft_revision: 1,
          dirty: false,
          visibility: "private",
          public_slug: undefined,
          thumbnail_url: null,
        },
        storage: { used_bytes: 1, quota_bytes: 1_000_000 },
      }),
      runMutation,
      storage: {
        store: async () => "storage",
        delete: async () => null,
      },
    } as unknown as AgentContext;
    const saveGateway = { ...gateway(), actionContext: () => context } as never;

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "canvas_save",
        arguments: {
          ref: "workspace/canvas",
          kind: "canvas",
          title: "Canvas",
          doc: {
            version: 3,
            defaultPageId: "page",
            pages: [
              {
                id: "page",
                title: "Page",
                order: 0,
                doc: {
                  version: 2,
                  title: "Page",
                  world: { width: 1280, height: 800 },
                  lanes: [],
                  stages: [],
                  labels: [],
                  nodes: [],
                  groups: [],
                  edges: [],
                },
              },
            ],
            prototype: { interactions: [] },
          },
        },
      },
    });
    const response = await createApp(saveGateway).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body,
    });
    const payload = parseMcpResponse(await response.text()) as {
      result: { isError?: boolean; structuredContent?: Record<string, unknown> };
    };

    expect(payload.result.isError, JSON.stringify(payload)).not.toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      status: "ok",
      ref: "workspace/canvas",
      version: 1,
      draft_revision: 1,
    });

    runMutation
      .mockReset()
      .mockResolvedValueOnce({
        canvasId: "canvas",
        workspaceSlug: "workspace",
        canvasSlug: "canvas",
        created: false,
        overwroteOtherAuthor: false,
        themeId: "clean-saas",
      })
      .mockResolvedValueOnce({
        versionId: "version",
        version: 1,
        previousVersion: 1,
        changed: false,
        draftRevision: 1,
        dirty: false,
        promotedAssets: [],
      });
    context.runQuery = async () => {
      throw new Error("gateway_unavailable: detail lookup failed");
    };
    const failedResponse = await createApp(saveGateway).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body,
    });
    const failedPayload = parseMcpResponse(await failedResponse.text()) as {
      result: { isError?: boolean; content: Array<{ type: string; text: string }> };
    };
    const failure = JSON.parse(failedPayload.result.content[0]?.text ?? "null");

    expect(failedPayload.result.isError).toBe(true);
    expect(failure).toMatchObject({
      status: "error",
      error: {
        code: "gateway_unavailable",
        operation: "canvas_save",
        write_outcome: "unknown",
      },
      recovery: {
        suggested_tool: { name: "canvas_get", arguments: { ref: "workspace/canvas" } },
      },
    });
  });
});
