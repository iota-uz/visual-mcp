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
  thumbnailStorageId?: string;
  renderSize?: number;
  css?: string;
}) {
  const token = "test-worker-token";
  const requests: { compileCss: Array<{ htmlFragments: string[] }>; render: unknown[] } = {
    compileCss: [],
    render: [],
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
    version: 1,
    title: "Test Canvas",
    lanes: [{ id: "l1", label: "Lane", role: "primary", height: 200 }],
    stages: [{ id: "s1", index: 0, label: "Stage" }],
    nodes: [{ id: "n1", lane: "l1", stage: "s1", shape: "note", caption: { title: "Node" } }],
    edges: [],
  };

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
    const paths = warnings.filter((w) => w.code === "unresolved_asset").map((w) => w.path);
    expect(paths).toContain("/accident-1.jpg");
    expect(paths).toContain("/assets/missing.png");
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

  test("a <script> in a doc node is rejected AND the offending node is named", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);

    const { isError, text } = parse(
      await callTool(t, token, "canvas_save", {
        ref: "osago/doc",
        kind: "canvas",
        doc: {
          ...baseDoc,
          nodes: [
            {
              ...baseDoc.nodes[0],
              content: { type: "html", html: "<script>alert(1)</script>" },
            },
          ],
        },
      }),
    );

    expect(isError).toBe(true);
    expect(text).toMatch(/script/i);
    // v1 dropped zod issue paths, so a 40-node doc reported the rule and
    // never said which node broke it.
    expect(text).toMatch(/nodes\.0/);
  });

  test("a doc with HTML nodes compiles Tailwind before storing anything", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seedUserWithToken(t);
    const worker = await startMockCompileCssWorker(".compiled{color:red}");
    try {
      const { isError, data } = parse(
        await callTool(t, token, "canvas_save", {
          ref: "osago/doc",
          kind: "canvas",
          doc: {
            ...baseDoc,
            nodes: [
              {
                ...baseDoc.nodes[0],
                content: { type: "html", html: '<div class="p-4">x</div>' },
              },
            ],
          },
        }),
      );
      expect(isError).toBeFalsy();
      expect(data.version).toBe(1);
      expect(worker.requests).toHaveLength(1);
    } finally {
      await worker.close();
    }
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
          doc: baseDoc,
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
          renders: [{ entrypoint: "/src/index.html", format: "png", primary: true }],
        }),
      );

      expect(isError).toBeFalsy();
      expect(data.status).toBe("ok");
      const artifacts = data.artifacts as Array<{ path: string; role: string }>;
      expect(artifacts[0]?.role).toBe("primary");
      // The v1 trap: an html-first render claimed primary forever, so every
      // later PNG's thumbnail was discarded and the gallery stayed blank.
      expect(data.thumbnail_url).not.toBeNull();
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
        renders: [{ entrypoint: "/src/index.html", format: "png", output_path: "output/x.png" }],
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
          renders: [{ entrypoint: "/src/index.html", format: "png" }],
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
        renders: [{ entrypoint: "/src/typo.html", format: "png" }],
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
    expect(data.upload_id_field).toBe("storageId");
    expect(data.path).toBe("/assets/photo.jpg");
    expect(typeof data.upload_url).toBe("string");
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
        googleSub: "bootstrap:owner@iota.uz",
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
        publicSlug: overrides.publicSlug ?? "pub-slug-123",
        createdBy: userId,
        updatedAt: 0,
      });
      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        createdBy: userId,
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
    await seedPublicCanvasWithArtifact(t, {
      artifactType: "svg",
      artifactMime: "image/svg+xml",
      relPath: "/output/diagram.svg",
      body: "<svg></svg>",
    });

    const res = await t.fetch("/s/pub-slug-123", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(res.headers.get("content-disposition")).toMatch(/diagram\.svg/);
  });
});
