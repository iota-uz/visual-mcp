import { expect, test, vi } from "vitest";
import type { AgentGateway } from "../src/gateway.js";
import { createApp } from "../src/index.js";
import { videoBackend } from "../src/video/gateway.js";
import { callVideoTool } from "../src/video/registry.js";

const hash = "a".repeat(64);
function fixture() {
  const call = vi.fn(async (_operation: string, args: Record<string, unknown>) => {
    if (args.name === "submitJob") {
      const input = args.input as { request: { kind: string }; idempotencyKey: string };
      return {
        ok: true,
        data: {
          jobId: "job",
          state: "queued",
          replayed: false,
          pollAfterMs: 1000,
          operation: { toolName: input.request.kind, idempotencyKey: input.idempotencyKey },
        },
      };
    }
    throw new Error("Unexpected call");
  });
  const app = createApp({
    authenticate: async () => ({
      userId: "user",
      tokenId: "token",
      email: "agent@iota.uz",
      expiresAt: Date.now() + 60000,
    }),
    call,
    actionContext: () => ({ storage: {} }),
  } as unknown as AgentGateway);
  async function rpc(endpoint: string, method: string, params: unknown) {
    const response = await app.request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer valid",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await response.text();
    return JSON.parse(
      body.startsWith("event:")
        ? body
            .split(/\r?\n/)
            .find((line) => line.startsWith("data: "))!
            .slice(6)
        : body,
    );
  }
  return { call, rpc };
}
const image = {
  workspace_id: "workspace",
  idempotency_key: "image-key",
  request: {
    allowPaid: true,
    prompt: "A clean product frame",
    model: "gpt-image-2.5-sunburst",
    size: "1152x2048",
    quality: "high",
  },
};
test("unified SDK catalog exposes image generation and video production once", async () => {
  const f = fixture();
  const canvas = await f.rpc("/mcp", "tools/list", {});
  const names = (result: { result: { tools: { name: string }[] } }) =>
    result.result.tools.map((tool) => tool.name);
  expect(names(canvas)).toContain("image_generate");
  expect(names(canvas)).toContain("video_render");
  expect(new Set(names(canvas)).size).toBe(names(canvas).length);
  for (const endpoint of ["/mcp"]) {
    const result = await f.rpc(endpoint, "tools/call", {
      name: "image_generate",
      arguments: image,
    });
    expect(result.result.structuredContent).toMatchObject({
      ok: true,
      data: { job_id: "job", operation: { tool: "image" } },
    });
  }
  expect(f.call.mock.calls[0]?.[1].input).toMatchObject({
    workspaceId: "workspace",
    request: { kind: "image", count: 1, outputFormat: "png" },
  });
  expect(f.call.mock.calls[0]?.[1].input).not.toHaveProperty("projectId");
});
test("paid opt-in and generate/edit routing errors have structured steering and no dispatch", async () => {
  const f = fixture();
  for (const args of [
    { ...image, request: { ...image.request, allowPaid: false } },
    { ...image, request: { ...image.request, source: { assetId: "a", revisionId: "r" } } },
  ]) {
    const result = await f.rpc("/mcp", "tools/call", {
      name: "image_generate",
      arguments: args,
    });
    expect(result.result.isError).toBe(true);
    expect(result.result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", effect: "not_applied" },
    });
  }
  expect(f.call).not.toHaveBeenCalled();
});
test("rubric resolver preserves exact canonical policy for render admission", async () => {
  const call = vi.fn(async () => ({
    policy: {
      rubric: "Legibility",
      criteria: [{ id: "title", description: "Title is readable" }],
      requireAudioReview: false,
    },
    policyVersion: "video-critique-policy-v1",
    rubricHash: hash,
  }));
  const result = await callVideoTool(
    "video_rubric_resolve",
    { rubric: "Legibility", criteria: [{ id: "title", description: "Title is readable" }] },
    call,
  );
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: { rubric_hash: hash, policy: { criteria: [{ id: "title" }] } },
  });
});
test("upload maximum is decimal 2GB and larger bytes cannot reserve", async () => {
  const input = {
    workspace_id: "workspace",
    idempotency_key: "upload-key",
    filename: "clip.mp4",
    mime_type: "video/mp4",
    size_bytes: 2_000_000_000,
    sha256: hash,
    source: "upload",
  };
  const call = vi.fn(async () => ({
    uploadId: "upload",
    state: "reserved",
    expiresAt: 123,
    upload: {
      method: "PUT",
      url: "https://example.com/signed",
      headers: { "content-length": "2000000000" },
      maxBytes: 2_000_000_000,
    },
  }));
  expect((await callVideoTool("asset_upload_reserve", input, call)).isError).not.toBe(true);
  call.mockClear();
  expect(
    (await callVideoTool("asset_upload_reserve", { ...input, size_bytes: 2_000_000_001 }, call))
      .isError,
  ).toBe(true);
  expect(call).not.toHaveBeenCalled();
});
test("media operations retain pinned additional inputs and actual measurement kind", async () => {
  const f = fixture();
  const result = await f.rpc("/mcp", "tools/call", {
    name: "video_frames",
    arguments: {
      workspace_id: "workspace",
      idempotency_key: "frames-key",
      asset: { assetId: "asset", revisionId: "revision" },
      operation: { kind: "frames", timesMs: [0, 1000], maxWidth: 720, columns: 2 },
    },
  });
  expect(result.result.structuredContent).toMatchObject({
    ok: true,
    data: { operation: { tool: "media" } },
  });
  expect(f.call.mock.calls[0]?.[1].input).toMatchObject({
    request: { kind: "media", operation: { kind: "frames", timesMs: [0, 1000] } },
  });
});
test("gateway preserves nested backend JSON pointers and partial effects", async () => {
  const backend = videoBackend(
    {
      call: async () => ({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid nested shot",
          effect: "not_applied",
          recovery: {
            kind: "fix_input",
            fields: [
              {
                path: "/patch/operations/0/value/scenesById/s1/shotsById/shot1/durationMs",
                reason: "Must fit scene duration",
              },
            ],
          },
        },
      }),
    } as unknown as AgentGateway,
    { userId: "user", tokenId: "token", email: "user@iota.uz" } as never,
  );
  const result = await callVideoTool("image_generate", image, backend);
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: false,
    error: {
      recovery: {
        kind: "fix_input",
        fields: [{ path: "/patch/operations/0/value/scenesById/s1/shotsById/shot1/durationMs" }],
      },
    },
  });
  const partial = videoBackend(
    {
      call: async () => ({
        ok: false,
        error: {
          code: "RESULT_PERSISTENCE_FAILED",
          message: "Provider completed",
          effect: "partial",
        },
      }),
    } as unknown as AgentGateway,
    { userId: "user", tokenId: "token", email: "user@iota.uz" } as never,
  );
  expect((await callVideoTool("image_generate", image, partial)).structuredContent).toMatchObject({
    ok: false,
    error: { code: "RESULT_PERSISTENCE_FAILED", effect: "partial" },
  });
});
