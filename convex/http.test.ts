/// <reference types="vite/client" />
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// A minimal stand-in for apps/worker's real /compile-css (PLAN.md section
// 2) — mirrors apps/worker/test/test-upload-server.ts's approach of a real
// loopback HTTP server rather than mocking `fetch` itself, since
// convex/lib/worker.ts's `callWorker` is exercised as real production code
// here, same as everywhere else in this file.
async function startMockCompileCssWorker(css = ".compiled-test-class{color:red}") {
  const token = "test-worker-token";
  const requests: Array<{ htmlFragments: string[] }> = [];
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/compile-css") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ css }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const originalUrl = process.env.WORKER_URL;
  const originalToken = process.env.WORKER_TOKEN;
  process.env.WORKER_URL = `http://127.0.0.1:${port}`;
  process.env.WORKER_TOKEN = token;

  return {
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      if (originalUrl === undefined) delete process.env.WORKER_URL;
      else process.env.WORKER_URL = originalUrl;
      if (originalToken === undefined) delete process.env.WORKER_TOKEN;
      else process.env.WORKER_TOKEN = originalToken;
    },
  };
}

// Stands in for apps/worker's real /compile-css + /render (put_canvas_doc's
// auto-render, PLAN.md section 9 C1). Unlike the real worker, this never
// actually PUTs bytes to the signed upload URL — convex-test's
// `generateUploadUrl()` returns a non-fetchable placeholder
// (`https://some-deployment.convex.cloud/...`, see its `storageGenerateUploadUrl`
// syscall stub), so there is no real endpoint to upload to in this harness.
// Instead the caller pre-stores blobs directly via `t.run` + `ctx.storage.store`
// (a real, working syscall) and this mock's canned `/render` response
// references those already-real storageIds — `callWorker`/`extractStorageId`
// see exactly the response shape the real worker would send, and every
// storageId `attachCanvasRender` receives is genuinely resolvable.
async function startMockRenderWorker(opts: {
  renderStorageId: string;
  snapshotStorageId?: string;
  snapshotStorageIds?: string[];
  snapshotReadiness?: Array<{ status: "ready" | "partial"; warnings: string[] }>;
  snapshotUnresolvedDetails?: Array<{
    ref: string;
    resourceType: string;
    reason: string;
    error?: string;
  }>;
  snapshotDownscaled?: boolean;
  snapshotSize?: number;
  thumbnailStorageId?: string;
  renderSize?: number;
  css?: string;
}) {
  const token = "test-worker-token";
  const requests: {
    compileCss: Array<{ htmlFragments: string[] }>;
    render: unknown[];
    snapshot: unknown[];
  } = {
    compileCss: [],
    render: [],
    snapshot: [],
  };
  const server: Server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (req.method === "POST" && req.url === "/compile-css") {
        requests.compileCss.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ css: opts.css ?? "" }));
        return;
      }
      if (req.method === "POST" && req.url === "/render") {
        requests.render.push(body);
        const mimeType =
          body.format === "pdf"
            ? "application/pdf"
            : body.format === "svg"
              ? "image/svg+xml"
              : "image/png";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            relPath: body.outputPath,
            size: opts.renderSize ?? 123,
            mimeType,
            uploadStatus: 200,
            uploadBody: { storageId: opts.renderStorageId },
            thumbnail: opts.thumbnailStorageId
              ? { uploadStatus: 200, uploadBody: { storageId: opts.thumbnailStorageId } }
              : undefined,
          }),
        );
        return;
      }
      if (
        req.method === "POST" &&
        req.url === "/snapshot" &&
        (opts.snapshotStorageId || opts.snapshotStorageIds?.length)
      ) {
        requests.snapshot.push(body);
        const index = requests.snapshot.length - 1;
        const snapshotStorageId = opts.snapshotStorageIds?.[index] ?? opts.snapshotStorageId;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            size: opts.snapshotSize ?? 8,
            width: 240,
            height: 160,
            mimeType: "image/png",
            uploadStatus: 200,
            uploadBody: { storageId: snapshotStorageId },
            unresolvedRefs: opts.snapshotUnresolvedDetails?.map((detail) => detail.ref) ?? [],
            unresolvedDetails: opts.snapshotUnresolvedDetails ?? [],
            readiness: opts.snapshotReadiness?.[index] ?? { status: "ready", warnings: [] },
            downscaled: opts.snapshotDownscaled ?? false,
            contentOverflow: false,
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const originalUrl = process.env.WORKER_URL;
  const originalToken = process.env.WORKER_TOKEN;
  process.env.WORKER_URL = `http://127.0.0.1:${port}`;
  process.env.WORKER_TOKEN = token;

  return {
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      if (originalUrl === undefined) delete process.env.WORKER_URL;
      else process.env.WORKER_URL = originalUrl;
      if (originalToken === undefined) delete process.env.WORKER_TOKEN;
      else process.env.WORKER_TOKEN = originalToken;
    },
  };
}

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

async function listTools(t: ReturnType<typeof convexTest>, token: string): Promise<unknown> {
  const res = await t.fetch("/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  expect(res.status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await t.finishInProgressScheduledFunctions();
  return (await parseJsonRpc(res)).result;
}

describe("/mcp tool contracts", () => {
  test("every tool rejects unknown root fields and declares structured output", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const listed = (await listTools(t, token)) as {
      tools: Array<{
        name: string;
        inputSchema: {
          additionalProperties?: boolean;
          anyOf?: Array<{ additionalProperties?: boolean }>;
        };
        outputSchema?: unknown;
      }>;
    };
    expect(listed.tools).toHaveLength(37);
    for (const tool of listed.tools) {
      const roots = tool.inputSchema.anyOf ?? [tool.inputSchema];
      expect(
        roots.every((root) => root.additionalProperties === false),
        tool.name,
      ).toBe(true);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }

    const docPatch = listed.tools.find((tool) => tool.name === "canvas_doc_patch");
    expect(JSON.stringify(docPatch?.inputSchema)).toContain("nodes.update");
    expect(JSON.stringify(docPatch?.inputSchema)).toContain("world.update");
    for (const [name, field] of [
      ["canvas_upload_url", "files"],
      ["asset_upload_url", "files"],
      ["asset_finalize", "items"],
    ] as const) {
      const tool = listed.tools.find((candidate) => candidate.name === name);
      expect(JSON.stringify(tool?.inputSchema), name).toContain(`"${field}"`);
    }
  });

  test("unknown inputs fail instead of being silently stripped", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const response = await callTool(t, token, "canvas_find", { include_doc: true });
    const result = response.result as { isError?: boolean; content?: Array<{ text?: string }> };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/include_doc|unrecognized|unknown/i);
  });

  test("nested render and snapshot inputs reject misspelled fields", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const render = (
      await callTool(t, token, "canvas_save", {
        ref: "strict/nested-render",
        files: [{ path: "/src/index.html", text: "<h1>strict</h1>" }],
        renders: [
          {
            target: { type: "file", entrypoint: "/src/index.html", unexpected: true },
            format: "png",
          },
        ],
      })
    ).result as { isError?: boolean; content?: Array<{ text?: string }> };
    expect(render.isError).toBe(true);
    expect(render.content?.[0]?.text).toMatch(/unexpected|unrecognized/i);

    const snapshot = (
      await callTool(t, token, "canvas_snapshot", {
        ref: "strict/nested-render",
        target: { type: "canvas", node_id: "silently-stripped-before" },
      })
    ).result as { isError?: boolean; content?: Array<{ text?: string }> };
    expect(snapshot.isError).toBe(true);
    expect(snapshot.content?.[0]?.text).toMatch(/node_id|unrecognized/i);
  });
});

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
        params: { name: "canvas_find", arguments: {} },
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
        params: { name: "canvas_find", arguments: {} },
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
        params: { name: "canvas_find", arguments: {} },
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
    const response = await callTool(t, token, "canvas_find", {});
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  });
});

describe("/mcp resources: templates", () => {
  async function rpc(
    t: ReturnType<typeof convexTest>,
    token: string,
    method: string,
    params: Record<string, unknown>,
  ) {
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
    return parseJsonRpc(res);
  }

  test("templates are resources, not a tool that dumps every example into context", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const listed = await rpc(t, token, "resources/list", {});
    const resources = (listed.result as { resources: Array<{ uri: string; name: string }> })
      .resources;
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.map((r) => r.uri)).toContain("canvas://templates/browser-app-screen");
    // The listing carries names and descriptions only — v1's list_templates
    // returned every template's full exampleCode (~46KB) on every call.
    const serialized = JSON.stringify(resources);
    expect(serialized).not.toContain("<!doctype html>");
  });

  test("reading one template returns its example source", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const read = await rpc(t, token, "resources/read", {
      uri: "canvas://templates/browser-app-screen",
    });
    const contents = (read.result as { contents: Array<{ text: string }> }).contents;
    expect(contents[0]?.text).toContain("<!doctype html>");
  });
});

