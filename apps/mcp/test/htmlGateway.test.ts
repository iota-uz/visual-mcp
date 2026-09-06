import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentGateway } from "../src/gateway.js";
import { createApp } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function fixture() {
  vi.stubEnv("SPA_ORIGIN", "https://canvas.example");
  const blobs = new Map<string, Blob>();
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "https://backend.example/upload") {
      const storageId = `storage-${blobs.size}`;
      blobs.set(storageId, init!.body as Blob);
      return Response.json({ storageId });
    }
    expect(String(url)).toBe("https://backend.example/agent-gateway");
    const request = JSON.parse(String(init?.body));
    let result: unknown;
    switch (request.operation) {
      case "authenticate":
        result = {
          userId: "user",
          tokenId: "token",
          email: "agent@iota.uz",
          expiresAt: Date.now() + 60_000,
        };
        break;
      case "storage.generateUploadUrl":
        result = "https://backend.example/upload";
        break;
      case "mutation":
        mutations.push(request);
        if (request.name === "canvases:upsertByRef")
          result = {
            canvasId: "canvas",
            workspaceSlug: "demo",
            canvasSlug: "app",
            created: true,
            themeId: "clean-saas",
          };
        else if (request.name === "canvases:commitSaveContent")
          result = {
            versionId: "version",
            version: 1,
            previousVersion: 0,
            changed: true,
            draftRevision: 1,
            dirty: false,
            promotedAssets: [],
          };
        else throw new Error(`Unexpected mutation ${request.name}`);
        break;
      case "query":
        if (request.name === "canvases:listFilesForCanvas") result = [];
        else if (request.name === "canvases:listAssetBindingPaths") result = [];
        else if (request.name === "canvases:detailByRef")
          result = {
            canvas: {
              kind: "canvas",
              title: "App",
              version: 1,
              draft_revision: 1,
              dirty: false,
              visibility: "private",
              thumbnail_url: null,
            },
            storage: { used_bytes: 100, quota_bytes: 1_000_000 },
          };
        else throw new Error(`Unexpected query ${request.name}`);
        break;
      default:
        throw new Error(`Unexpected gateway operation ${request.operation}`);
    }
    return Response.json({ result });
  });
  const app = createApp(new AgentGateway("https://backend.example", "test-secret"));
  const call = async (args: Record<string, unknown>) => {
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer test",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "canvas_save", arguments: { ref: "demo/app", ...args } },
      }),
    });
    const text = await response.text();
    return JSON.parse(
      text.startsWith("event:")
        ? text
            .split(/\r?\n/)
            .find((line) => line.startsWith("data: "))!
            .slice(6)
        : text,
    ).result;
  };
  return { call, blobs, mutations };
}

describe("HTML authoring over the actual gateway adapter", () => {
  test.each([
    { html: "<h1>Hello</h1>" },
    {
      html: "<h1>App</h1>",
      screens: [
        { id: "home", route: "#/home" },
        { id: "settings", route: "#/settings" },
      ],
    },
    {
      screens: [
        { id: "home", html: "<h1>Home</h1>" },
        { id: "settings", html: "<h1>Settings</h1>" },
      ],
    },
  ])("commits raw source and its generated document together: %j", async (args) => {
    const { call, blobs, mutations } = fixture();
    const result = await call(args);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      kind: "canvas",
      draft_revision: 1,
    });
    expect(mutations.map((m) => m.name)).toEqual([
      "canvases:upsertByRef",
      "canvases:commitSaveContent",
    ]);
    const commit = mutations[1]!.args as {
      doc: { storageId: string };
      changes: Array<{ path: string; storageId: string }>;
    };
    const doc = JSON.parse(await blobs.get(commit.doc.storageId)!.text());
    for (const node of doc.pages[0].doc.nodes) {
      const source = commit.changes.find(
        (change: { path: string }) => change.path === node.source.entrypoint,
      );
      expect(source).toBeDefined();
      expect(await blobs.get(source.storageId)!.text()).toContain("<h1>");
    }
    expect(JSON.stringify(result)).not.toContain("<h1>");
    expect(result.structuredContent.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suggested_tool: expect.objectContaining({ name: "canvas_snapshot" }),
        }),
      ]),
    );
  });

  test("rejects conflicting shorthand before creating a canvas or uploading anything", async () => {
    const { call, mutations, blobs } = fixture();
    const result = await call({ html: "<h1>App</h1>", doc: {} });
    expect(result.isError).toBe(true);
    expect(mutations).toHaveLength(0);
    expect(blobs.size).toBe(0);
  });
});
