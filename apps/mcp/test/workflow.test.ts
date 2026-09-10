import { expect, test, vi } from "vitest";
import type { AgentGateway } from "../src/gateway.js";
import { createApp } from "../src/index.js";
import { callVideoTool, VideoDomainError } from "../src/video/registry.js";

const profile = {
  projectId: "project",
  profileId: "profile",
  revisionId: "rev",
  document: {
    name: "Farq",
    brand: "farq.uz",
    language: null,
    versionId: null,
    sceneIds: [],
    entries: [],
  },
};
function fixture() {
  const call = vi.fn(async (_operation: string, args: Record<string, unknown>) => {
    if (args.name === "getProfile") return { ok: true, data: profile };
    if (args.name === "patchProfile")
      return {
        ok: false,
        error: {
          code: "REVISION_CONFLICT",
          message: "Read and recompute profile",
          effect: "not_applied",
        },
      };
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
  async function request(
    method: string,
    params: Record<string, unknown> = {},
    path = "/mcp/video",
  ) {
    const response = await app.request(path, {
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
            .find((l) => l.startsWith("data: "))!
            .slice(6)
        : body,
    );
  }
  return { request, call };
}
test("actual SDK catalog exposes workflow only on video; no approval/evidence forging tools", async () => {
  const f = fixture(),
    list = await f.request("tools/list"),
    names = list.result.tools.map((t: { name: string }) => t.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "video_context_get",
      "video_profile_get",
      "video_profile_patch",
      "video_loop_get",
      "video_loop_propose",
      "video_loop_select",
      "video_loop_pause",
      "video_loop_resume",
    ]),
  );
  expect(names).not.toContain("video_loop_accept");
  expect(names).not.toContain("recordEvidence");
  const canvas = await f.request("tools/list", {}, "/mcp");
  expect(canvas.result.tools.map((t: { name: string }) => t.name)).not.toContain(
    "video_loop_select",
  );
  for (const tool of list.result.tools.filter((t: { name: string }) =>
    t.name.startsWith("video_loop"),
  ))
    expect(tool.outputSchema).toBeDefined();
});
test("actual SDK profile data maps refs but preserves canonical document and typed CAS recovery", async () => {
  const f = fixture(),
    read = await f.request("tools/call", {
      name: "video_profile_get",
      arguments: { project_id: "project" },
    });
  expect(read.result.structuredContent).toEqual({
    ok: true,
    data: {
      project_id: "project",
      profile_id: "profile",
      revision_id: "rev",
      document: profile.document,
    },
  });
  const result = await f.request("tools/call", {
    name: "video_profile_patch",
    arguments: {
      profile_id: "profile",
      expected_revision: "stale",
      idempotency_key: "key",
      reason: "change",
      operations: [{ op: "replace", path: "/name", value: "next" }],
    },
  });
  expect(result.result.isError).toBe(true);
  expect(result.result.structuredContent.error.recovery).toEqual({
    kind: "refresh_then_recompute",
    read: { tool: "video_profile_get", arguments: { profile_id: "profile" } },
  });
  expect(JSON.parse(result.result.content[0].text)).toEqual(result.result.structuredContent);
});
test("public validation never dispatches forged authority; direct broker contract matches", async () => {
  const f = fixture();
  const invalid = await f.request("tools/call", {
    name: "video_loop_resume",
    arguments: {
      loop_id: "loop",
      expected_loop_revision: "rev",
      idempotency_key: "key",
      human_approved: true,
    },
  });
  expect(invalid.result.isError).toBe(true);
  expect(invalid.result.structuredContent.error.code).toBe("VALIDATION_ERROR");
  expect(f.call).not.toHaveBeenCalled();
  const direct = await callVideoTool(
    "video_profile_get",
    { profile_id: "profile" },
    async () => profile,
  );
  expect(direct.structuredContent).toMatchObject({ ok: true, data: { profile_id: "profile" } });
  const conflict = await callVideoTool(
    "video_loop_resume",
    { loop_id: "loop", expected_loop_revision: "rev", idempotency_key: "key" },
    async () => {
      throw new VideoDomainError("REVISION_CONFLICT", "Read current loop");
    },
  );
  expect(conflict.structuredContent).toMatchObject({
    ok: false,
    error: {
      recovery: {
        kind: "refresh_then_recompute",
        read: { tool: "video_loop_get", arguments: { loop_id: "loop" } },
      },
    },
  });
});