describe("/mcp canvas_save", () => {
  const baseDoc = {
    version: 2,
    title: "Test Canvas",
    world: { width: 800, height: 400 },
    lanes: [{ id: "l1", label: "Lane", role: "primary", rect: { x: 0, y: 0, w: 800, h: 400 } }],
    stages: [{ id: "s1", index: 0, label: "Stage", rect: { x: 0, y: 0, w: 800, h: 400 } }],
    labels: [],
    nodes: [
      {
        id: "n1",
        kind: "native",
        laneId: "l1",
        stageId: "s1",
        rect: { x: 50, y: 50, w: 200, h: 100 },
        shape: "note",
        caption: { title: "Node" },
        anchors: [{ id: "right", side: "right", offset: 0.5 }],
      },
    ],
    edges: [],
  };
  const canvasFile = (doc: Record<string, unknown> = baseDoc) => ({
    version: 3,
    defaultPageId: "overview",
    pages: [{ id: "overview", title: "Overview", order: 0, doc }],
    prototype: { interactions: [] },
  });

  function parse(response: { result?: unknown }) {
    const result = response.result as {
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    // Error results carry a prose message, not JSON — only parse successes.
    const data = result.isError ? {} : (result.structuredContent ?? JSON.parse(text || "{}"));
    return { isError: result.isError, text, data };
  }

  test("a slug ref creates workspace and canvas in one call and returns a real URL", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const response = await callTool(t, token, "canvas_save", {
      ref: "osago/fast-settlement",
      title: "Fast Settlement",
      files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
    });
    const { isError, data } = parse(response);

    expect(isError).toBeFalsy();
    expect(data.created).toBe(true);
    expect(data.ref).toBe("osago/fast-settlement");
    // The v1 gap this closes: no tool returned a link an agent could hand over.
    expect(data.canvas_url).toMatch(/^https:\/\/canvas\.test\/c\//);
    expect(data.share_url).toBeNull();
    expect(data.files_written).toEqual([{ path: "/src/index.html", size_bytes: 11 }]);
    expect(data.previous_version).toBe(0);
    expect(data.version).toBe(1);
    expect(data.published).toBe(true);
  });

  test("new canvas writes require the clean multi-page CanvasFile v3 model", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const invalid = parse(
      await callTool(t, token, "canvas_save", {
        ref: "pages/invalid-write",
        kind: "canvas",
        doc: baseDoc,
      }),
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toMatch(/version|Invalid input/i);
  });

  test("overlapping nodes are reported as a warning without failing the save", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const stacked = parse(
      await callTool(t, token, "canvas_save", {
        ref: "geometry/stacked",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            ...baseDoc.nodes,
            {
              id: "n2",
              kind: "native",
              laneId: "l1",
              stageId: "s1",
              // Half of n1's 200x100 box at (50,50).
              rect: { x: 150, y: 50, w: 200, h: 100 },
              shape: "note",
              caption: { title: "Stacked" },
              anchors: [],
            },
          ],
        }),
      }),
    );

    expect(stacked.isError).toBeFalsy();
    // A soft diagnostic: the document is saved and published as authored.
    expect(stacked.data.status).toBe("ok");
    expect(stacked.data.version).toBe(1);
    const warnings = stacked.data.warnings as Array<{
      code: string;
      path?: string;
      data?: { node_ids?: string[]; overlap_area?: number; overlap_fraction?: number };
    }>;
    const overlap = warnings.find((warning) => warning.code === "node_overlap");
    expect(overlap).toBeDefined();
    expect(overlap?.path).toBe("overview#n1+n2");
    expect(overlap?.data?.node_ids).toEqual(["n1", "n2"]);
    expect(overlap?.data?.overlap_area).toBe(100 * 100);
    expect(overlap?.data?.overlap_fraction).toBe(0.5);
  });

  test("nodes that merely touch are not reported as overlapping", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const adjacent = parse(
      await callTool(t, token, "canvas_save", {
        ref: "geometry/adjacent",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            ...baseDoc.nodes,
            {
              id: "n2",
              kind: "native",
              laneId: "l1",
              stageId: "s1",
              rect: { x: 250, y: 50, w: 200, h: 100 },
              shape: "note",
              caption: { title: "Beside" },
              anchors: [],
            },
          ],
        }),
      }),
    );

    expect(adjacent.isError).toBeFalsy();
    const warnings = adjacent.data.warnings as Array<{ code: string }>;
    expect(warnings.filter((warning) => warning.code === "node_overlap")).toHaveLength(0);
  });

  test("a device preset needs no viewport and renders its own Safari shell", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const saved = parse(
      await callTool(t, token, "canvas_save", {
        ref: "mockups/website",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            {
              id: "landing",
              kind: "iframe",
              laneId: "l1",
              stageId: "s1",
              rect: { x: 40, y: 40, w: 310, h: 755 },
              caption: { title: "Landing" },
              anchors: [],
              source: { entrypoint: "/src/screens/landing.html" },
              // No viewport: the preset brings its own.
              frame: { kind: "device", preset: "iphone-safari", url: "acme.example" },
            },
          ],
        }),
        files: [{ path: "/src/screens/landing.html", text: "<h1>Acme</h1>" }],
      }),
    );

    expect(saved.isError).toBeFalsy();
    expect(saved.data.status).toBe("ok");

    const read = parse(
      await callTool(t, token, "canvas_get", { ref: "mockups/website", include: ["doc"] }),
    );
    const node = (
      read.data.doc as { pages: { doc: { nodes: Record<string, unknown>[] } }[] }
    ).pages[0]?.doc.nodes[0];
    expect(node?.frame).toMatchObject({ kind: "device", preset: "iphone-safari", display: "clip" });
    // The preset resolved the screen size the author never wrote down.
    expect(node?.viewport).toEqual({ width: 284, height: 590 });
  });

  test("a batch move lands as one write and keeps the arrangement", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const created = parse(
      await callTool(t, token, "canvas_save", {
        ref: "batch/move",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            ...baseDoc.nodes,
            {
              id: "n2",
              kind: "native",
              laneId: "l1",
              stageId: "s1",
              rect: { x: 400, y: 50, w: 200, h: 100 },
              shape: "note",
              caption: { title: "Second" },
              anchors: [],
            },
          ],
        }),
      }),
    );

    const moved = parse(
      await callTool(t, token, "canvas_nodes_move", {
        ref: "batch/move",
        expected_version: created.data.version as number,
        expected_draft_revision: created.data.draft_revision as number,
        node_ids: ["n1", "n2"],
        dx: 25,
        dy: -10,
      }),
    );
    expect(moved.isError).toBeFalsy();
    expect(moved.data.moved_node_ids).toEqual(["n1", "n2"]);

    const read = parse(
      await callTool(t, token, "canvas_get", { ref: "batch/move", include: ["doc"] }),
    );
    const nodes = (read.data.doc as { pages: { doc: { nodes: { id: string; rect: { x: number; y: number } }[] } }[] })
      .pages[0]?.doc.nodes;
    expect(nodes?.map((node) => [node.id, node.rect.x, node.rect.y])).toEqual([
      ["n1", 75, 40],
      ["n2", 425, 40],
    ]);

    // Same gesture, one version bump — not one per node.
    expect(moved.data.version).toBe(created.data.version);
    expect(moved.data.draft_revision).toBe((created.data.draft_revision as number) + 1);
  });

  test("a stale batch move is refused rather than rebased onto someone else's doc", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const created = parse(
      await callTool(t, token, "canvas_save", { ref: "batch/stale", kind: "canvas", doc: canvasFile() }),
    );
    const stale = parse(
      await callTool(t, token, "canvas_nodes_move", {
        ref: "batch/stale",
        expected_version: (created.data.version as number) + 5,
        expected_draft_revision: created.data.draft_revision as number,
        node_ids: ["n1"],
        dx: 1,
        dy: 1,
      }),
    );
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/version_conflict/);
  });

  test("deleting nodes removes their edges, empty groups and prototype wiring", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const screens = [
      {
        id: "s-one",
        kind: "iframe",
        laneId: "l1",
        stageId: "s1",
        rect: { x: 40, y: 40, w: 310, h: 755 },
        caption: { title: "One" },
        anchors: [{ id: "right", side: "right", offset: 0.5 }],
        source: { entrypoint: "/src/screens/one.html" },
        viewport: { width: 284, height: 642 },
        frame: { kind: "phone", time: "09:42" },
      },
      {
        id: "s-two",
        kind: "iframe",
        laneId: "l1",
        stageId: "s1",
        rect: { x: 420, y: 40, w: 310, h: 755 },
        caption: { title: "Two" },
        anchors: [{ id: "left", side: "left", offset: 0.5 }],
        source: { entrypoint: "/src/screens/two.html" },
        viewport: { width: 284, height: 642 },
        frame: { kind: "phone", time: "09:42" },
      },
    ];
    const created = parse(
      await callTool(t, token, "canvas_save", {
        ref: "batch/delete",
        kind: "canvas",
        doc: {
          version: 3,
          defaultPageId: "overview",
          pages: [
            {
              id: "overview",
              title: "Overview",
              order: 0,
              doc: {
                ...baseDoc,
                nodes: screens,
                groups: [{ id: "pair", label: "Pair", nodeIds: ["s-one", "s-two"] }],
                edges: [
                  {
                    id: "flow",
                    source: { nodeId: "s-one", anchorId: "right" },
                    target: { nodeId: "s-two", anchorId: "left" },
                    kind: "main",
                    route: { type: "orthogonal" },
                  },
                ],
              },
            },
          ],
          prototype: {
            start: { pageId: "overview", nodeId: "s-one" },
            interactions: [
              {
                id: "tap",
                source: { pageId: "overview", nodeId: "s-one" },
                hotspot: { x: 0, y: 0, width: 100, height: 40 },
                destination: { pageId: "overview", nodeId: "s-two" },
              },
            ],
          },
        },
        files: [
          { path: "/src/screens/one.html", text: "<h1>one</h1>" },
          { path: "/src/screens/two.html", text: "<h1>two</h1>" },
        ],
      }),
    );
    expect(created.isError).toBeFalsy();

    const deleted = parse(
      await callTool(t, token, "canvas_nodes_delete", {
        ref: "batch/delete",
        expected_version: created.data.version as number,
        expected_draft_revision: created.data.draft_revision as number,
        node_ids: ["s-one"],
      }),
    );
    expect(deleted.isError).toBeFalsy();
    expect(deleted.data.removed_node_ids).toEqual(["s-one"]);
    expect(deleted.data.removed_edge_ids).toEqual(["flow"]);
    expect(deleted.data.removed_group_ids).toEqual([]);
    expect(deleted.data.removed_interaction_ids).toEqual(["tap"]);
    expect(deleted.data.cleared_prototype_start).toBe(true);

    const read = parse(
      await callTool(t, token, "canvas_get", { ref: "batch/delete", include: ["doc"] }),
    );
    const file = read.data.doc as {
      pages: { doc: { nodes: { id: string }[]; edges: unknown[]; groups: { nodeIds: string[] }[] } }[];
      prototype: { start?: unknown; interactions: unknown[] };
    };
    expect(file.pages[0]?.doc.nodes.map((node) => node.id)).toEqual(["s-two"]);
    // No dangling edges is the whole point.
    expect(file.pages[0]?.doc.edges).toEqual([]);
    expect(file.pages[0]?.doc.groups[0]?.nodeIds).toEqual(["s-two"]);
    expect(file.prototype.start).toBeUndefined();
    expect(file.prototype.interactions).toEqual([]);
  });

  test("a component captured from a canvas inserts into another as an independent copy", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const pair = {
      ...baseDoc,
      nodes: [
        ...baseDoc.nodes,
        {
          id: "n2",
          kind: "native",
          laneId: "l1",
          stageId: "s1",
          rect: { x: 400, y: 90, w: 200, h: 100 },
          shape: "note",
          caption: { title: "Second" },
          anchors: [{ id: "left", side: "left", offset: 0.5 }],
        },
      ],
      edges: [
        {
          id: "link",
          source: { nodeId: "n1", anchorId: "right" },
          target: { nodeId: "n2", anchorId: "left" },
          kind: "main",
          route: { type: "orthogonal" },
        },
      ],
    };
    const source = parse(
      await callTool(t, token, "canvas_save", {
        ref: "kit/source",
        kind: "canvas",
        doc: canvasFile(pair),
      }),
    );
    expect(source.isError).toBeFalsy();

    const saved = parse(
      await callTool(t, token, "component_save", {
        ref: "kit/pair",
        name: "Node pair",
        description: "Two notes and the arrow between them",
        tags: ["demo"],
        from: { ref: "kit/source", node_ids: ["n1", "n2"] },
      }),
    );
    expect(saved.isError).toBeFalsy();
    expect(saved.data.created).toBe(true);
    expect(saved.data.node_count).toBe(2);
    expect(saved.data.edge_count).toBe(1);
    expect(saved.data.version).toBe(1);

    const read = parse(
      await callTool(t, token, "component_get", { ref: "kit/pair", include_body: true }),
    );
    const body = read.data as { nodes: { id: string; rect: { x: number; y: number } }[] };
    // Geometry is rebased on the block's own corner, and page context is gone.
    expect(body.nodes.map((node) => [node.id, node.rect.x, node.rect.y])).toEqual([
      ["n1", 0, 0],
      ["n2", 350, 40],
    ]);
    expect(body.nodes.every((node) => !("laneId" in node) && !("stageId" in node))).toBe(true);

    const found = parse(await callTool(t, token, "component_find", { query: "pair" }));
    expect((found.data.components as { ref: string }[]).map((c) => c.ref)).toEqual(["kit/pair"]);

    const target = parse(
      await callTool(t, token, "canvas_save", {
        ref: "kit/target",
        kind: "canvas",
        doc: canvasFile(),
      }),
    );

    const first = parse(
      await callTool(t, token, "component_insert", {
        ref: "kit/pair",
        target: { ref: "kit/target" },
        at: { x: 800, y: 400 },
        expected_version: target.data.version as number,
        expected_draft_revision: target.data.draft_revision as number,
        group_label: "Pair",
      }),
    );
    expect(first.isError).toBeFalsy();
    // "n1" is taken by the target canvas, so the copy gets its own id.
    expect(first.data.node_ids).toEqual({ n1: "pair-n1", n2: "pair-n2" });
    expect(first.data.edge_ids).toEqual({ link: "pair-link" });
    expect(first.data.group_id).toBe("pair-group");

    const second = parse(
      await callTool(t, token, "component_insert", {
        ref: "kit/pair",
        target: { ref: "kit/target" },
        at: { x: 1_400, y: 400 },
        expected_version: first.data.version as number,
        expected_draft_revision: first.data.draft_revision as number,
      }),
    );
    expect(second.isError).toBeFalsy();
    expect(second.data.node_ids).toEqual({ n1: "pair-n1-2", n2: "pair-n2-2" });

    const doc = parse(
      await callTool(t, token, "canvas_get", { ref: "kit/target", include: ["doc"] }),
    );
    const nodes = (
      doc.data.doc as {
        pages: {
          doc: {
            nodes: { id: string; rect: { x: number; y: number } }[];
            edges: { id: string; source: { nodeId: string }; target: { nodeId: string } }[];
          };
        }[];
      }
    ).pages[0]?.doc;
    expect(nodes?.nodes.map((node) => node.id)).toEqual([
      "n1",
      "pair-n1",
      "pair-n2",
      "pair-n1-2",
      "pair-n2-2",
    ]);
    // Both copies landed where they were asked to, independently.
    expect(nodes?.nodes.find((node) => node.id === "pair-n1")?.rect).toMatchObject({
      x: 800,
      y: 400,
    });
    expect(nodes?.nodes.find((node) => node.id === "pair-n1-2")?.rect).toMatchObject({
      x: 1_400,
      y: 400,
    });
    // Internal edges follow their own copies, never the other insertion.
    expect(nodes?.edges.map((edge) => [edge.id, edge.source.nodeId, edge.target.nodeId])).toEqual([
      ["pair-link", "pair-n1", "pair-n2"],
      ["pair-link-2", "pair-n1-2", "pair-n2-2"],
    ]);

    const deleted = parse(await callTool(t, token, "component_delete", { ref: "kit/pair" }));
    expect(deleted.data.deleted).toBe(true);
    // Deleting the component leaves inserted copies alone — they are copies.
    const after = parse(
      await callTool(t, token, "canvas_get", { ref: "kit/target", include: ["doc"] }),
    );
    expect(
      (after.data.doc as { pages: { doc: { nodes: unknown[] } }[] }).pages[0]?.doc.nodes,
    ).toHaveLength(5);
  });

  test("component writes are versioned and page context is refused", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "kit/anchor",
      kind: "canvas",
      doc: canvasFile(),
    });

    const inlineNode = {
      id: "card",
      kind: "native",
      shape: "note",
      rect: { x: 0, y: 0, w: 200, h: 100 },
      caption: { title: "Card" },
      anchors: [],
    };
    const created = parse(
      await callTool(t, token, "component_save", {
        ref: "kit/card",
        name: "Card",
        nodes: [inlineNode],
      }),
    );
    expect(created.data.version).toBe(1);

    const stale = parse(
      await callTool(t, token, "component_save", {
        ref: "kit/card",
        name: "Card",
        nodes: [inlineNode],
        expected_version: 5,
      }),
    );
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/version_conflict/);

    const updated = parse(
      await callTool(t, token, "component_save", {
        ref: "kit/card",
        name: "Card v2",
        nodes: [inlineNode],
        expected_version: 1,
      }),
    );
    expect(updated.data.created).toBe(false);
    expect(updated.data.version).toBe(2);

    // A component that depends on a lane cannot insert anywhere else.
    const contextual = parse(
      await callTool(t, token, "component_save", {
        ref: "kit/bound",
        name: "Bound",
        nodes: [{ ...inlineNode, laneId: "l1" }],
      }),
    );
    expect(contextual.isError).toBe(true);
    expect(contextual.text).toMatch(/lane or stage/);

    const unknownWorkspace = parse(
      await callTool(t, token, "component_save", {
        ref: "nowhere/card",
        name: "Card",
        nodes: [inlineNode],
      }),
    );
    expect(unknownWorkspace.isError).toBe(true);
    expect(unknownWorkspace.text).toMatch(/Unknown workspace/);
  });

  test("files-only save publishes exactly one version and identical retry is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const first = parse(
      await callTool(t, token, "canvas_save", {
        ref: "atomic/files-only",
        files: [{ path: "/src/index.html", text: "first" }],
      }),
    );
    const replay = parse(
      await callTool(t, token, "canvas_save", {
        ref: "atomic/files-only",
        expected_version: 1,
        files: [{ path: "/src/index.html", text: "first" }],
      }),
    );
    const changed = parse(
      await callTool(t, token, "canvas_save", {
        ref: "atomic/files-only",
        expected_version: 1,
        files: [{ path: "/src/index.html", text: "second" }],
      }),
    );

    expect(first.data.version).toBe(1);
    expect(replay.data.version).toBe(1);
    expect(replay.data.previous_version).toBe(1);
    expect(changed.data.previous_version).toBe(1);
    expect(changed.data.version).toBe(1);
    expect(changed.data.dirty).toBe(true);
    const versions = await t.run((ctx) => ctx.db.query("canvasVersions").collect());
    expect(versions.map((version) => version.version)).toEqual([1]);
  });

  test("invalid doc plus files leaves no partial canvas or mutable files", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const failed = parse(
      await callTool(t, token, "canvas_save", {
        ref: "atomic/rejected",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            {
              id: "screen",
              kind: "iframe",
              rect: { x: 50, y: 50, w: 300, h: 240 },
              caption: { title: "Missing" },
              anchors: [{ id: "right", side: "right", offset: 0.5 }],
              source: { entrypoint: "/src/screens/missing.html" },
              viewport: { width: 284, height: 642 },
              frame: { kind: "phone", time: "09:42" },
              sandbox: ["allow-scripts", "allow-forms"],
              permissions: [],
              activation: "double-click",
            },
          ],
        }),
        files: [{ path: "/src/unrelated.html", text: "must not commit" }],
      }),
    );
    expect(failed.isError).toBe(true);
    expect(failed.text).toMatch(/missing\.html/);
    const canvases = await t.run((ctx) => ctx.db.query("canvases").collect());
    const files = await t.run((ctx) => ctx.db.query("canvasFiles").collect());
    expect(canvases).toHaveLength(0);
    expect(files).toHaveLength(0);
  });

  test("a failed content transaction does not leak metadata or visibility changes", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "atomic/existing",
      title: "Before",
      files: [{ path: "/src/index.html", text: "before" }],
    });

    const failed = parse(
      await callTool(t, token, "canvas_save", {
        ref: "atomic/existing",
        title: "After",
        visibility: "public",
        expected_version: 1,
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            {
              id: "image",
              kind: "image",
              rect: { x: 0, y: 0, w: 100, h: 100 },
              caption: { title: "Missing" },
              anchors: [{ id: "right", side: "right", offset: 0.5 }],
              source: { path: "/assets/missing.png" },
              alt: "Missing",
            },
          ],
        }),
      }),
    );
    expect(failed.isError).toBe(true);

    const current = parse(await callTool(t, token, "canvas_get", { ref: "atomic/existing" }));
    expect(current.data.canvas).toMatchObject({
      title: "Before",
      visibility: "private",
      version: 1,
    });
  });

  test("canvas_file_get returns bounded ranges and rejects unknown fields", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "read/one-file",
      files: [
        { path: "/src/index.txt", text: "one\ntwo\nthree\nfour" },
        { path: "/src/unicode.txt", text: "😀" },
        { path: "/src/large.txt", text: "x".repeat(150_000) },
      ],
    });
    const ranged = parse(
      await callTool(t, token, "canvas_file_get", {
        ref: "read/one-file",
        path: "/src/index.txt",
        start_line: 2,
        end_line: 3,
      }),
    );
    expect(ranged.isError, ranged.text).toBeFalsy();
    expect(ranged.data.content).toBe("two\nthree");
    expect(ranged.data.encoding).toBe("utf-8");
    expect(ranged.data.range).toEqual({ kind: "lines", start: 2, end: 3, total: 4 });
    expect(ranged.data.version).toBe(1);
    expect(ranged.data.content_hash).toMatch(/^[a-f0-9]{64}$/);

    const utf8Bytes = parse(
      await callTool(t, token, "canvas_file_get", {
        ref: "read/one-file",
        path: "/src/unicode.txt",
        start_byte: 1,
        end_byte: 3,
      }),
    );
    expect(utf8Bytes.data.encoding).toBe("base64");
    expect([...Buffer.from(utf8Bytes.data.content, "base64")]).toEqual([0x9f, 0x98]);

    const defaultByteRange = parse(
      await callTool(t, token, "canvas_file_get", {
        ref: "read/one-file",
        path: "/src/large.txt",
        start_byte: 0,
      }),
    );
    expect(defaultByteRange.isError, defaultByteRange.text).toBeFalsy();
    expect(defaultByteRange.data.encoding).toBe("base64");
    expect(Buffer.from(defaultByteRange.data.content, "base64")).toHaveLength(98_304);
    expect(defaultByteRange.data.truncated).toBe(true);

    const strict = parse(
      await callTool(t, token, "canvas_file_get", {
        ref: "read/one-file",
        path: "/src/index.txt",
        include_doc: true,
      }),
    );
    expect(strict.isError).toBe(true);
    expect(strict.text).toMatch(/include_doc|unrecognized/i);
  });

  test("calling it twice with the same ref updates rather than minting osago-2", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    await callTool(t, token, "canvas_save", { ref: "osago/report", title: "First" });
    const second = parse(
      await callTool(t, token, "canvas_save", { ref: "osago/report", title: "Second" }),
    );

    expect(second.data.created).toBe(false);
    expect(second.data.title).toBe("Second");
    const workspaces = await t.run((ctx) => ctx.db.query("workspaces").collect());
    expect(workspaces).toHaveLength(1);
  });

  test("publishing returns the share URL, not a bare slug", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { data } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/report",
        files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
        visibility: "public",
      }),
    );

    expect(data.visibility).toBe("public");
    expect(data.share_url).toMatch(/^https:\/\/canvas\.test\/s\/[0-9A-Za-z]+$/);
    expect(data.embed.image_url).toMatch(
      /^https:\/\/canvas-api\.test\/s\/[0-9A-Za-z]+\/_embed\/card\.svg\?target=canvas/,
    );
    expect(data.embed.github_markdown).toContain("](");
  });

  test("an unresolved asset reference is reported instead of rendering silently broken", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { data } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/report",
        files: [
          {
            path: "/src/index.html",
            text: '<img src="./accident-1.jpg"><style>.a{background:url("/assets/missing.png")}</style>',
          },
        ],
      }),
    );

    const warnings = data.warnings as Array<{ code: string; path?: string }>;
    expect(data.status).toBe("partial");
    const paths = warnings.filter((w) => w.code === "unresolved_asset").map((w) => w.path);
    // "./accident-1.jpg" sits *beside* index.html, so it means
    // /src/accident-1.jpg — resolving refs against the canvas root instead
    // named files that were never referenced.
    expect(paths).toContain("/src/accident-1.jpg");
    expect(paths).toContain("/assets/missing.png");
  });

  test("a ../assets reference resolves against the referencing file, not the root", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { data } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "probe/refs",
        kind: "html",
        files: [
          { path: "/assets/logo.png", text: "PNG" },
          {
            path: "/src/index.html",
            text: '<img src="../assets/logo.png"><img src="../assets/gone.png">',
          },
        ],
      }),
    );

    // Resolving against the canvas root instead produced "/../assets/logo.png",
    // which matches nothing — so every correct reference was reported broken
    // and the report was useless noise.
    const paths = (data.warnings as { code: string; path?: string }[])
      .filter((w) => w.code === "unresolved_asset")
      .map((w) => w.path);
    expect(paths).toEqual(["/assets/gone.png"]);
  });

  test("an asset that IS present produces no warning", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { data } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/report",
        files: [
          { path: "/assets/logo.svg", text: "<svg/>" },
          { path: "/src/index.html", text: '<img src="/assets/logo.svg">' },
        ],
      }),
    );

    const warnings = data.warnings as Array<{ code: string }>;
    expect(warnings.filter((w) => w.code === "unresolved_asset")).toHaveLength(0);
  });

  test("/assets is writable — the whole reason images no longer need base64 inlining", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { isError, data } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/report",
        files: [{ path: "/assets/logo.svg", text: "<svg/>" }],
      }),
    );

    expect(isError).toBeFalsy();
    expect(data.files_written).toEqual([{ path: "/assets/logo.svg", size_bytes: 6 }]);
  });

  test("writing to /cache is still refused, and says where writes are allowed", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { isError, text } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/report",
        files: [{ path: "/cache/x.txt", text: "nope" }],
      }),
    );

    expect(isError).toBe(true);
    expect(text).toMatch(/only allowed under \/src, \/output or \/assets/);
  });

  test("CanvasDoc v1 inline content is rejected at the offending node", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { isError, text } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/doc",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            {
              ...baseDoc.nodes[0],
              kind: undefined,
              content: { type: "html", html: "<script>alert(1)</script>" },
            },
          ],
        }),
      }),
    );

    expect(isError).toBe(true);
    expect(text).toMatch(/nodes\.0/);
    // v1 dropped zod issue paths, so a 40-node doc reported the rule and
    // never said which node broke it.
    expect(text).toMatch(/nodes\.0/);
  });

  test("doc + iframe files are accepted atomically and snapshot the entrypoint", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const { isError, data } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/doc",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            {
              id: "screen",
              kind: "iframe",
              laneId: "l1",
              stageId: "s1",
              rect: { x: 50, y: 50, w: 300, h: 240 },
              caption: { title: "Screen" },
              anchors: [{ id: "right", side: "right", offset: 0.5 }],
              source: { entrypoint: "/src/screens/runtime.html", route: "#/start" },
              viewport: { width: 284, height: 642 },
              frame: { kind: "phone", time: "09:42" },
              sandbox: ["allow-scripts", "allow-forms"],
              permissions: [],
              activation: "double-click",
            },
          ],
        }),
        files: [{ path: "/src/screens/runtime.html", text: "<!doctype html><button>ok</button>" }],
      }),
    );
    expect(isError).toBeFalsy();
    expect(data.version).toBe(1);
    expect(data.files_written).toHaveLength(1);
  });

  test("rejects the CanvasDoc-generated entry path before it can create duplicate file rows", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const response = parse(
      await callTool(t, token, "canvas_save", {
        ref: "atomic/reserved-entry",
        kind: "canvas",
        doc: canvasFile(),
        files: [{ path: "/src/__canvas.html", text: "caller-owned" }],
      }),
    );
    expect(response.isError).toBe(true);
    expect(response.text).toMatch(/generated|cannot be written/i);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("canvasFiles")
        .filter((q) => q.eq(q.field("relPath"), "/src/__canvas.html"))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("native image nodes validate their source in the same atomic save", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const imageDoc = {
      ...baseDoc,
      nodes: [
        {
          id: "reference",
          kind: "image",
          laneId: "l1",
          stageId: "s1",
          rect: { x: 50, y: 50, w: 320, h: 240 },
          caption: { title: "Reference" },
          anchors: [{ id: "right", side: "right", offset: 0.5 }],
          source: { path: "/assets/reference.svg" },
          fit: "cover",
          focalPosition: { x: 0.5, y: 0.5 },
          alt: "Reference screen",
        },
      ],
    };
    const saved = parse(
      await callTool(t, token, "canvas_save", {
        ref: "gallery/images",
        kind: "canvas",
        doc: canvasFile(imageDoc),
        files: [{ path: "/assets/reference.svg", text: "<svg/>" }],
      }),
    );
    expect(saved.isError).toBeFalsy();
    expect(saved.data.version).toBe(1);

    const missing = parse(
      await callTool(t, token, "canvas_save", {
        ref: "gallery/missing-image",
        title: "Must roll back",
        kind: "canvas",
        doc: canvasFile(imageDoc),
      }),
    );
    expect(missing.isError).toBe(true);
    const canvases = await t.run((ctx) => ctx.db.query("canvases").collect());
    expect(canvases.some((canvas) => canvas.slug === "missing-image")).toBe(false);
  });

  test("canvas_snapshot resolves ref_id, returns an image block, and reuses its cache", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/doc",
      kind: "canvas",
      doc: canvasFile(),
    });
    const snapshotStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], { type: "image/png" }),
      ),
    );
    const worker = await startMockRenderWorker({
      renderStorageId: snapshotStorageId,
      snapshotStorageId,
    });
    try {
      const first = await callTool(t, token, "canvas_snapshot", {
        ref_id: "canvas://osago/doc?node=n1",
      });
      const firstResult = first.result as {
        content: Array<{ type: string; data?: string; mimeType?: string }>;
        structuredContent: { cached: boolean; ref_id: string; width: number };
        isError?: boolean;
      };
      expect(firstResult.isError).toBeFalsy();
      expect(firstResult.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
      expect(firstResult.content[1]?.data).toBe("iVBORwECAwQ=");
      expect(firstResult.structuredContent).toMatchObject({
        cached: false,
        ref_id: "canvas://osago/doc?node=n1",
        width: 240,
      });
      expect(worker.requests.snapshot).toHaveLength(1);

      const second = await callTool(t, token, "canvas_snapshot", {
        ref_id: "canvas://osago/doc?node=n1",
      });
      expect(
        (second.result as { structuredContent: { cached: boolean } }).structuredContent.cached,
      ).toBe(true);
      expect(worker.requests.snapshot).toHaveLength(1);
    } finally {
      await worker.close();
    }
  });

  test("canvas_snapshot selects one Page and rejects stale Page ids before rendering", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "pages/snapshot",
      kind: "canvas",
      doc: {
        ...canvasFile(),
        pages: [
          { id: "overview", title: "Overview", order: 0, doc: baseDoc },
          {
            id: "details",
            title: "Details",
            order: 1,
            doc: { ...baseDoc, title: "Details", world: { width: 640, height: 960 } },
          },
        ],
      },
    });
    const snapshotStorageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      ),
    );
    const worker = await startMockRenderWorker({
      renderStorageId: snapshotStorageId,
      snapshotStorageId,
    });
    try {
      const focused = parse(
        await callTool(t, token, "canvas_snapshot", {
          ref: "pages/snapshot",
          page_id: "details",
          refresh: true,
        }),
      );
      expect(focused.isError).toBeFalsy();
      expect(focused.data.page_id).toBe("details");
      expect(worker.requests.snapshot).toHaveLength(1);

      const stale = parse(
        await callTool(t, token, "canvas_snapshot", {
          ref: "pages/snapshot",
          page_id: "removed",
          refresh: true,
        }),
      );
      expect(stale.isError).toBe(true);
      expect(stale.text).toMatch(/page_not_found: removed/);
      expect(worker.requests.snapshot).toHaveLength(1);
    } finally {
      await worker.close();
    }
  });

  test("canvas_snapshot retries transient iframe readiness once and reports attempts", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/retry-snapshot",
      kind: "canvas",
      doc: canvasFile(),
    });
    const storageIds = await t.run(async (ctx) =>
      Promise.all(
        [1, 2].map((suffix) =>
          ctx.storage.store(
            new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, suffix])], {
              type: "image/png",
            }),
          ),
        ),
      ),
    );
    const renderStorageId = storageIds[1];
    if (!renderStorageId) throw new Error("Expected retry snapshot storage fixture");
    const worker = await startMockRenderWorker({
      renderStorageId,
      snapshotStorageIds: storageIds,
      snapshotReadiness: [
        { status: "partial", warnings: ["iframe readiness timeout: n1"] },
        { status: "ready", warnings: [] },
      ],
    });
    try {
      const response = parse(
        await callTool(t, token, "canvas_snapshot", {
          ref: "osago/retry-snapshot",
          refresh: true,
        }),
      );
      expect(response.isError).toBeFalsy();
      expect(response.data.status).toBe("ok");
      expect(response.data.diagnostics.attempts).toBe(2);
      expect(worker.requests.snapshot).toHaveLength(2);
    } finally {
      await worker.close();
    }
  });

  test("canvas_snapshot returns actionable unresolved details and QA tiles when downscaled", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/large-snapshot",
      kind: "canvas",
      doc: canvasFile({
        ...baseDoc,
        world: { width: 5_000, height: 3_000 },
      }),
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      ),
    );
    const worker = await startMockRenderWorker({
      renderStorageId: storageId,
      snapshotStorageId: storageId,
      snapshotDownscaled: true,
      snapshotUnresolvedDetails: [
        {
          ref: "/assets/missing.svg",
          resourceType: "image",
          reason: "missing_local_file",
        },
      ],
    });
    try {
      const response = parse(
        await callTool(t, token, "canvas_snapshot", {
          ref: "osago/large-snapshot",
          refresh: true,
        }),
      );
      expect(response.data.status).toBe("partial");
      expect(response.data.warnings).toEqual(["unresolved_asset", "output_downscaled"]);
      expect(response.data.diagnostics.unresolved_resources).toEqual([
        {
          ref: "/assets/missing.svg",
          resource_type: "image",
          reason: "missing_local_file",
        },
      ]);
      expect(response.data.diagnostics.suggested_regions).toHaveLength(6);
      expect(response.data.diagnostics.suggested_regions[0]).toEqual({
        type: "region",
        x: 0,
        y: 0,
        width: 2_048,
        height: 2_048,
      });
      expect(response.data.diagnostics.regions_truncated).toBe(false);
    } finally {
      await worker.close();
    }
  });

  test("canvas_snapshot does not inline PNGs above the transport-safe byte cap", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/large-inline-snapshot",
      kind: "canvas",
      doc: canvasFile({ ...baseDoc, world: { width: 5_000, height: 3_000 } }),
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      ),
    );
    const worker = await startMockRenderWorker({
      renderStorageId: storageId,
      snapshotStorageId: storageId,
      snapshotSize: 5 * 1024 * 1024 + 1,
    });
    try {
      const raw = await callTool(t, token, "canvas_snapshot", {
        ref: "osago/large-inline-snapshot",
        refresh: true,
      });
      const response = parse(raw);
      expect(response.data).toMatchObject({
        status: "partial",
        inline: false,
        warnings: ["snapshot_too_large"],
      });
      expect(response.data.download_url).toMatch(/^https?:\/\//);
      expect(response.data.diagnostics.suggested_regions).toHaveLength(6);
      expect((raw as { result: { content: Array<{ type: string }> } }).result.content).toHaveLength(
        1,
      );
    } finally {
      await worker.close();
    }
  });

  test("a large partial snapshot keeps a downloadable result without becoming reusable cache", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/large-partial-snapshot",
      kind: "canvas",
      doc: canvasFile(),
    });
    const storageIds = await Promise.all(
      [1, 2].map(() =>
        t.run((ctx) =>
          ctx.storage.store(
            new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
          ),
        ),
      ),
    );
    const worker = await startMockRenderWorker({
      renderStorageId: storageIds[1] as string,
      snapshotStorageIds: storageIds,
      snapshotSize: 5 * 1024 * 1024 + 1,
      snapshotReadiness: [
        { status: "partial", warnings: ["iframe readiness timeout: n1"] },
        { status: "partial", warnings: ["iframe readiness timeout: n1"] },
      ],
    });
    try {
      const raw = await callTool(t, token, "canvas_snapshot", {
        ref: "osago/large-partial-snapshot",
        refresh: true,
      });
      const response = parse(raw);
      expect(response.data).toMatchObject({ status: "partial", inline: false });
      expect(response.data.warnings).toEqual(["iframe_not_ready", "snapshot_too_large"]);
      expect(response.data.download_url).toMatch(/^https?:\/\//);
      expect(
        await t.run(
          async (ctx) => (await ctx.storage.get(storageIds[1] as Id<"_storage">)) !== null,
        ),
      ).toBe(true);
      expect((raw as { result: { content: Array<{ type: string }> } }).result.content).toHaveLength(
        1,
      );
    } finally {
      await worker.close();
    }
  });

  test("canvas_snapshot reports version conflicts and missing nodes before calling the worker", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/doc",
      kind: "canvas",
      doc: canvasFile(),
    });
    const conflict = parse(
      await callTool(t, token, "canvas_snapshot", {
        ref: "osago/doc",
        expected_version: 9,
      }),
    );
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toMatch(/version_conflict/);
    const missing = parse(
      await callTool(t, token, "canvas_snapshot", {
        ref_id: "canvas://osago/doc?node=missing",
      }),
    );
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/node_not_found/);
  });

  test("missing iframe entrypoint fails with an actionable path", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const { isError, text } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/missing",
        kind: "canvas",
        doc: canvasFile({
          ...baseDoc,
          nodes: [
            {
              id: "screen",
              kind: "iframe",
              laneId: "l1",
              stageId: "s1",
              rect: { x: 50, y: 50, w: 300, h: 240 },
              caption: { title: "Screen" },
              anchors: [{ id: "right", side: "right", offset: 0.5 }],
              source: { entrypoint: "/src/screens/missing.html" },
              viewport: { width: 284, height: 642 },
              frame: { kind: "phone", time: "09:42" },
              sandbox: ["allow-scripts"],
              permissions: [],
              activation: "double-click",
            },
          ],
        }),
      }),
    );
    expect(isError).toBe(true);
    expect(text).toMatch(/\/src\/screens\/missing\.html/);
    expect(text).toMatch(/same canvas_save/i);
  });

  test("a doc with no HTML nodes never calls the worker", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const worker = await startMockCompileCssWorker();
    try {
      const { isError } = parse(
        await callTool(t, token, "canvas_save", {
          ref: "osago/doc",
          kind: "canvas",
          doc: canvasFile(),
        }),
      );
      expect(isError).toBeFalsy();
      expect(worker.requests).toHaveLength(0);
    } finally {
      await worker.close();
    }
  });

  test("a render marked primary drives the thumbnail, whatever order renders ran in", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const pngStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["png"], { type: "image/png" })),
    );
    const thumbStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["thumb"], { type: "image/png" })),
    );
    const worker = await startMockRenderWorker({
      renderStorageId: pngStorageId,
      thumbnailStorageId: thumbStorageId,
    });
    try {
      const { isError, data } = parse(
        await callTool(t, token, "canvas_save", {
          ref: "osago/report",
          files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
          renders: [
            {
              target: { type: "file", entrypoint: "/src/index.html", route: "#/checkout" },
              format: "png",
              primary: true,
            },
          ],
        }),
      );

      expect(isError).toBeFalsy();
      expect(data.status).toBe("ok");
      const artifacts = data.artifacts as Array<{ path: string; role: string }>;
      expect(artifacts[0]?.role).toBe("primary");
      // The v1 trap: an html-first render claimed primary forever, so every
      // later PNG's thumbnail was discarded and the gallery stayed blank.
      expect(data.thumbnail_url).not.toBeNull();
      expect(worker.requests.render[0]).toMatchObject({ route: "#/checkout" });
      const versions = await t.run((ctx) => ctx.db.query("canvasVersions").collect());
      expect(versions).toHaveLength(1);
    } finally {
      await worker.close();
    }
  });

  test("output_path without a leading slash is normalized before it is recorded", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const pngStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["png"], { type: "image/png" })),
    );
    const worker = await startMockRenderWorker({ renderStorageId: pngStorageId });
    try {
      await callTool(t, token, "canvas_save", {
        ref: "osago/report",
        files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
        renders: [
          {
            target: { type: "file", entrypoint: "/src/index.html" },
            format: "png",
            output_path: "output/x.png",
          },
        ],
      });
      const sent = worker.requests.render[0] as { outputPath: string };
      // Un-normalized, this recorded an artifact /s/:slug could never serve
      // and the /cache TTL cron never swept.
      expect(sent.outputPath).toBe("/output/x.png");
    } finally {
      await worker.close();
    }
  });

  test("a failed render leaves the content saved and reports status partial", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    // startMockCompileCssWorker only implements /compile-css, so /render 404s.
    const worker = await startMockCompileCssWorker();
    try {
      const { isError, data } = parse(
        await callTool(t, token, "canvas_save", {
          ref: "osago/report",
          files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
          renders: [{ target: { type: "file", entrypoint: "/src/index.html" }, format: "png" }],
        }),
      );

      expect(isError).toBeFalsy();
      expect(data.status).toBe("partial");
      const warnings = data.warnings as Array<{ code: string }>;
      expect(warnings.some((w) => w.code === "render_failed")).toBe(true);
      // The file still landed — a render failure must not lose the content.
      expect(data.files_written).toHaveLength(1);
    } finally {
      await worker.close();
    }
  });

  test("rendering a nonexistent entrypoint fails fast, naming the files that exist", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const { data } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/report",
        files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
        renders: [{ target: { type: "file", entrypoint: "/src/typo.html" }, format: "png" }],
      }),
    );
    const warnings = data.warnings as Array<{ message: string }>;
    expect(warnings.some((w) => w.message.includes("/src/index.html"))).toBe(true);
  });

  test("mode create refuses to overwrite, which is what makes a retry safe", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", { ref: "osago/report" });
    const { isError, text } = parse(
      await callTool(t, token, "canvas_save", { ref: "osago/report", mode: "create" }),
    );
    expect(isError).toBe(true);
    expect(text).toMatch(/already exists/i);
  });

  test("canvas_get returns a typed stale-ref error instead of guessing", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/fast-settlement",
      kind: "canvas",
      doc: canvasFile(),
    });

    const { isError, text } = parse(
      await callTool(t, token, "canvas_get", {
        ref_id: "canvas://osago/fast-settlement?node=deleted",
      }),
    );
    expect(isError).toBe(true);
    expect(text).toMatch(/^element_not_found:/);
  });

  test("Pages, prototype hotspots, and checkpoints round-trip through MCP atomically", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const created = parse(
      await callTool(t, token, "canvas_save", {
        ref: "prototype/checkout",
        kind: "canvas",
        doc: canvasFile(),
      }),
    ).data;

    const page = parse(
      await callTool(t, token, "canvas_page_create", {
        ref: "prototype/checkout",
        expected_version: 1,
        expected_draft_revision: created.draft_revision,
        page_id: "confirmation",
        title: "Confirmation",
        doc: { ...baseDoc, title: "Confirmation" },
      }),
    ).data;
    expect(page).toMatchObject({ version: 1, draft_revision: 2, dirty: true });
    expect(page.pages.map((item: { id: string }) => item.id)).toEqual(["overview", "confirmation"]);

    const started = parse(
      await callTool(t, token, "canvas_prototype_set_start", {
        ref: "prototype/checkout",
        expected_version: 1,
        expected_draft_revision: 2,
        start: { pageId: "overview", nodeId: "n1" },
      }),
    ).data;
    expect(started.draft_revision).toBe(3);

    const linked = parse(
      await callTool(t, token, "canvas_prototype_patch", {
        ref: "prototype/checkout",
        expected_version: 1,
        expected_draft_revision: 3,
        operations: [
          {
            op: "upsert",
            interaction: {
              id: "complete-checkout",
              source: { pageId: "overview", nodeId: "n1" },
              hotspot: { x: 10, y: 10, width: 120, height: 44 },
              trigger: "click",
              destination: { pageId: "confirmation", nodeId: "n1" },
              transition: "dissolve",
            },
          },
        ],
      }),
    ).data;
    expect(linked.draft_revision).toBe(4);

    const prototype = parse(
      await callTool(t, token, "canvas_prototype_get", { ref: "prototype/checkout" }),
    ).data;
    expect(prototype.prototype).toMatchObject({
      start: { pageId: "overview", nodeId: "n1" },
      interactions: [{ id: "complete-checkout", transition: "dissolve" }],
    });
    expect(prototype.present_url).toMatch(/\/present$/);

    const checkpoint = parse(
      await callTool(t, token, "canvas_checkpoint", {
        ref: "prototype/checkout",
        expected_draft_revision: 4,
        note: "Prototype ready",
      }),
    ).data;
    expect(checkpoint).toMatchObject({ version: 2, draft_revision: 4, dirty: false });

    const deleted = parse(
      await callTool(t, token, "canvas_page_delete", {
        ref: "prototype/checkout",
        expected_version: 2,
        expected_draft_revision: 4,
        page_id: "confirmation",
      }),
    ).data;
    expect(deleted.pages).toHaveLength(1);
    const cleaned = parse(
      await callTool(t, token, "canvas_prototype_get", { ref: "prototype/checkout" }),
    ).data;
    expect(cleaned.prototype.interactions).toEqual([]);

    const finalPage = parse(
      await callTool(t, token, "canvas_page_delete", {
        ref: "prototype/checkout",
        expected_version: 2,
        expected_draft_revision: 5,
        page_id: "overview",
      }),
    );
    expect(finalPage.isError).toBe(true);
    expect(finalPage.text).toMatch(/cannot delete the final Page/);

    const restored = await t.mutation(internal.canvases.restoreVersionByRef, {
      ref: "prototype/checkout",
      version: 2,
    });
    expect(restored.version).toBe(3);
    const restoredPages = parse(
      await callTool(t, token, "canvas_page_list", { ref: "prototype/checkout" }),
    ).data;
    expect(restoredPages.pages.map((item: { id: string }) => item.id)).toEqual([
      "overview",
      "confirmation",
    ]);
    const restoredPrototype = parse(
      await callTool(t, token, "canvas_prototype_get", { ref: "prototype/checkout" }),
    ).data;
    expect(restoredPrototype.prototype).toMatchObject({
      start: { pageId: "overview", nodeId: "n1" },
      interactions: [{ id: "complete-checkout", destination: { pageId: "confirmation" } }],
    });
  });

  test("all MCP Page operations preserve stable ids, ordering, and draft concurrency", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const created = parse(
      await callTool(t, token, "canvas_save", {
        ref: "pages/lifecycle",
        kind: "canvas",
        doc: canvasFile(),
      }),
    ).data;
    expect(created.draft_revision).toBe(1);

    const added = parse(
      await callTool(t, token, "canvas_page_create", {
        ref: "pages/lifecycle",
        expected_version: 1,
        expected_draft_revision: 1,
        page_id: "details",
        title: "Details",
      }),
    ).data;
    expect(added.draft_revision).toBe(2);

    const renamed = parse(
      await callTool(t, token, "canvas_page_rename", {
        ref: "pages/lifecycle",
        expected_version: 1,
        expected_draft_revision: 2,
        page_id: "details",
        title: "Complete",
      }),
    ).data;
    expect(renamed.pages.find((page: { id: string }) => page.id === "details").title).toBe(
      "Complete",
    );

    const duplicated = parse(
      await callTool(t, token, "canvas_page_duplicate", {
        ref: "pages/lifecycle",
        expected_version: 1,
        expected_draft_revision: 3,
        page_id: "details",
        new_page_id: "details-copy",
      }),
    ).data;
    expect(duplicated.page.id).toBe("details-copy");

    const moved = parse(
      await callTool(t, token, "canvas_page_move", {
        ref: "pages/lifecycle",
        expected_version: 1,
        expected_draft_revision: 4,
        page_id: "details-copy",
        to_index: 0,
      }),
    ).data;
    expect(moved.pages.map((page: { id: string }) => page.id)).toEqual([
      "details-copy",
      "overview",
      "details",
    ]);

    const conflict = parse(
      await callTool(t, token, "canvas_page_rename", {
        ref: "pages/lifecycle",
        expected_version: 1,
        expected_draft_revision: 4,
        page_id: "details",
        title: "Stale write",
      }),
    );
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toMatch(/draft conflict/i);

    const deleted = parse(
      await callTool(t, token, "canvas_page_delete", {
        ref: "pages/lifecycle",
        expected_version: 1,
        expected_draft_revision: 5,
        page_id: "details-copy",
      }),
    ).data;
    expect(deleted.pages.map((page: { id: string }) => page.id)).toEqual(["overview", "details"]);
    expect(deleted.draft_revision).toBe(6);
  });
});

