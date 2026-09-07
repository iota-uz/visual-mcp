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
    expect(byName.get("canvas_patch")?.inputSchema.properties).toHaveProperty("base");
    expect(byName.get("canvas_patch")?.inputSchema.properties).toHaveProperty("operations");
    expect(byName.get("canvas_page_move")?.outputSchema.properties).toHaveProperty("state");
    expect(byName.get("canvas_page_move")?.outputSchema.properties).not.toHaveProperty("pages");
  });

  test("patches page metadata and prototype together with a compact state response", async () => {
    const doc = {
      version: 3,
      defaultPageId: "flow",
      pages: [
        {
          id: "flow",
          title: "Flow",
          order: 0,
          doc: {
            version: 2,
            title: "Flow",
            subtitle: "Old",
            world: { width: 400, height: 300 },
            lanes: [],
            stages: [],
            labels: [],
            groups: [],
            edges: [],
            drawings: [],
            notes: [],
            nodes: [
              {
                kind: "native",
                id: "old",
                rect: { x: 10, y: 10, w: 100, h: 60 },
                caption: { title: "Old" },
                anchors: [],
                shape: "card",
              },
            ],
          },
        },
      ],
      prototype: { start: { pageId: "flow", nodeId: "old" }, interactions: [] },
    };
    let query = 0;
    const context = {
      runQuery: async () => {
        query += 1;
        if (query === 2) return { storageId: "doc" };
        return {
          canvas: {
            canvas_id: "canvas",
            version: 4,
            draft_revision: 9,
            resolved_theme: undefined,
            doc_url: "https://storage.example/doc",
          },
        };
      },
      runMutation: async () => ({ version: 4, draftRevision: 10, dirty: true }),
      storage: {
        get: async () => new Blob([JSON.stringify(doc)], { type: "application/json" }),
        store: async () => "stored",
        delete: async () => null,
      },
    } as unknown as AgentContext;
    const response = await createApp({
      ...gateway(),
      actionContext: () => context,
    } as never).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "canvas_patch",
          arguments: {
            ref: "workspace/canvas",
            base: "v4.r9",
            operations: [
              {
                op: "page.doc.patch",
                page_id: "flow",
                operations: [
                  { op: "nodes.remove", id: "old" },
                  {
                    op: "nodes.add",
                    value: { ...doc.pages[0].doc.nodes[0], id: "new", caption: { title: "New" } },
                  },
                ],
              },
              { op: "prototype.start.set", start: { pageId: "flow", nodeId: "new" } },
              { op: "page.update", page_id: "flow", changes: { subtitle: "New flow" } },
            ],
          },
        },
      }),
    });
    const payload = parseMcpResponse(await response.text()) as {
      result: {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
        structuredContent?: Record<string, unknown>;
      };
    };
    expect(payload.result.isError, JSON.stringify(payload)).not.toBe(true);
    expect(payload.result.structuredContent).toEqual({
      status: "ok",
      ref: "workspace/canvas",
      state: "v4.r10",
      changed: 3,
      affected_pages: ["flow"],
      warnings: [],
    });
    const text = payload.result.content?.[0]?.text ?? "";
    expect(text).not.toContain("\n");
    expect(text.length).toBeLessThan(250);
  });

  test("reads one selected page without returning every page or full theme metadata", async () => {
    const makePage = (id: string) => ({
      id,
      title: id,
      order: id === "a" ? 0 : 1,
      doc: {
        version: 2,
        title: id,
        world: { width: 400, height: 300 },
        lanes: [],
        stages: [],
        labels: [],
        groups: [],
        edges: [],
        drawings: [],
        notes: [],
        nodes: [
          {
            kind: "native",
            id: `${id}-node`,
            rect: { x: 10, y: 10, w: 100, h: 60 },
            caption: { title: id },
            anchors: [],
            shape: "card",
          },
        ],
      },
    });
    const doc = {
      version: 3,
      defaultPageId: "a",
      pages: [makePage("a"), makePage("b")],
      prototype: {
        start: { pageId: "a", nodeId: "a-node" },
        interactions: [
          {
            id: "a-to-b",
            source: { pageId: "a", nodeId: "a-node" },
            hotspot: { x: 0, y: 0, width: 10, height: 10 },
            trigger: "tap",
            destination: { pageId: "b", nodeId: "b-node" },
            transition: "instant",
          },
        ],
      },
    };
    let query = 0;
    const context = {
      runQuery: async () => {
        query += 1;
        if (query === 1)
          return {
            workspace_slug: "workspace",
            canvas: {
              canvas_id: "canvas",
              slug: "canvas",
              title: "Canvas",
              description: "Description",
              kind: "canvas",
              visibility: "private",
              version: 5,
              draft_revision: 12,
              dirty: true,
              draft_edit_count: 2,
              updated_at: 1,
              theme_id: "clean-saas",
              resolved_theme: { intentionally: "large" },
              doc_url: "https://storage.example/doc",
              public_slug: undefined,
              thumbnail_url: null,
            },
            created_by_email: "author@iota.uz",
          };
        if (query === 2) return { storageId: "doc" };
        return 0;
      },
      runMutation: async () => null,
      storage: { get: async () => new Blob([JSON.stringify(doc)], { type: "application/json" }) },
    } as unknown as AgentContext;
    const response = await createApp({
      ...gateway(),
      actionContext: () => context,
    } as never).request("/mcp", {
      method: "POST",
      headers: { ...headers, authorization: "Bearer valid" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "canvas_get",
          arguments: { ref: "workspace/canvas", page_id: "b", include: ["doc"] },
        },
      }),
    });
    const payload = parseMcpResponse(await response.text()) as {
      result: {
        isError?: boolean;
        structuredContent?: { canvas: Record<string, unknown>; doc: Record<string, unknown> };
      };
    };
    expect(payload.result.isError, JSON.stringify(payload)).not.toBe(true);
    expect(payload.result.structuredContent?.canvas).toMatchObject({ state: "v5.r12" });
    expect(payload.result.structuredContent?.canvas).not.toHaveProperty("resolved_theme");
    expect(payload.result.structuredContent?.canvas).not.toHaveProperty("created_by_email");
    expect(payload.result.structuredContent?.doc).toMatchObject({ activePage: { id: "b" } });
    expect(payload.result.structuredContent?.doc).not.toHaveProperty("pages.0.doc");
    expect(payload.result.structuredContent?.doc).toMatchObject({
      prototype: { interactions: [{ id: "a-to-b" }] },
    });
    expect(payload.result.structuredContent?.doc).not.toHaveProperty("prototype.start");
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
