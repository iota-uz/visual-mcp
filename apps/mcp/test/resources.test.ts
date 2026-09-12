import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { callVideoTool } from "../src/video/registry.js";

test("full critique report chunks pin original bytes, preserve all findings and reject hash changes", async () => {
  const content = JSON.stringify({
    report: {
      findings: Array.from({ length: 30 }, (_, i) => ({ id: i, observation: "Полное наблюдение" })),
    },
  });
  const hash = createHash("sha256").update(content).digest("hex");
  const uri = `video://reports/job/${hash}`;
  const call = async (name: string) =>
    name === "getJob"
      ? {
          workspaceId: "workspace",
          result: {
            kind: "critique",
            report: { assetId: "asset", revisionId: "revision" },
            reportSha256: hash,
          },
        }
      : {
          url: "https://private.example/signed",
          sha256: hash,
          sizeBytes: Buffer.byteLength(content),
        };
  const fetcher = vi.fn(async () => new Response(content));
  vi.stubGlobal("fetch", fetcher);
  try {
    let cursor: string | undefined,
      combined = "";
    do {
      const result = await callVideoTool(
        "resource_get",
        { uri, sha256: hash, max_bytes: 2048, ...(cursor ? { cursor } : {}) },
        call,
      );
      expect(result.isError).not.toBe(true);
      const data = (
        result.structuredContent as { data: { content: string; next_cursor: string | null } }
      ).data;
      combined += data.content;
      cursor = data.next_cursor ?? undefined;
    } while (cursor);
    expect(combined).toBe(content);
    expect(JSON.parse(combined).report.findings).toHaveLength(30);
    fetcher.mockImplementation(async () => new Response(content.replace("Полное", "Другое")));
    expect(
      (await callVideoTool("resource_get", { uri: uri.replace("/job/", "/other-job/") }, call))
        .structuredContent,
    ).toMatchObject({
      ok: false,
      error: { code: "RESOURCE_CHANGED" },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

import type { AgentGateway } from "../src/gateway.js";
import { createApp } from "../src/index.js";

function fixture() {
  const app = createApp({
    authenticate: async () => ({
      userId: "user",
      tokenId: "token",
      email: "agent@iota.uz",
      expiresAt: Date.now() + 60000,
    }),
    call: async () => ({
      ok: true,
      data: { image: { configured: false, model: "gpt-image-2.5-sunburst" } },
    }),
    actionContext: () => ({ storage: {} }),
  } as unknown as AgentGateway);
  return async (method: string, params: unknown) => {
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer valid",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await response.text();
    return JSON.parse(
      text.startsWith("event:")
        ? text
            .split(/\r?\n/)
            .find((line) => line.startsWith("data: "))!
            .slice(6)
        : text,
    );
  };
}

test("report reader accepts over4MiB UTF-8 reports and reuses verified bytes for subsequent chunks", async () => {
  const text = JSON.stringify({ report: { observation: "界".repeat(1500000) } });
  const hash = createHash("sha256").update(text).digest("hex");
  const uri = `video://reports/large/${hash}`;
  const call = async (name: string) =>
    name === "getJob"
      ? {
          workspaceId: "workspace",
          result: {
            kind: "critique",
            report: { assetId: "asset", revisionId: "revision" },
            reportSha256: hash,
          },
        }
      : { url: "https://private.example/large", sha256: hash, sizeBytes: Buffer.byteLength(text) };
  const fetcher = vi.fn(async () => new Response(text));
  vi.stubGlobal("fetch", fetcher);
  try {
    const first = await callVideoTool("resource_get", { uri, max_bytes: 131072 }, call);
    expect(first.isError).not.toBe(true);
    const cursor = (first.structuredContent as { data: { next_cursor: string } }).data.next_cursor;
    const second = await callVideoTool("resource_get", { uri, max_bytes: 131072, cursor }, call);
    expect(second.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(second.structuredContent))).toBeLessThan(131072);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
test("native resource and tool reader share exact model bytes and availability caveat", async () => {
  const rpc = fixture();
  const found = await rpc("tools/call", {
    name: "resource_find",
    arguments: { kind: "model", query: "image" },
  });
  expect(found.result.structuredContent.data.items).toHaveLength(1);
  const uri = found.result.structuredContent.data.items[0].uri;
  const native = await rpc("resources/read", { uri });
  const read = await rpc("tools/call", { name: "resource_get", arguments: { uri } });
  expect(read.result.structuredContent.data.content).toBe(native.result.contents[0].text);
  expect(JSON.parse(read.result.structuredContent.data.content)).toMatchObject({
    availability: "account_not_verified",
    configuration: { configured: false },
    settingsSchema: { type: "object" },
  });
});
test("registered Canvas templates remain available without a duplicated catalog", async () => {
  const rpc = fixture();
  const found = await rpc("tools/call", {
    name: "resource_find",
    arguments: { kind: "template", limit: 1 },
  });
  expect(found.result.structuredContent.data.items[0].uri).toMatch(/^canvas:\/\/templates/);
  const read = await rpc("tools/call", {
    name: "resource_get",
    arguments: { uri: found.result.structuredContent.data.items[0].uri, max_bytes: 2048 },
  });
  expect(Buffer.byteLength(read.result.structuredContent.data.content)).toBeLessThanOrEqual(1024);
  expect(read.result.structuredContent.data.sha256).toMatch(/^[a-f0-9]{64}$/);
});

test("animated story playground is discoverable through the deployed MCP catalog", async () => {
  const rpc = fixture();
  const found = await rpc("tools/call", {
    name: "resource_find",
    arguments: { kind: "template", query: "animated story playground" },
  });
  const item = found.result.structuredContent.data.items.find(
    (candidate: { uri: string }) => candidate.uri === "canvas://templates/animated-story-playground",
  );
  expect(item).toBeDefined();

  const read = await rpc("tools/call", {
    name: "resource_get",
    arguments: { uri: item.uri },
  });
  expect(read.result.structuredContent.data.content).toContain('<svg viewBox="0 0 720 1280"');
});
test("resource hash mismatch and arbitrary URL never silently fetch a replacement", async () => {
  const rpc = fixture();
  const mismatch = await rpc("tools/call", {
    name: "resource_get",
    arguments: { uri: "video://models/image", sha256: "0".repeat(64) },
  });
  expect(mismatch.result.structuredContent).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_CHANGED" },
  });
  const external = await rpc("tools/call", {
    name: "resource_get",
    arguments: { uri: "https://example.com/tool-search" },
  });
  expect(external.result.structuredContent).toMatchObject({
    ok: false,
    error: { code: "RESOURCE_NOT_FOUND" },
  });
});
test("verified component and effect resources expose actual pinned schema source", async () => {
  const rpc = fixture();
  for (const kind of ["component", "preset"]) {
    const found = await rpc("tools/call", { name: "resource_find", arguments: { kind } });
    expect(found.result.structuredContent.data.items.length).toBeGreaterThan(0);
    const read = await rpc("tools/call", {
      name: "resource_get",
      arguments: { uri: found.result.structuredContent.data.items[0].uri, max_bytes: 131072 },
    });
    const content = JSON.parse(read.result.structuredContent.data.content);
    expect(content).toMatchObject({
      kind,
      revisionId: "1",
      trust: "reviewed_repository_code",
      schema: { type: "object" },
    });
  }
});