describe("/mcp incremental edits and pagination", () => {
  function parse(response: { result?: unknown }) {
    const result = response.result as {
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    return {
      isError: result.isError,
      text,
      data: result.isError ? {} : (result.structuredContent ?? JSON.parse(text || "{}")),
    };
  }

  test("canvas_edit coalesces file edits into the current draft", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "parallel/edit",
      files: [{ path: "/src/a.txt", text: "alpha" }],
    });
    const file = parse(
      await callTool(t, token, "canvas_file_get", { ref: "parallel/edit", path: "/src/a.txt" }),
    ).data;
    await callTool(t, token, "canvas_save", {
      ref: "parallel/edit",
      expected_version: 1,
      files: [{ path: "/src/b.txt", text: "other writer" }],
    });

    const rebased = parse(
      await callTool(t, token, "canvas_edit", {
        ref: "parallel/edit",
        file_path: "/src/a.txt",
        old_string: "alpha",
        new_string: "bravo",
        expected_version: 1,
        expected_hash: file.content_hash,
      }),
    );
    expect(rebased.isError).toBeFalsy();
    expect(rebased.data).toMatchObject({
      requested_version: 1,
      previous_version: 1,
      version: 1,
      draft_revision: 3,
      dirty: true,
      rebased: false,
    });

    const unsafe = parse(
      await callTool(t, token, "canvas_edit", {
        ref: "parallel/edit",
        file_path: "/src/a.txt",
        old_string: "bravo",
        new_string: "charlie",
        expected_version: 1,
        expected_draft_revision: 2,
      }),
    );
    expect(unsafe.isError).toBe(true);
    expect(unsafe.text).toMatch(/draft conflict/i);
  });

  test("canvas_apply_patch coalesces all touched files into the current draft", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "parallel/patch",
      files: [{ path: "/src/a.txt", text: "alpha\n" }],
    });
    const file = parse(
      await callTool(t, token, "canvas_file_get", {
        ref: "parallel/patch",
        path: "/src/a.txt",
      }),
    ).data;
    await callTool(t, token, "canvas_save", {
      ref: "parallel/patch",
      expected_version: 1,
      files: [{ path: "/src/b.txt", text: "other" }],
    });
    const response = parse(
      await callTool(t, token, "canvas_apply_patch", {
        ref: "parallel/patch",
        expected_version: 1,
        expected_hashes: { "/src/a.txt": file.content_hash },
        patch: [
          "*** Begin Patch",
          "*** Update File: /src/a.txt",
          "@@",
          "-alpha",
          "+bravo",
          "*** End Patch",
        ].join("\n"),
      }),
    );
    expect(response.isError).toBeFalsy();
    expect(response.data).toMatchObject({
      previous_version: 1,
      version: 1,
      draft_revision: 3,
      dirty: true,
      rebased: false,
    });
  });

  test("canvas_get and canvas_find expose resumable cursors", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    for (const [index, slug] of ["one", "two", "three"].entries()) {
      await callTool(t, token, "canvas_save", {
        ref: `pages/${slug}`,
        title: `Page ${index}`,
        files: [{ path: "/src/index.txt", text: `v${index}` }],
      });
    }
    await callTool(t, token, "canvas_save", {
      ref: "pages/one",
      expected_version: 1,
      files: [{ path: "/src/index.txt", text: "v-next" }],
    });
    await callTool(t, token, "canvas_checkpoint", {
      ref: "pages/one",
      note: "Second stable checkpoint",
      expected_draft_revision: 2,
    });

    const firstGet = parse(
      await callTool(t, token, "canvas_get", {
        ref: "pages/one",
        include: ["versions"],
        pagination: { limit: 1 },
      }),
    ).data;
    expect(firstGet.versions).toHaveLength(1);
    expect(firstGet.pagination.versions.is_done).toBe(false);
    const secondGet = parse(
      await callTool(t, token, "canvas_get", {
        ref: "pages/one",
        include: ["versions"],
        pagination: {
          limit: 1,
          expected_version: firstGet.canvas.version,
          versions_cursor: firstGet.pagination.versions.next_cursor,
        },
      }),
    ).data;
    expect(secondGet.versions).toHaveLength(1);
    expect(secondGet.versions[0].version).not.toBe(firstGet.versions[0].version);

    const projected = parse(
      await callTool(t, token, "canvas_save", {
        ref: "pages/doc",
        kind: "canvas",
        doc: {
          version: 3,
          defaultPageId: "overview",
          pages: [
            {
              id: "overview",
              title: "Overview",
              order: 0,
              doc: {
                version: 2,
                title: "Large doc",
                world: { width: 1000, height: 500 },
                lanes: [],
                stages: [],
                labels: [],
                nodes: [
                  {
                    id: "wanted",
                    kind: "native",
                    rect: { x: 0, y: 0, w: 100, h: 100 },
                    shape: "note",
                    caption: { title: "Wanted" },
                    anchors: [{ id: "right", side: "right", offset: 0.5 }],
                  },
                  {
                    id: "other",
                    kind: "native",
                    rect: { x: 200, y: 0, w: 100, h: 100 },
                    shape: "note",
                    caption: { title: "Other" },
                    anchors: [{ id: "left", side: "left", offset: 0.5 }],
                  },
                ],
                edges: [],
              },
            },
          ],
          prototype: { interactions: [] },
        },
      }),
    );
    expect(projected.isError).toBeFalsy();
    const projection = parse(
      await callTool(t, token, "canvas_get", {
        ref: "pages/doc",
        include: ["doc"],
        doc_projection: { summary: true, node_ids: ["wanted"] },
      }),
    ).data;
    expect(projection.doc.activePage.doc.counts.nodes).toBe(2);
    expect(projection.doc.activePage.doc.nodes).toHaveLength(1);
    expect(projection.doc.activePage.doc.nodes[0].id).toBe("wanted");

    const firstFind = parse(
      await callTool(t, token, "canvas_find", { workspace: "pages", limit: 1 }),
    ).data;
    expect(firstFind.canvases).toHaveLength(1);
    expect(firstFind.next_cursor).toEqual(expect.any(String));
    const secondFind = parse(
      await callTool(t, token, "canvas_find", {
        workspace: "pages",
        limit: 1,
        cursor: firstFind.next_cursor,
      }),
    ).data;
    expect(secondFind.canvases[0].canvas_id).not.toBe(firstFind.canvases[0].canvas_id);
  });
});

