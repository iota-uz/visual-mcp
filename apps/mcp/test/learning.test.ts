import { expect, test, vi } from "vitest";
import type { AgentGateway } from "../src/gateway.js";
import { createApp } from "../src/index.js";
import { callVideoTool } from "../src/video/registry.js";

const hash = "a".repeat(64);
function fixture() {
  const call = vi.fn(async (_operation: string, args: Record<string, unknown>) => {
    if (args.name === "submitJob")
      return {
        ok: true,
        data: {
          jobId: "job",
          kind: "offline_eval",
          state: "queued",
          replayed: false,
          pollAfterMs: 1000,
          operation: { toolName: "offline_eval", idempotencyKey: "key" },
        },
      };
    if (args.name === "getJob")
      return {
        ok: true,
        data: {
          jobId: "job",
          kind: "analytics_import",
          state: "succeeded",
          replayed: false,
          pollAfterMs: 1000,
          operation: { toolName: "analytics_import", idempotencyKey: "key" },
          workspaceId: "workspace",
          stage: "done",
          createdAt: 0,
          updatedAt: 0,
          error: null,
          result: {
            kind: "analytics_import",
            publicationId: "publication",
            imported: 2,
            duplicates: 1,
          },
        },
      };
    if (args.name === "getJobEffects")
      return { ok: true, data: { page: [], isDone: true, continueCursor: "" } };
    throw new Error("Unexpected operation");
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
  async function request(name: string, args: Record<string, unknown>) {
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer valid",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
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
test("SDK offline eval receipt is pollable through unified typed job reader without execute configuration", async () => {
  const f = fixture(),
    result = await f.request("video_eval_run", {
      workspace_id: "workspace",
      idempotency_key: "key",
      evaluation: {
        runner: "workflow-contract-v1",
        dataset: "workflow-contract-v1",
        execution: { mode: "offline" },
      },
    });
  expect(result.result.structuredContent).toMatchObject({
    ok: true,
    data: { job_id: "job", state: "queued" },
  });
  const read = await f.request("job_get", { job_id: "job" });
  expect(read.result.structuredContent).toMatchObject({
    ok: true,
    data: {
      result: { kind: "analytics_import", imported: 2, duplicates: 1 },
      operation: { tool: "analytics_import" },
    },
  });
});
test("SDK rejects live runner instead of substituting a model API call", async () => {
  const f = fixture(),
    result = await f.request("video_eval_run", {
      workspace_id: "workspace",
      idempotency_key: "key",
      evaluation: {
        runner: "workflow-contract-v1",
        dataset: "workflow-contract-v1",
        execution: { mode: "live", allow_paid: true },
      },
    });
  expect(result.result.structuredContent).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
  });
  expect(f.call).not.toHaveBeenCalled();
});
test("memory reader preserves canonical proposal fields and policy provenance", async () => {
  const result = await callVideoTool(
    "video_memory_get",
    { workspace_id: "workspace" },
    async () => ({
      page: [
        {
          memoryId: "memory",
          revisionId: "revision",
          projectId: "project",
          profileId: null,
          scope: { kind: "project", projectId: "project" },
          statement: "Hypothesis",
          applicability: "One fixture",
          exceptions: [],
          language: "ru",
          supportingEvidenceIds: ["evidence"],
          contradictingEvidenceIds: [],
          status: "proposed",
          validation: null,
        },
      ],
      isDone: true,
      continueCursor: "",
      policy: { id: "independent-video-v1", requirements: ["Distinct source projects"] },
      policyHash: hash,
    }),
  );
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: {
      items: [{ memory_id: "memory", supportingEvidenceIds: ["evidence"], status: "proposed" }],
      policy_hash: hash,
    },
  });
});
test("analytics reader preserves explicit normalized values and comparison dimensions", async () => {
  const result = await callVideoTool(
    "video_analytics_get",
    { workspace_id: "workspace", project_id: "project" },
    async () => ({
      page: [
        {
          observationId: "o",
          publicationId: "p",
          publicationRevision: "r",
          language: "ru",
          metric: "views",
          value: null,
          unit: "count",
          definition: "Platform views",
          aggregation: "window",
          windowStart: "2026-09-01T00:00:00Z",
          windowEnd: "2026-09-02T00:00:00Z",
          observedAt: "2026-09-02T00:00:00Z",
          sourceReference: "row",
          source: {
            kind: "manual",
            reference: "Source",
            asset: { assetId: "a", revisionId: "r" },
            sha256: hash,
          },
          comparisonGroup: {
            platform: "youtube",
            sourceKind: "manual",
            language: "ru",
            metric: "views",
            unit: "count",
            definition: "Platform views",
            aggregation: "window",
            publicationAge: null,
            incomparablePublication: "p",
            start: "start",
            end: "end",
            topic: null,
            format: null,
            audience: null,
            distribution: null,
          },
          caveats: ["Not causal"],
        },
      ],
      isDone: true,
      continueCursor: "",
    }),
  );
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: { items: [{ value: null, publication_revision: "r" }] },
  });
});
