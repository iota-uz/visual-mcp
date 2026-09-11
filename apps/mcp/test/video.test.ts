import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentGateway } from "../src/gateway.js";
import { createApp } from "../src/index.js";
import { callVideoTool, VideoDomainError, videoRegistry } from "../src/video/registry.js";

beforeEach(() => vi.stubEnv("SPA_ORIGIN", "https://canvas.example"));
afterEach(() => vi.unstubAllEnvs());
const project = {
  projectId: "project1",
  workspaceId: "workspace1",
  title: "Farq",
  revisionId: "projectrev",
  updatedAt: 0,
  reviewUrl: "/v/project1",
  brief: { topic: "Farq", direction: "Explain", mustInclude: [], mustAvoid: [] },
  format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
  drafts: [
    {
      draftId: "draft1",
      language: "ru",
      scriptRevision: "scriptrev",
      timelineRevision: "timelinerev",
      currentVersionId: null,
    },
  ],
};
const draft = {
  draftId: "draft1",
  projectId: "project1",
  language: "ru",
  scriptRevision: "scriptrev",
  timelineRevision: "timelinerev",
  script: {
    language: "ru",
    writingSystem: "cyrillic",
    title: "Farq",
    premise: "",
    sceneOrder: [],
    scenesById: {},
  },
  timeline: { fps: project.format.fps, durationFrames: 900, trackOrder: [], tracksById: {} },
};
function fixture(
  callOverride?: (operation: string, args: Record<string, unknown>) => Promise<unknown> | unknown,
) {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const gateway = {
    authenticate: async () => ({
      userId: "user1",
      tokenId: "token1",
      email: "agent@iota.uz",
      expiresAt: Date.now() + 60000,
    }),
    actionContext: () => ({
      runQuery: async () => null,
      runMutation: async () => null,
      storage: {},
    }),
    call: async (operation: string, args: Record<string, unknown>) => {
      calls.push({ operation, args });
      if (callOverride) return callOverride(operation, args);
      if (args.name === "getProject" || args.name === "createProject")
        return { ok: true, data: project };
      if (args.name === "listProjects")
        return {
          ok: true,
          data: {
            page: Array.from({ length: 21 }, () => project),
            isDone: true,
            continueCursor: "",
          },
        };
      if (args.name === "getDraft") return { ok: true, data: draft };
      if (args.name === "getOperation")
        return { ok: true, data: { state: "applied", result: project } };
      if (args.name === "checkpoint")
        return {
          ok: true,
          data: {
            version: { projectId: "project1", language: "ru", versionId: "version1" },
            manifestSha256: "manifesthash",
            reviewUrl: "/v/project1?version=version1",
          },
        };
      if (args.name === "getVersion")
        return {
          ok: true,
          data: {
            version: { projectId: "project1", language: "ru", versionId: "version1" },
            script: draft.script,
            timeline: draft.timeline,
            projectRevision: "projectrev",
            scriptRevision: "scriptrev",
            timelineRevision: "timelinerev",
            label: "Review",
            manifestSha256: "manifesthash",
          },
        };
      if (args.name === "patchScript")
        return {
          ok: false,
          error: {
            code: "REVISION_CONFLICT",
            message: "Read current document and recompute",
            effect: "not_applied",
          },
        };
      throw new Error("unexpected gateway operation");
    },
  };
  const app = createApp(gateway as unknown as AgentGateway);
  async function request(method: string, params: Record<string, unknown>, path = "/mcp") {
    const response = await app.request(path, {
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
            .find((l) => l.startsWith("data: "))!
            .slice(6)
        : text,
    );
  }
  return { request, calls, app };
}
describe("Video Studio actual SDK transport", () => {
  test("unifies catalogs without duplicate or unimplemented tools", async () => {
    const { request } = fixture();
    const video = await request("tools/list", {});
    const names = video.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(videoRegistry.map((t) => t.name)));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("asset_get");
    expect(names).toContain("canvas_save");
    expect(names).not.toContain("execute");
    expect(names.join(" ")).not.toMatch(/search_tools|describe_tools|approve/);
    for (const t of video.result.tools) {
      if (!videoRegistry.some((definition) => definition.name === t.name)) continue;
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema.anyOf).toHaveLength(2);
    }
  });
  test("project result IDs feed document read without argument reconstruction", async () => {
    const { request, calls } = fixture();
    const p = await request("tools/call", {
      name: "video_project_get",
      arguments: { project_id: "project1" },
    });
    expect(p.result.isError).toBe(false);
    expect(JSON.parse(p.result.content[0].text)).toEqual(p.result.structuredContent);
    const data = p.result.structuredContent.data;
    expect(data.review_url).toBe("https://canvas.example/v/project1");
    const d = await request("tools/call", {
      name: "video_script_get",
      arguments: { draft_id: data.drafts[0].draft_id },
    });
    expect(d.result.structuredContent).toMatchObject({
      ok: true,
      data: { revision_id: "scriptrev", complete: true, document: draft.script },
    });
    expect(calls[1]).toEqual({
      operation: "video",
      args: { tokenId: "token1", name: "getDraft", input: { draftId: "draft1" } },
    });
  });
  test("SDK invalid argument produces typed actionable error with no backend dispatch", async () => {
    const { request, calls } = fixture();
    const result = await request("tools/call", {
      name: "video_project_list",
      arguments: { workspace_id: "workspace1", limit: 101 },
    });
    expect(result.result.isError).toBe(true);
    expect(result.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        effect: "not_applied",
        recovery: { kind: "fix_input", fields: [{ path: "/limit" }] },
      },
    });
    expect(JSON.parse(result.result.content[0].text)).toEqual(result.result.structuredContent);
    expect(calls).toHaveLength(0);
  });
  test("create/checkpoint/version producer-consumer chain uses returned guards and refs", async () => {
    const { request, calls } = fixture();
    const created = await request("tools/call", {
      name: "video_project_create",
      arguments: {
        workspace_id: "workspace1",
        idempotency_key: "create1",
        title: "Farq",
        brief: project.brief,
        format: project.format,
        languages: ["ru"],
      },
    });
    expect(created.result.isError).toBe(false);
    const p = created.result.structuredContent.data;
    expect(p.operation_receipt).toMatchObject({
      receipt_id: expect.stringMatching(/^[a-f0-9]{64}$/),
      tool: "video_project_create",
      workspace_id: "workspace1",
      idempotency_key: "create1",
    });
    const d = p.drafts[0];
    const checkpoint = await request("tools/call", {
      name: "video_checkpoint",
      arguments: {
        draft_id: d.draft_id,
        idempotency_key: "checkpoint1",
        expected_project_revision: p.revision_id,
        expected_script_revision: d.script_revision,
        expected_timeline_revision: d.timeline_revision,
        label: "Review",
      },
    });
    expect(checkpoint.result.isError).toBe(false);
    const version = await request("tools/call", {
      name: "video_version_get",
      arguments: { version_id: checkpoint.result.structuredContent.data.version.version_id },
    });
    expect(version.result.structuredContent).toMatchObject({
      ok: true,
      data: { version: { version_id: "version1", language: "ru" }, script: draft.script },
    });
    expect(calls[1]?.args.input).toMatchObject({
      expectedProjectRevision: "projectrev",
      expectedScriptRevision: "scriptrev",
      expectedTimelineRevision: "timelinerev",
    });
  });
  test("lost create response, exact lookup and same-key replay resolve one original project", async () => {
    let writes = 0;
    let saved: typeof project | undefined;
    let loseFirstResponse = true;
    const { request } = fixture((_operation, args) => {
      if (args.name === "createProject") {
        if (!saved) {
          writes += 1;
          saved = project;
        }
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error("response lost after commit");
        }
        return { ok: true, data: saved };
      }
      if (args.name === "getOperation")
        return { ok: true, data: { state: "applied", result: saved } };
      throw new Error("unexpected gateway operation");
    });
    const arguments_ = {
      workspace_id: "workspace1",
      idempotency_key: "lost-create",
      title: "Farq",
      brief: project.brief,
      format: project.format,
      languages: ["ru"],
    };
    const lost = await request("tools/call", {
      name: "video_project_create",
      arguments: arguments_,
    });
    expect(lost.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        effect: "unknown",
        receipt: {
          receipt_id: expect.stringMatching(/^[a-f0-9]{64}$/),
          idempotency_key: "lost-create",
        },
        recovery: {
          kind: "inspect_operation",
          read: { tool: "video_operation_get" },
        },
      },
    });
    expect(lost.result.isError).toBe(true);
    expect(JSON.parse(lost.result.content[0].text)).toEqual(lost.result.structuredContent);
    const receipt = lost.result.structuredContent.error.receipt;
    const lookup = await request("tools/call", {
      name: "video_operation_get",
      arguments: {
        workspace_id: "workspace1",
        tool: "video_project_create",
        idempotency_key: "lost-create",
        receipt_id: receipt.receipt_id,
      },
    });
    expect(lookup.result.structuredContent).toMatchObject({
      ok: true,
      data: { state: "applied", effect: "applied", receipt, result: { project_id: "project1" } },
    });
    const replay = await request("tools/call", {
      name: "video_project_create",
      arguments: arguments_,
    });
    expect(replay.result.structuredContent).toMatchObject({
      ok: true,
      data: { project_id: "project1", operation_receipt: receipt },
    });
    expect(writes).toBe(1);
  });
  test("direct composition and SDK calls share the same validated result", async () => {
    const { request } = fixture();
    const direct = await callVideoTool(
      "video_project_get",
      { project_id: "project1" },
      async () => project,
    );
    const external = await request("tools/call", {
      name: "video_project_get",
      arguments: { project_id: "project1" },
    });
    expect(external.result.structuredContent).toEqual(direct.structuredContent);
    expect(external.result.content).toEqual(direct.content);
  });
  test("unknown fields cannot impersonate a principal", async () => {
    const { request, calls } = fixture();
    const result = await request("tools/call", {
      name: "video_project_get",
      arguments: { project_id: "project1", tokenId: "other" },
    });
    expect(result.result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
  test("CAS errors preserve domain code and safe read guidance", async () => {
    const { request } = fixture();
    const result = await request("tools/call", {
      name: "video_script_patch",
      arguments: {
        draft_id: "draft1",
        idempotency_key: "edit1",
        expected_revision: "stale",
        operations: [{ op: "replace", path: "/title", value: "New" }],
      },
    });
    expect(result.result.isError).toBe(true);
    expect(result.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: "REVISION_CONFLICT",
        effect: "not_applied",
        recovery: {
          kind: "refresh_then_recompute",
          read: { tool: "video_script_get", arguments: { draft_id: "draft1" } },
        },
      },
    });
  });
  test("atomic snapshot serves bounded first page", async () => {
    const { request } = fixture();
    const result = await request("tools/call", {
      name: "video_project_list",
      arguments: { workspace_id: "workspace1" },
    });
    expect(result.result.structuredContent).toMatchObject({
      ok: true,
      data: { complete: false, next_cursor: expect.any(String) },
    });
  });
  test("cursor binds filters and reads frozen rows without a second backend query", async () => {
    const { request, calls } = fixture();
    const first = await request("tools/call", {
      name: "video_project_list",
      arguments: { workspace_id: "workspace1", query: "Farq" },
    });
    const cursor = first.result.structuredContent.data.next_cursor;
    await request("tools/call", {
      name: "video_project_list",
      arguments: { workspace_id: "workspace1", query: "Farq", cursor },
    });
    expect(calls[0]?.args.input).toMatchObject({
      paginationOpts: { cursor: null, numItems: 100, maximumBytesRead: 4194304 },
    });
    const conflict = await request("tools/call", {
      name: "video_project_list",
      arguments: { workspace_id: "workspace1", query: "Changed", cursor },
    });
    expect(conflict.result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "CURSOR_MISMATCH", effect: "not_applied" },
    });
    expect(calls).toHaveLength(1);
    const expired = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    expired.expires = 0;
    const result = await request("tools/call", {
      name: "video_project_list",
      arguments: {
        workspace_id: "workspace1",
        query: "Farq",
        cursor: Buffer.from(JSON.stringify(expired)).toString("base64url"),
      },
    });
    expect(result.result.structuredContent.error.code).toBe("CURSOR_EXPIRED");
  });
  test("unknown tools are protocol errors, unlike invalid arguments", async () => {
    const { request } = fixture();
    const result = await request("tools/call", { name: "video_approve", arguments: {} });
    expect(result.error).toBeDefined();
    expect(result.result).toBeUndefined();
  });
  test("a missing bearer is rejected before gateway work", async () => {
    const { app, calls } = fixture();
    const result = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  test("shared direct/broker boundary validates and preserves unknown write effects", async () => {
    const call = vi.fn(async () => {
      throw new Error("network lost after write");
    });
    const result = await callVideoTool(
      "video_checkpoint",
      {
        draft_id: "draft1",
        idempotency_key: "cp1",
        expected_project_revision: "p",
        expected_script_revision: "s",
        expected_timeline_revision: "t",
        label: "Review",
      },
      call,
    );
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { effect: "unknown", recovery: { kind: "request_human" } },
    });
    expect(call).toHaveBeenCalledTimes(1);
    const read = await callVideoTool(
      "video_project_list",
      { workspace_id: "workspace1" },
      Object.assign(
        async () => {
          throw new Error("backend offline");
        },
        { snapshotPrincipal: "user1:token1" },
      ),
    );
    expect(read.structuredContent).toMatchObject({
      ok: false,
      error: { code: "BACKEND_UNAVAILABLE", effect: "none" },
    });
    const error = await callVideoTool("video_project_get", { project_id: "project1" }, async () => {
      throw new VideoDomainError("NOT_FOUND_OR_FORBIDDEN", "Unavailable");
    });
    expect(error.isError).toBe(true);
  });
});