describe("/mcp canvas_delete, canvas_find, canvas_upload_url", () => {
  function parse(response: { result?: unknown }) {
    const result = response.result as {
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    // Error results carry a prose message, not JSON — only parse successes.
    const data = result.isError ? {} : (result.structuredContent ?? JSON.parse(text || "{}"));
    return { isError: result.isError, text, data };
  }

  test("archiving hides a canvas; purging reclaims its bytes", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/report",
      files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
    });

    const archived = parse(
      await callTool(t, token, "canvas_delete", { ref: "osago/report", target: "canvas" }),
    );
    expect(archived.data.archived).toBe(true);

    const purged = parse(
      await callTool(t, token, "canvas_delete", {
        ref: "osago/report",
        target: "canvas",
        purge: true,
      }),
    );
    // The advice v1's quota error gave ("remove old files") with no tool that could.
    expect(purged.data.bytes_reclaimed).toBeGreaterThan(0);
  });

  test("individual files and artifacts require an explicit permanent purge", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", {
      ref: "osago/report",
      files: [{ path: "/src/index.html", text: "<h1>hi</h1>" }],
    });

    for (const [target, path] of [
      ["file", "/src/index.html"],
      ["artifact", "/output/report.png"],
    ] as const) {
      const omitted = parse(
        await callTool(t, token, "canvas_delete", { ref: "osago/report", target, path }),
      );
      expect(omitted.isError).toBe(true);
      expect(omitted.text).toMatch(/purge:true|required/i);
    }
  });

  test("canvas_find returns refs that can be passed straight back in", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", { ref: "osago/fast-settlement", title: "Settlement" });

    const { data } = parse(await callTool(t, token, "canvas_find", { query: "Settlement" }));
    const canvases = data.canvases as Array<{ ref: string; canvas_url: string }>;
    expect(canvases[0]?.ref).toBe("osago/fast-settlement");
    expect(canvases[0]?.canvas_url).toMatch(/^https:\/\/canvas\.test\/c\//);
  });

  test("canvas_upload_url hands back a URL and explains the handshake", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", { ref: "osago/report" });

    const { isError, data } = parse(
      await callTool(t, token, "canvas_upload_url", {
        ref: "osago/report",
        path: "/assets/photo.jpg",
      }),
    );
    expect(isError).toBeFalsy();
    expect(data.uploads[0].upload_id_field).toBe("storageId");
    expect(data.uploads[0].path).toBe("/assets/photo.jpg");
    expect(typeof data.uploads[0].upload_url).toBe("string");
  });

  test("canvas_upload_url validates the destination before an upload is wasted", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    await callTool(t, token, "canvas_save", { ref: "osago/report" });

    const { isError } = parse(
      await callTool(t, token, "canvas_upload_url", {
        ref: "osago/report",
        path: "/cache/photo.jpg",
      }),
    );
    expect(isError).toBe(true);
  });
});

