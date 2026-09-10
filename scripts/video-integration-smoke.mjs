/** Coordinated LOCAL ONLY MCP→Convex→execute worker acceptance driver.
 * Import and call from the release coordinator with the dev secret in memory.
 * Never prints, persists, reads browser storage or obtains provider credentials.
 * Creates a labeled local workspace/project/jobs for inspection; revokes its MCP
 * token on every exit. Does not call paid producers or publish/approve anything.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const local = (value) => {
  const url = new URL(value);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "LOCAL_ONLY");
  assert.equal(url.protocol, "http:", "LOCAL_HTTP_ONLY");
  assert(!url.username && !url.password && !url.search && !url.hash, "NO_URL_CREDENTIALS");
  return url;
};
export async function runLocalMcpSmoke({
  devAuthSecret,
  convexUrl = "http://127.0.0.1:3310",
  mcpUrl = "http://127.0.0.1:3315",
  email = "video-mcp-smoke@iota.uz",
}) {
  assert(
    typeof devAuthSecret === "string" && devAuthSecret.length > 0,
    "DEV_SECRET_REQUIRED_IN_MEMORY",
  );
  const convex = new ConvexHttpClient(local(convexUrl).origin);
  const base = local(mcpUrl);
  const tag = `video-smoke-${randomUUID().slice(0, 8)}`;
  let tokenId;
  const clients = [];
  let stage = "authenticate";
  try {
    const auth = await convex.action(makeFunctionReference("auth:signIn"), {
      provider: "dev",
      params: { email, secret: devAuthSecret },
    });
    assert(auth.tokens?.token, "DEV_SIGN_IN_DID_NOT_RETURN_SESSION");
    convex.setAuth(auth.tokens.token);
    const minted = await convex.mutation(makeFunctionReference("tokens:mintMine"), { name: tag });
    tokenId = minted.tokenId;
    for (const endpoint of ["/mcp", "/mcp/video"]) {
      const client = new Client({ name: "visual-video-local-acceptance", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint, base), {
          requestInit: { headers: { authorization: `Bearer ${minted.token}` } },
        }),
      );
      clients.push(client);
    }
    const [canvas, video] = clients;
    const call = async (client, name, args) => {
      const response = await client.callTool({ name, arguments: args });
      if (response.isError)
        throw new Error(
          `TOOL_FAILED:${name}:${response.structuredContent?.error?.code ?? "unclassified"}`,
        );
      const value = response.structuredContent;
      return value?.ok === true ? value.data : value;
    };
    const poll = async (jobId) => {
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        const job = await call(video, "job_get", { job_id: jobId });
        if (["succeeded", "failed", "cancelled", "outcome_unknown"].includes(job.state)) return job;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw new Error("LOCAL_JOB_DID_NOT_SETTLE");
    };
    stage = "catalogs";
    const canvasNames = (await canvas.listTools()).tools.map((tool) => tool.name);
    const videoNames = (await video.listTools()).tools.map((tool) => tool.name);
    assert(canvasNames.includes("execute") && canvasNames.includes("image_generate"));
    assert(!canvasNames.includes("video_project_create"));
    assert(videoNames.includes("video_project_create") && videoNames.includes("asset_get"));
    stage = "workspace-project";
    const workspace = await convex.mutation(makeFunctionReference("workspaces:createMine"), {
      name: tag,
      slug: tag,
      description: "Local acceptance fixture; no paid provider calls.",
    });
    const project = await call(video, "video_project_create", {
      workspace_id: workspace.workspaceId,
      idempotency_key: `${tag}:project`,
      title: tag,
      brief: {
        topic: "farq.uz local fixture",
        direction: "Check actual MCP contracts; not a quality evaluation",
      },
      format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
      languages: ["ru", "uz"],
    });
    assert.equal(project.drafts.length, 2);
    stage = "canvas-execute";
    const canvasRun = await call(canvas, "execute", {
      workspace_id: workspace.workspaceId,
      idempotency_key: `${tag}:canvas-execute`,
      inputs: { workspace: workspace.slug },
      code: "const assets = await tools.asset_list({scope:'workspace',workspace:inputs.workspace}); emit({count:assets.count,videoTool:typeof tools.video_project_get,recursive:typeof tools.canvas_run});",
    });
    const canvasJob = await poll(canvasRun.job_id);
    assert.equal(canvasJob.state, "succeeded");
    assert.deepEqual(canvasJob.result.emitted, [
      { count: 0, videoTool: "undefined", recursive: "undefined" },
    ]);
    stage = "video-execute-offline-fixtures";
    const runInput = {
      workspace_id: workspace.workspaceId,
      idempotency_key: `${tag}:video-execute`,
      tool_access: "read_write",
      inputs: { project: project.project_id, key: `${tag}:eval` },
      code: "const p = await tools.video_project_get({project_id:inputs.project}); const receipt=await tools.video_eval_run({workspace_id:context.workspace_id,idempotency_key:inputs.key,evaluation:{runner:'workflow-contract-v1',dataset:'workflow-contract-v1',execution:{mode:'offline'}}}); emit({project:p.project_id,evalJob:receipt.job_id});",
    };
    const run = await call(video, "execute", runInput);
    const executed = await poll(run.job_id);
    assert.equal(executed.state, "succeeded");
    const evaluation = await poll(executed.result.emitted[0].evalJob);
    assert.equal(evaluation.state, "succeeded");
    assert.equal(evaluation.result.report.runner, "workflow-contract-v1");
    assert.equal(evaluation.result.report.cases.length, 5);
    assert(
      evaluation.result.report.cases.every(
        (item) => item.outcome === "pass" && item.workspaceRolledBack,
      ),
    );
    assert.equal(
      evaluation.result.report.provenance,
      "actual-convex-handler-execution-rolled-back",
    );
    const replay = await call(video, "execute", runInput);
    assert.equal(replay.job_id, run.job_id);
    assert.equal(replay.replayed, true);
    stage = "resources";
    const models = await call(video, "resource_find", { kind: "model", query: "image" });
    const model = await call(video, "resource_get", { uri: models.items[0].uri });
    assert.equal(JSON.parse(model.content).availability, "account_not_verified");
    return {
      status: "passed",
      fixture: tag,
      workspaceId: workspace.workspaceId,
      projectId: project.project_id,
      jobs: {
        canvasExecute: canvasRun.job_id,
        videoExecute: run.job_id,
        offlineEvaluation: evaluation.job_id,
      },
      coverage: [
        "actual-installed-SDK-client-to-MCP-server",
        "actual-local-Convex-auth-and-token",
        "shared-Canvas-handler-broker",
        "separate-endpoint-catalogs",
        "worker-runtime-and-durable-effect-journal",
        "five-real-Convex-contract-fixtures-with-rollback",
        "same-key-execute-no-replay",
        "native-domain-resource-source",
      ],
      limitations: [
        "No paid provider call, real video render, native visual perception or human approval was tested.",
        "Labeled local workspace/project/jobs remain for inspection; minted MCP token is revoked.",
      ],
    };
  } catch {
    // Do not propagate transport exceptions: they may contain authentication
    // request headers or input parameters. The coordinator can inspect local
    // non-secret service diagnostics using this bounded stage marker.
    throw new Error(`LOCAL_VIDEO_ACCEPTANCE_FAILED:${stage}`);
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    if (tokenId) await convex.mutation(makeFunctionReference("tokens:revokeMine"), { tokenId });
    convex.clearAuth();
  }
}
