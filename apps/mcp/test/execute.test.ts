import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ExecuteRequest, handleExecute } from "../../worker/src/execute.js";
import type { AgentGateway } from "../src/gateway.js";
import { createApp } from "../src/index.js";

beforeEach(() => {
  vi.stubEnv("SPA_ORIGIN", "https://canvas.example");
  vi.stubEnv("WORKER_URL", "http://worker.local");
  vi.stubEnv("WORKER_TOKEN", "fixture-worker-token");
  vi.stubEnv("MCP_EXECUTE_BROKER_ORIGIN", "http://mcp.local");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
type Job = {
  jobId: string;
  state: string;
  kind: string;
  operation: { toolName: string; idempotencyKey: string };
  replayed: boolean;
  pollAfterMs: number;
  workspaceId: unknown;
  stage: string;
  createdAt: number;
  updatedAt: number;
  result: unknown;
  error: unknown;
  fence: number;
};
function fixture(mixedAssets = false) {
  const jobs = new Map<string, Job>();
  const keys = new Map<unknown, string>();
  const effects = new Map<string, Record<string, unknown>[]>();
  const workerUrls: string[] = [];
  let workerCalls = 0,
    writes = 0;
  const gateway = {
    authenticate: async () => ({
      userId: "u1",
      tokenId: "t1",
      email: "agent@iota.uz",
      expiresAt: Date.now() + 60000,
    }),
    actionContext: () => ({
      storage: {},
      runMutation: async (_fn: unknown, input: Record<string, unknown>) =>
        Array.isArray(input.assetRefs)
          ? {
              status: "moved",
              movedCount: input.assetRefs.length,
              replayed: false,
              items: input.assetRefs.map((assetRef) => ({
                previousAssetRef: assetRef,
                assetRef: String(assetRef).replace("/farq/", "/aktuar/"),
              })),
              conflicts: [],
            }
          : {
              assetRef: input.assetRef,
              revision: 1,
              tags: input.tags,
            },
      runQuery: async (_fn: unknown, input: Record<string, unknown>) =>
        input.slug
          ? {
              workspaceId: input.slug === "farq" ? "w1" : "outside",
              slug: input.slug,
              name: "Farq",
            }
          : input.ref
            ? {
                assetRef: input.ref,
                assetVersionId: "revision-audio",
                revision: 1,
                mimeType: "audio/mpeg",
                size: 10,
                contentHash: "a".repeat(64),
                objectKey: "fixtures/audio",
              }
            : {
                page: mixedAssets
                  ? ["image", "audio"]
                      .filter((kind) => !input.kind || input.kind === kind)
                      .map((kind) => ({
                        asset_id: `asset-${kind}`,
                        asset_ref:
                          input.scope === "shared"
                            ? `asset://shared/${kind}@1`
                            : `asset://workspace/farq/${kind}@1`,
                        scope: input.scope === "shared" ? "shared" : "workspace",
                        workspace_slug: input.scope === "shared" ? null : "farq",
                        slug: kind,
                        name: kind,
                        description: null,
                        tags: [],
                        kind,
                        revision: 1,
                        revision_id: `revision-${kind}`,
                        mime_type: kind === "audio" ? "audio/mpeg" : "image/png",
                        size_bytes: 10,
                        content_hash: "a".repeat(64),
                        original_filename: kind,
                        updated_at: 1,
                        object_key: `fixtures/${kind}`,
                      }))
                  : [],
                isDone: true,
                continueCursor: "",
              },
    }),
    call: async (_op: string, req: { name: string; input: Record<string, unknown> }) => {
      const { name, input } = req;
      if (name === "submitJob") {
        const existing = keys.get(input.idempotencyKey);
        if (existing) return { ok: true, data: { ...jobs.get(existing), replayed: true } };
        const jobId = `job${jobs.size + 1}`;
        const j: Job = {
          jobId,
          state: "queued",
          kind: "execute",
          operation: { toolName: "execute", idempotencyKey: String(input.idempotencyKey) },
          replayed: false,
          pollAfterMs: 1000,
          workspaceId: input.workspaceId,
          stage: "queued",
          createdAt: 0,
          updatedAt: 0,
          result: null,
          error: null,
          fence: 0,
        };
        jobs.set(jobId, j);
        keys.set(input.idempotencyKey, jobId);
        effects.set(jobId, []);
        return { ok: true, data: j };
      }
      const j = jobs.get(String(input.jobId));
      if (name === "claimJob") {
        if (j?.state !== "queued") return { ok: true, data: null };
        j.state = "running";
        j.fence++;
        return { ok: true, data: j };
      }
      if (name === "getJob") return { ok: true, data: j };
      if (name === "lookupJob")
        return { ok: true, data: jobs.get(keys.get(input.idempotencyKey)!) };
      if (name === "getJobEffects")
        return {
          ok: true,
          data: { page: effects.get(String(input.jobId)), isDone: true, continueCursor: "" },
        };
      if (name === "getJobEffect")
        return {
          ok: true,
          data:
            effects.get(String(input.jobId))?.find((effect) => effect.callId === input.callId) ??
            null,
        };
      if (name === "recordEffect") {
        const rows = effects.get(String(input.jobId))!;
        const row = rows.find((e) => e.callId === input.callId);
        if (input.state === "dispatching" && row)
          return { ok: true, data: { created: false, existing: row } };
        if (row) Object.assign(row, input);
        else rows.push({ ...input });
        return { ok: true, data: { created: true } };
      }
      if (name === "completeJob") {
        j!.result = input.result;
        j!.state = (input.result as { success: boolean }).success ? "succeeded" : "failed";
        return { ok: true, data: j };
      }
      if (name === "failJob") {
        j!.state = "outcome_unknown";
        return { ok: true, data: null };
      }
      if (name === "getDraft")
        return {
          ok: true,
          data: {
            projectId: "project1",
            draftId: "draft1",
            language: "ru",
            scriptRevision: "rev1",
            script: {
              language: "ru",
              writingSystem: "cyrillic",
              title: "Old",
              premise: "",
              sceneOrder: [],
              scenesById: {},
            },
          },
        };
      if (name === "getProject")
        return {
          ok: true,
          data: {
            projectId: "project1",
            workspaceId: input.projectId === "outside" ? "other" : "w1",
            title: "Farq",
            revisionId: "p1",
            updatedAt: 0,
            reviewUrl: "/v/project1",
            brief: { topic: "Farq", direction: "Explain", mustInclude: [], mustAvoid: [] },
            format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
            drafts: [],
          },
        };
      if (name === "patchScript") {
        writes++;
        if (input.idempotencyKey === "unknown")
          return {
            ok: false,
            error: {
              code: "BACKEND_UNAVAILABLE",
              message: "Write outcome unknown",
              effect: "unknown",
            },
          };
        return {
          ok: true,
          data: {
            revisionId: "rev2",
            changed: true,
            affectedSceneIds: [],
            staleDependents: [
              { kind: "checkpoint", versionId: "version1", reason: "script_changed" },
            ],
          },
        };
      }
      throw new Error(`Unexpected fixture method ${name}`);
    },
  };
  const app = createApp(gateway as unknown as AgentGateway);
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    if (url.hostname === "worker.local") {
      workerCalls++;
      workerUrls.push(url.toString());
      const input = ExecuteRequest.parse(JSON.parse(String(init.body)));
      return Response.json(await handleExecute(input, init.signal ?? undefined));
    }
    if (url.hostname === "mcp.local") return app.request(url.toString(), init);
    throw new Error("Unexpected outbound request");
  });
  async function tool(name: string, args: Record<string, unknown>, endpoint = "/mcp") {
    const response = await app.request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer fixture",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const text = await response.text();
    return JSON.parse(
      text.startsWith("event:")
        ? text
            .split(/\r?\n/)
            .find((l) => l.startsWith("data: "))!
            .slice(6)
        : text,
    ).result;
  }
  async function wait(jobId: string) {
    for (let i = 0; i < 200; i++) {
      if (["failed", "succeeded", "outcome_unknown"].includes(jobs.get(jobId)!.state)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Execution did not settle");
  }
  return { app, tool, wait, jobs, effects, workerUrls, counts: () => ({ workerCalls, writes }) };
}
test.each([
  ["worker.local", "http://worker.local:8080/execute"],
  ["http://worker.local:8090/", "http://worker.local:8090/execute"],
])(
  "execute normalizes worker address %s through shared configuration",
  async (configured, expected) => {
    vi.stubEnv("WORKER_URL", configured);
    const f = fixture();
    const accepted = await f.tool("execute", {
      workspace_id: "w1",
      idempotency_key: "worker-address-probe",
      code: "emit({ok:true});",
    });
    const jobId = accepted.structuredContent.data.job_id;
    await f.wait(jobId);
    expect(f.workerUrls).toEqual([expected]);
    expect(f.jobs.get(jobId)?.state).toBe("succeeded");
    expect(f.jobs.get(jobId)?.result).toMatchObject({ success: true, emitted: [{ ok: true }] });
  },
);
test("installed SDK client validates populated asset list/get against published output JSON Schema", async () => {
  vi.stubEnv("S3_ASSET_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("S3_ASSET_BUCKET", "fixture");
  vi.stubEnv("S3_ASSET_ACCESS_KEY_ID", "fixture-access");
  vi.stubEnv("S3_ASSET_SECRET_ACCESS_KEY", "fixture-secret");
  const f = fixture(true);
  const client = new Client({ name: "asset-schema-regression", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.local/mcp"), {
    requestInit: { headers: { authorization: "Bearer fixture" } },
    fetch: async (input, init) => f.app.fetch(new Request(input, init)),
  });
  try {
    await client.connect(transport);
    await client.listTools();
    const listed = await client.callTool({
      name: "asset_list",
      arguments: { scope: "workspace", workspace: "farq" },
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      assets: [
        { kind: "image", revision_id: "revision-image" },
        { kind: "audio", revision_id: "revision-audio" },
      ],
    });
    const audio = await client.callTool({
      name: "asset_list",
      arguments: { scope: "workspace", workspace: "farq", kind: "audio" },
    });
    expect(audio.structuredContent).toMatchObject({ count: 1, assets: [{ kind: "audio" }] });
    const shared = await client.callTool({
      name: "asset_list",
      arguments: { scope: "shared" },
    });
    expect(shared.isError).not.toBe(true);
    expect(shared.structuredContent.assets[0]).toMatchObject({
      scope: "shared",
      workspace_slug: null,
      asset_ref: "asset://shared/image@1",
    });
    const personal = await client.callTool({
      name: "asset_list",
      arguments: { scope: "personal" },
    });
    expect(personal.isError).toBe(true);
    const got = await client.callTool({
      name: "asset_get",
      arguments: { asset_ref: "asset://workspace/farq/audio@1" },
    });
    expect(got.structuredContent).toMatchObject({
      revision_id: "revision-audio",
      mime_type: "audio/mpeg",
    });
    const tagged = await client.callTool({
      name: "asset_set_tags",
      arguments: {
        asset_ref: "asset://workspace/farq/audio@1",
        tags: ["voice", "approved"],
      },
    });
    expect(tagged.structuredContent).toEqual({
      status: "ok",
      asset_ref: "asset://workspace/farq/audio@1",
      revision: 1,
      tags: ["voice", "approved"],
    });
    const moved = await client.callTool({
      name: "asset_move",
      arguments: {
        source_workspace: "farq",
        destination_workspace: "aktuar",
        asset_refs: ["asset://workspace/farq/image@1", "asset://workspace/farq/audio@1"],
        idempotency_key: "move-media",
      },
    });
    expect(moved.structuredContent).toEqual({
      status: "moved",
      moved_count: 2,
      replayed: false,
      items: [
        {
          previous_asset_ref: "asset://workspace/farq/image@1",
          asset_ref: "asset://workspace/aktuar/image@1",
        },
        {
          previous_asset_ref: "asset://workspace/farq/audio@1",
          asset_ref: "asset://workspace/aktuar/audio@1",
        },
      ],
      conflicts: [],
    });
  } finally {
    await client.close();
  }
});
test("populated mixed audio library works directly and through execute, including audio filter", async () => {
  vi.stubEnv("S3_ASSET_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("S3_ASSET_BUCKET", "fixture");
  vi.stubEnv("S3_ASSET_ACCESS_KEY_ID", "fixture-access");
  vi.stubEnv("S3_ASSET_SECRET_ACCESS_KEY", "fixture-secret");
  const f = fixture(true);
  const direct = await f.tool("asset_list", { scope: "workspace", workspace: "farq" }, "/mcp");
  expect(direct.isError).not.toBe(true);
  expect(direct.structuredContent.assets.map((asset: { kind: string }) => asset.kind)).toEqual([
    "image",
    "audio",
  ]);
  const audio = await f.tool(
    "asset_list",
    { scope: "workspace", workspace: "farq", kind: "audio" },
    "/mcp",
  );
  expect(audio.isError).not.toBe(true);
  expect(audio.structuredContent.assets).toHaveLength(1);
  const accepted = await f.tool(
    "execute",
    {
      workspace_id: "w1",
      idempotency_key: "mixed-audio-library",
      code: "emit(await tools.asset_list({scope:'workspace',workspace:'farq'})); emit(await tools.asset_list({scope:'workspace',workspace:'farq',kind:'audio'}));",
    },
    "/mcp",
  );
  const jobId = accepted.structuredContent.data.job_id;
  await f.wait(jobId);
  expect(f.jobs.get(jobId)?.state).toBe("succeeded");
  expect(f.jobs.get(jobId)?.result).toMatchObject({
    success: true,
    emitted: [{ assets: [{ kind: "image" }, { kind: "audio" }] }, { assets: [{ kind: "audio" }] }],
  });
  expect(f.effects.get(jobId)).toMatchObject([{ state: "succeeded" }, { state: "succeeded" }]);
});
test("unified execute shares real asset handlers and video tools with workspace and recursion fences", async () => {
  const f = fixture();
  const direct = await f.tool("asset_list", { scope: "workspace", workspace: "farq" }, "/mcp");
  const accepted = await f.tool(
    "execute",
    {
      workspace_id: "w1",
      idempotency_key: "canvas-catalog",
      code: "emit(await tools.asset_list({scope:'workspace',workspace:'farq'})); const project = await tools.video_project_get({project_id:'project1'}); emit({title:project.title,raw:typeof tools.canvas_run,nested:typeof tools.execute});",
    },
    "/mcp",
  );
  const jobId = accepted.structuredContent.data.job_id;
  await f.wait(jobId);
  expect(f.jobs.get(jobId)?.result).toMatchObject({
    success: true,
    emitted: [direct.structuredContent, { title: "Farq", raw: "undefined", nested: "undefined" }],
  });
  expect(f.effects.get(jobId)).toMatchObject([
    { tool: "asset_list", state: "succeeded" },
    { tool: "video_project_get", state: "succeeded" },
  ]);
  const rejected = await f.tool(
    "execute",
    {
      workspace_id: "w1",
      idempotency_key: "canvas-outside",
      code: "await tools.asset_list({scope:'workspace',workspace:'outside'});",
    },
    "/mcp",
  );
  await f.wait(rejected.structuredContent.data.job_id);
  expect(f.jobs.get(rejected.structuredContent.data.job_id)?.state).toBe("failed");
  expect(f.effects.get(rejected.structuredContent.data.job_id)).toEqual([]);
  const crossWorkspaceMove = await f.tool(
    "execute",
    {
      workspace_id: "w1",
      idempotency_key: "cross-workspace-asset-move",
      code: "await tools.asset_move({source_workspace:'farq',destination_workspace:'outside',asset_refs:['asset://workspace/farq/image@1'],idempotency_key:'move'});",
    },
    "/mcp",
  );
  await f.wait(crossWorkspaceMove.structuredContent.data.job_id);
  expect(f.jobs.get(crossWorkspaceMove.structuredContent.data.job_id)?.state).toBe("failed");
});
test("actual MCP→worker runtime→broker roundtrip persists output and never replays completed code", async () => {
  const f = fixture();
  const args = {
    workspace_id: "w1",
    idempotency_key: "run1",
    code: "const project=await tools.video_project_get({project_id:inputs.project}); emit({title:project.title});",
    inputs: { project: "project1" },
  };
  const first = await f.tool("execute", args);
  expect(first.isError).toBe(false);
  const jobId = first.structuredContent.data.job_id;
  await f.wait(jobId);
  const state = await f.tool("job_get", { job_id: jobId });
  expect(state.structuredContent).toMatchObject({
    ok: true,
    data: {
      state: "succeeded",
      result: {
        emitted: [{ title: "Farq" }],
        accounting: "broker_only",
        untracked_network_effects_possible: true,
      },
      effects: { items: [{ state: "succeeded", tool: "video_project_get" }] },
    },
  });
  const replay = await f.tool("execute", args);
  expect(replay.structuredContent.data.replayed).toBe(true);
  expect(f.counts().workerCalls).toBe(1);
});
test("broker denies writes in read_only and rejects other workspace before dispatch", async () => {
  const f = fixture();
  for (const [key, code] of [
    [
      "write",
      "await tools.video_script_patch({draft_id:'draft1',idempotency_key:'p',expected_revision:'rev1',operations:[{op:'replace',path:'/title',value:'New'}]});",
    ],
    ["scope", "await tools.video_project_get({project_id:'outside'});"],
  ]) {
    const result = await f.tool("execute", { workspace_id: "w1", idempotency_key: key, code });
    const jobId = result.structuredContent.data.job_id;
    await f.wait(jobId);
    expect(f.jobs.get(jobId)?.state).toBe("failed");
    expect(f.effects.get(jobId)).toEqual([]);
  }
  expect(f.counts().writes).toBe(0);
});
test("successful write remains journaled when later code throws", async () => {
  const f = fixture();
  const result = await f.tool("execute", {
    workspace_id: "w1",
    idempotency_key: "partial",
    tool_access: "read_write",
    code: "await tools.video_script_patch({draft_id:'draft1',idempotency_key:'p',expected_revision:'rev1',operations:[{op:'replace',path:'/title',value:'New'}]}); throw new Error('later code failure');",
  });
  const jobId = result.structuredContent.data.job_id;
  await f.wait(jobId);
  expect(f.jobs.get(jobId)?.state).toBe("failed");
  expect(f.counts().writes).toBe(1);
  expect(f.effects.get(jobId)).toMatchObject([{ state: "succeeded", tool: "video_script_patch" }]);
  const effect = await f.tool("job_effect_get", {
    job_id: jobId,
    call_id: f.effects.get(jobId)?.[0]?.callId,
  });
  expect(effect.structuredContent.data.complete).toBe(true);
  expect(JSON.parse(effect.structuredContent.data.result_json)).toMatchObject({
    structuredContent: { ok: true, data: { revision_id: "rev2" } },
  });
});
test("broker validates malformed targets before scope with the same direct error and zero effects", async () => {
  const f = fixture(),
    args = { target: "invalid", body: { text: "Note" }, idempotency_key: "bad" };
  const direct = await f.tool("video_comment_create", args);
  const run = await f.tool("execute", {
    workspace_id: "w1",
    idempotency_key: "invalid-target",
    tool_access: "read_write",
    inputs: { args },
    code: "try{await tools.video_comment_create(inputs.args);}catch(error){emit({code:error.code,effect:error.effect,recovery:error.recovery});}",
  });
  const jobId = run.structuredContent.data.job_id;
  await f.wait(jobId);
  expect(f.jobs.get(jobId)?.result).toMatchObject({
    success: true,
    emitted: [
      {
        code: direct.structuredContent.error.code,
        effect: direct.structuredContent.error.effect,
        recovery: direct.structuredContent.error.recovery,
      },
    ],
  });
  expect(f.effects.get(jobId)).toEqual([]);
});
test("ambiguous write error remains unknown in durable effect summary", async () => {
  const f = fixture();
  const result = await f.tool("execute", {
    workspace_id: "w1",
    idempotency_key: "unknown-run",
    tool_access: "read_write",
    code: "await tools.video_script_patch({draft_id:'draft1',idempotency_key:'unknown',expected_revision:'rev1',operations:[{op:'replace',path:'/title',value:'New'}]});",
  });
  const jobId = result.structuredContent.data.job_id;
  await f.wait(jobId);
  expect(f.effects.get(jobId)).toMatchObject([{ state: "unknown", tool: "video_script_patch" }]);
});