describe("/mcp asset lifecycle", () => {
  function parse(response: { result?: unknown }) {
    const result = response.result as {
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    const text = result.content?.find((item) => item.type === "text")?.text ?? "";
    const data = result.isError ? {} : (result.structuredContent ?? JSON.parse(text || "{}"));
    return { isError: result.isError, text, data };
  }

  test("moves without re-uploading, invalidates the old ref, and archives reversibly", async () => {
    const t = convexTest(schema, modules);
    const { token, userId } = await seedUserWithToken(t);
    const workspaceId = await t.run((ctx) =>
      ctx.db.insert("workspaces", { slug: "brand", name: "Brand", createdBy: userId }),
    );
    const asset = await t.mutation(internal.assets.commitAssetVersion, {
      scope: "workspace",
      ownerUserId: userId,
      workspaceId,
      workspaceSlug: "brand",
      slug: "logo",
      name: "Logo",
      tags: ["brand"],
      kind: "image",
      sourceObjectKey: "source/logo",
      deliveryObjectKey: "delivery/logo",
      previewObjectKey: "delivery/logo",
      contentHash: "logo-hash",
      mimeType: "image/png",
      size: 12,
      originalFilename: "logo.png",
      sourceType: "upload",
    });
    const previousRef = "asset://workspace/brand/logo@1";
    const moved = parse(
      await callTool(t, token, "asset_move", {
        asset_ref: previousRef,
        destination_scope: "personal",
      }),
    );
    expect(moved.isError).toBeFalsy();
    expect(moved.data).toMatchObject({
      status: "ok",
      previous_asset_ref: previousRef,
      asset_ref: "asset://personal/logo@1",
    });
    expect((await t.run((ctx) => ctx.db.get(asset.versionId)))?.deliveryObjectKey).toBe(
      "delivery/logo",
    );
    expect(parse(await callTool(t, token, "asset_get", { asset_ref: previousRef })).isError).toBe(
      true,
    );

    const archived = parse(
      await callTool(t, token, "asset_delete", { asset_ref: "asset://personal/logo@1" }),
    );
    expect(archived.data).toMatchObject({
      status: "ok",
      operation: "archived",
      reversible: true,
    });
    const listed = parse(await callTool(t, token, "asset_list", { scope: "personal" }));
    expect(listed.data).toMatchObject({ count: 0, assets: [] });

    const restored = parse(
      await callTool(t, token, "asset_restore", { asset_ref: "asset://personal/logo@1" }),
    );
    expect(restored.data).toMatchObject({
      status: "ok",
      asset_ref: "asset://personal/logo@1",
      operation: "restored",
    });
    expect(
      (
        await t.query(internal.assets.listInternal, {
          userId,
          scope: "personal",
          paginationOpts: { numItems: 50, cursor: null },
        })
      ).page,
    ).toHaveLength(1);
  });

  test("batch finalize marks an expired upload as terminal", async () => {
    const t = convexTest(schema, modules);
    const { token, userId } = await seedUserWithToken(t);
    const uploadId = await t.run((ctx) =>
      ctx.db.insert("assetUploads", {
        scope: "personal",
        ownerUserId: userId,
        sourceObjectKey: "staging/expired",
        filename: "expired.png",
        declaredMimeType: "image/png",
        createdBy: userId,
        expiresAt: 0,
      }),
    );

    const response = parse(
      await callTool(t, token, "asset_finalize", {
        items: [{ upload_id: uploadId, name: "Expired" }],
      }),
    );
    expect(response.data).toMatchObject({
      status: "partial",
      succeeded: 0,
      failed: 1,
      results: [
        {
          status: "error",
          upload_id: uploadId,
          retryable: false,
        },
      ],
    });
  });
});

describe("GET /s/:slug", () => {
  async function seedPublicCanvasWithArtifact(
    t: ReturnType<typeof convexTest>,
    overrides: {
      visibility?: "private" | "public";
      publicSlug?: string;
      artifactType?: "pdf" | "image" | "svg" | "source";
      artifactMime?: string;
      relPath?: string;
      role?: "primary" | "supporting";
      body?: string;
    } = {},
  ) {
    return t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "owner@iota.uz",
        name: "Owner",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "ws",
        name: "WS",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "canvas",
        title: "Public Canvas",
        kind: "html",
        visibility: overrides.visibility ?? "public",
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: 0,
        draftIframeEntrypoints: [],
        storageBytesUsed: 0,
        publicSlug: overrides.publicSlug ?? "pub-slug-123",
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
        iframeEntrypoints: [],
      });
      await ctx.db.patch(canvasId, {
        currentVersionId: versionId,
        publishedVersionId: (overrides.visibility ?? "public") === "public" ? versionId : undefined,
      });
      const storageId = await ctx.storage.store(
        new Blob([overrides.body ?? "<h1>hi</h1>"], {
          type: overrides.artifactMime ?? "text/html",
        }),
      );
      await ctx.db.insert("artifacts", {
        canvasId,
        versionId,
        relPath: overrides.relPath ?? "/output/index.html",
        type: overrides.artifactType ?? "source",
        role: overrides.role ?? "primary",
        mimeType: overrides.artifactMime ?? "text/html",
        size: (overrides.body ?? "<h1>hi</h1>").length,
        storageId,
      });
      return { canvasId, storageId };
    });
  }

  test("serves the primary artifact with CSP + nosniff headers, no auth required", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);

    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hi</h1>");
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src[^;]*cdn\.tailwindcss\.com/);
  });

  test("scopes workspace-root references inside public HTML", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t, {
      body: [
        '<img src="/assets/screen.png">',
        '<script>const runtime="/src/runtime.js";</script>',
        "<style>.hero{background:url(/assets/background.png)}</style>",
        '<img src="https://cdn.example/assets/external.png">',
      ].join(""),
    });

    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });
    const html = await res.text();

    expect(html).toContain('src="/s/pub-slug-123/assets/screen.png?v=1"');
    expect(html).toContain('runtime="/s/pub-slug-123/src/runtime.js?v=1"');
    expect(html).toContain("url(/s/pub-slug-123/assets/background.png?v=1)");
    expect(html).toContain('src="https://cdn.example/assets/external.png"');
  });

  test("pins scoped subresources to the artifact version and inserts v before fragments", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t, {
      body: '<link rel="stylesheet" href="/assets/theme.css#palette">',
    });
    await seedAsset(t, canvasId, "/assets/theme.css", "old-version");
    await t.run(async (ctx) => {
      const canvas = await ctx.db.get(canvasId);
      if (!canvas) throw new Error("missing canvas");
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 2,
        createdBy: canvas.createdBy,
        iframeEntrypoints: [],
      });
      const storageId = await ctx.storage.store(new Blob(["new-version"]));
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId,
        relPath: "/assets/theme.css",
        storageId,
        size: 11,
        contentHash: "new",
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId, publishedVersionId: versionId });
    });

    const html = await (await t.fetch("/s/pub-slug-123")).text();
    expect(html).toContain('href="/s/pub-slug-123/assets/theme.css?v=1#palette"');
    expect(await (await t.fetch("/s/pub-slug-123/assets/theme.css?v=1")).text()).toBe(
      "old-version",
    );
    expect(await (await t.fetch("/s/pub-slug-123/assets/theme.css")).text()).toBe("new-version");
  });

  test("404s for an unknown slug", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/s/does-not-exist", { method: "GET" });
    expect(res.status).toBe(404);
  });

  test("404s for a private canvas's slug — visibility is the only gate on this route", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t, { visibility: "private" });
    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });
    expect(res.status).toBe(404);
  });

  test("serves crawler metadata only while the public slug is live", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    const live = await t.fetch("/social/pub-slug-123");
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(await live.json()).toMatchObject({
      title: "Public Canvas",
      description: "A visual canvas shared from Visual Canvas.",
      version: 1,
      thumbnail_url: null,
    });

    await t.run((ctx) => ctx.db.patch(canvasId, { visibility: "private", publicSlug: undefined }));
    expect((await t.fetch("/social/pub-slug-123")).status).toBe(404);
    expect((await t.fetch("/social/never-minted")).status).toBe(404);
  });

  test("serves a script-free pinned GitHub/Markdown preview card", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);

    const res = await t.fetch(
      "/s/pub-slug-123/_embed/card.svg?target=artifact&id=%2Foutput%2Findex.html&version=1",
      { method: "GET" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/);
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const svg = await res.text();
    expect(svg).toContain("index.html");
    expect(svg).toContain("Public Canvas");
    expect(svg).not.toContain("<script");
  });

  test("an image artifact card contains the artifact preview bytes", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t, {
      artifactType: "image",
      artifactMime: "image/png",
      relPath: "/output/screen.png",
      body: "PNG-preview-bytes",
    });

    const res = await t.fetch(
      "/s/pub-slug-123/_embed/card.svg?target=artifact&id=%2Foutput%2Fscreen.png&version=1",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("data:image/png;base64,");
  });

  test("latest cards use short caching and unpublishing revokes them", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    const live = await t.fetch("/s/pub-slug-123/_embed/card.svg?target=canvas");
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toContain("max-age=60");

    await t.run(async (ctx) => {
      await ctx.db.patch(canvasId, { visibility: "private", publicSlug: undefined });
    });
    expect((await t.fetch("/s/pub-slug-123/_embed/card.svg?target=canvas")).status).toBe(404);
  });

  test("rejects unknown card targets", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);
    const res = await t.fetch("/s/pub-slug-123/_embed/card.svg?target=website");
    expect(res.status).toBe(400);
  });

  test("serves an explicit relPath under the slug instead of the primary artifact", async () => {
    const t = convexTest(schema, modules);
    await seedPublicCanvasWithArtifact(t);
    await t.run(async (ctx) => {
      const canvas = await ctx.db
        .query("canvases")
        .withIndex("by_publicSlug", (q) => q.eq("publicSlug", "pub-slug-123"))
        .unique();
      if (!canvas) throw new Error("seed canvas missing");
      const versionId = await ctx.db
        .query("canvasVersions")
        .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvas._id))
        .first()
        .then((v) => v?._id);
      if (!versionId) throw new Error("seed version missing");
      const storageId = await ctx.storage.store(new Blob(["extra"], { type: "text/plain" }));
      await ctx.db.insert("artifacts", {
        canvasId: canvas._id,
        versionId,
        relPath: "/output/extra.txt",
        type: "source",
        role: "supporting",
        mimeType: "text/plain",
        size: 5,
        storageId,
      });
    });

    const res = await t.fetch("/s/pub-slug-123/output/extra.txt", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("extra");
  });

  test("SVG is served as an attachment, never inline", async () => {
    const t = convexTest(schema, modules);
    const svg = '<svg><image href="/assets/logo.png"/></svg>';
    await seedPublicCanvasWithArtifact(t, {
      artifactType: "svg",
      artifactMime: "image/svg+xml",
      relPath: "/output/diagram.svg",
      body: svg,
    });

    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(res.headers.get("content-disposition")).toMatch(/diagram\.svg/);
    expect(await res.text()).toBe(svg);
  });

  // A shared HTML artifact is a *page*, and a page has subresources. Until
  // these, `<img src="../assets/logo.png">` rendered fine in the worker (it
  // hydrates every canvasFile) and then 404'd for whoever opened the link,
  // because this route could only ever serve `artifacts` rows.
  async function seedAsset(
    t: ReturnType<typeof convexTest>,
    canvasId: Id<"canvases">,
    relPath: string,
    body: string,
  ) {
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([body]));
      await ctx.db.insert("canvasFiles", {
        canvasId,
        relPath,
        storageId,
        size: body.length,
        contentHash: "hash",
      });
      const canvas = await ctx.db.get(canvasId);
      if (!canvas?.currentVersionId) throw new Error("seed canvas has no current version");
      await ctx.db.insert("canvasVersionFiles", {
        canvasId,
        versionId: canvas.currentVersionId,
        relPath,
        storageId,
        size: body.length,
        contentHash: "hash",
      });
    });
  }

  test("serves a public canvas's /assets file, typed from its extension", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/assets/logo.png", "PNGBYTES");

    const res = await t.fetch("/s/pub-slug-123/assets/logo.png", { method: "GET" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PNGBYTES");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("resolves a version-pinned Asset Library binding for non-canvas public pages", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await t.run(async (ctx) => {
      const canvas = await ctx.db.get(canvasId);
      if (!canvas?.currentVersionId) throw new Error("seed canvas has no current version");
      const assetId = await ctx.db.insert("assets", {
        scope: "workspace",
        workspaceId: canvas.workspaceId,
        slug: "logo",
        name: "Logo",
        tags: [],
        kind: "image",
        searchText: "logo",
        createdBy: canvas.createdBy,
        updatedAt: 0,
      });
      const assetVersionId = await ctx.db.insert("assetVersions", {
        assetId,
        revision: 1,
        sourceObjectKey: "source/logo",
        deliveryObjectKey: "delivery/logo",
        previewObjectKey: "preview/logo",
        contentHash: "logo-hash",
        mimeType: "image/png",
        size: 123,
        originalFilename: "logo.png",
        sourceType: "upload",
        createdBy: canvas.createdBy,
      });
      await ctx.db.insert("canvasVersionAssets", {
        canvasId,
        versionId: canvas.currentVersionId,
        logicalPath: "/assets/logo.png",
        assetId,
        assetVersionId,
      });
    });

    expect(
      await t.query(internal.canvases.resolvePublicArtifact, {
        publicSlug: "pub-slug-123",
        relPath: "/assets/logo.png",
        version: 1,
      }),
    ).toMatchObject({
      objectKey: "delivery/logo",
      libraryAsset: true,
      mimeType: "image/png",
      version: 1,
    });
  });

  test("serves supported video with an executable media CSP and correct MIME", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/assets/demo.mp4", "MP4BYTES");

    const asset = await t.fetch("/s/pub-slug-123/assets/demo.mp4");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("video/mp4");
    const page = await t.fetch("/s/pub-slug-123");
    expect(page.headers.get("content-security-policy")).toMatch(/media-src 'self' blob:/);
  });

  test("serves only registered iframe HTML from the current immutable version snapshot", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "u@iota.uz",
        name: "U",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "w",
        name: "W",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "c",
        title: "C",
        kind: "canvas",
        visibility: "public",
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: 0,
        draftIframeEntrypoints: ["/src/screens/runtime.html"],
        storageBytesUsed: 0,
        publicSlug: "iframe-public",
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
        iframeEntrypoints: ["/src/screens/runtime.html"],
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId, publishedVersionId: versionId });
      for (const [relPath, body] of [
        ["/src/screens/runtime.html", "<!doctype html><button>Live</button>"],
        ["/src/screens/secret.html", "secret"],
      ] as const) {
        const storageId = await ctx.storage.store(new Blob([body]));
        await ctx.db.insert("canvasVersionFiles", {
          canvasId,
          versionId,
          relPath,
          storageId,
          size: body.length,
          contentHash: "hash",
        });
      }
    });
    const allowed = await t.fetch("/s/iframe-public/src/screens/runtime.html");
    expect(allowed.status).toBe(200);
    const html = await allowed.text();
    expect(html).toMatch(/visual-canvas:readiness/);
    expect(html).toMatch(/visual-canvas:lifecycle/);
    expect(html).toMatch(/visual-canvas:suspend/);
    expect(html).toMatch(/visual-canvas:resume/);
    expect(allowed.headers.get("content-security-policy")).not.toMatch(/allow-same-origin/);
    expect((await t.fetch("/s/iframe-public/src/screens/secret.html")).status).toBe(404);
  });

  test("an /assets SVG still downloads rather than rendering as a document", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/assets/logo.svg", "<svg/>");

    const res = await t.fetch("/s/pub-slug-123/assets/logo.svg", { method: "GET" });

    // Content-Disposition does not apply to `<img>` subresource loads, so
    // the logo still renders inside the page — but a direct navigation to
    // this URL must not execute SVG script on the shared origin.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  test("published non-canvas HTML serves its version-pinned /src dependencies", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t);
    await seedAsset(t, canvasId, "/src/index.html", "<h1>author source</h1>");

    const res = await t.fetch("/s/pub-slug-123/src/index.html", { method: "GET" });

    expect(res.status).toBe(200);
  });

  test("a private canvas's assets are not served either", async () => {
    const t = convexTest(schema, modules);
    const { canvasId } = await seedPublicCanvasWithArtifact(t, { visibility: "private" });
    await seedAsset(t, canvasId, "/assets/logo.png", "PNGBYTES");

    const res = await t.fetch("/s/pub-slug-123/assets/logo.png", { method: "GET" });

    expect(res.status).toBe(404);
  });
});

