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
function fixture() {
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
      runQuery: async (_fn: unknown, input: Record<string, unknown>) =>
        input.slug
          ? {
              workspaceId: input.slug === "farq" ? "w1" : "outside",
              slug: input.slug,
              name: "Farq",
            }
          : { page: [], isDone: true, continueCursor: "" },
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
  async function tool(name: string, args: Record<string, unknown>, endpoint = "/mcp/video") {
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
  return { tool, wait, jobs, effects, workerUrls, counts: () => ({ workerCalls, writes }) };
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
test("Canvas endpoint execute calls captured real asset handler, preserves catalog isolation and workspace fence", async () => {
  const f = fixture();
  const direct = await f.tool("asset_list", { scope: "workspace", workspace: "farq" }, "/mcp");
  const accepted = await f.tool(
    "execute",
    {
      workspace_id: "w1",
      idempotency_key: "canvas-catalog",
      code: "emit(await tools.asset_list({scope:'workspace',workspace:'farq'})); emit({video:typeof tools.video_project_get,raw:typeof tools.canvas_run});",
    },
    "/mcp",
  );
  const jobId = accepted.structuredContent.data.job_id;
  await f.wait(jobId);
  expect(f.jobs.get(jobId)?.result).toMatchObject({
    success: true,
    emitted: [direct.structuredContent, { video: "undefined", raw: "undefined" }],
  });
  expect(f.effects.get(jobId)).toMatchObject([{ tool: "asset_list", state: "succeeded" }]);
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