describe("GET /i/:capability", () => {
  test("serves current draft iframe HTML, scripts, styles and assets through the capability", async () => {
    const t = convexTest(schema, modules);
    const token = "private-iframe-capability";
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "owner@iota.uz",
        name: "Owner",
        lastSeenAt: 0,
      });
      const workspaceId = await ctx.db.insert("workspaces", {
        slug: "private-workspace",
        name: "Private workspace",
        createdBy: userId,
      });
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId,
        slug: "private-canvas",
        title: "Private canvas",
        kind: "canvas",
        visibility: "private",
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: 0,
        draftIframeEntrypoints: ["/src/screens/runtime.html"],
        storageBytesUsed: 0,
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
        iframeEntrypoints: ["/src/screens/runtime.html"],
      });
      await ctx.db.patch(canvasId, { currentVersionId: versionId });

      for (const [relPath, body] of [
        [
          "/src/screens/runtime.html",
          [
            '<link rel="stylesheet" href="/src/screen.css">',
            '<img src="/assets/screens/screen.png">',
            '<script>const runtime="/src/runtime.js";</script>',
            '<img src="https://cdn.example/assets/external.png">',
          ].join(""),
        ],
        ["/src/screen.css", ".hero{background:url(/assets/background.png)}"],
        ["/assets/screens/screen.png", "PNG"],
      ] as const) {
        const storageId = await ctx.storage.store(new Blob([body]));
        await ctx.db.insert("canvasFiles", {
          canvasId,
          relPath,
          storageId,
          size: body.length,
          contentHash: `hash:${relPath}`,
        });
      }
      await ctx.db.insert("iframeCapabilities", {
        token,
        canvasId,
        userId,
        expiresAt: Date.now() + 60_000,
      });
    });

    const htmlResponse = await t.fetch(`/i/${token}/src/screens/runtime.html`);
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain(`href="/i/${token}/src/screen.css"`);
    expect(html).toContain(`src="/i/${token}/assets/screens/screen.png"`);
    expect(html).toContain(`runtime="/i/${token}/src/runtime.js"`);
    expect(html).toContain('src="https://cdn.example/assets/external.png"');
    expect(html).toContain("visual-canvas:readiness");

    const cssResponse = await t.fetch(`/i/${token}/src/screen.css`);
    expect(cssResponse.status).toBe(200);
    expect(await cssResponse.text()).toBe(
      `.hero{background:url(/i/${token}/assets/background.png)}`,
    );

    const assetResponse = await t.fetch(`/i/${token}/assets/screens/screen.png`);
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toBe("PNG");
    expect((await t.fetch("/assets/screens/screen.png")).status).toBe(404);
  });
});
