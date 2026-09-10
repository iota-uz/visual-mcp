/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const m = (name: string) => makeFunctionReference<"mutation">(`videoJobs:${name}`);
const q = (name: string) => makeFunctionReference<"query">(`videoJobs:${name}`);
const request = {
  kind: "execute",
  code: "emit(1)",
  toolAccess: "read_only",
  timeoutMs: 5000,
  memoryLimitMb: 128,
  maxToolCalls: 30,
  maxConcurrency: 1,
  maxOutputBytes: 32768,
  registryRevision: "test",
};
async function setup() {
  const t = convexTest(schema, modules);
  const { userId, workspaceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "jobs@iota.uz",
      name: "Jobs",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "jobs",
      name: "Jobs",
      createdBy: userId,
    });
    return { userId, workspaceId };
  });
  return {
    t,
    as: t.withIdentity({ subject: `${userId}|session`, issuer: "convex" }),
    userId,
    workspaceId,
  };
}
test("receipt replay never reclaims completed or unknown work", async () => {
  const { t, as, userId, workspaceId } = await setup();
  const args = { workspaceId, idempotencyKey: "once", request };
  const r = await as.mutation(m("submit"), args);
  const claim = await t.mutation(m("claim"), { jobId: r.jobId, videoPrincipalId: userId });
  expect(claim.fence).toBe(1);
  expect(await t.mutation(m("claim"), { jobId: r.jobId })).toBeNull();
  await t.mutation(m("fail"), {
    jobId: r.jobId,
    fence: 1,
    code: "OUTCOME_UNKNOWN",
    outcomeUnknown: true,
  });
  expect((await as.mutation(m("submit"), args)).state).toBe("outcome_unknown");
  expect(await t.mutation(m("claim"), { jobId: r.jobId })).toBeNull();
  await expect(
    as.mutation(m("submit"), { ...args, request: { ...request, code: "emit(2)" } }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
test("fences, journal identity and cancel-before-start", async () => {
  const { t, as, workspaceId } = await setup();
  const r = await as.mutation(m("submit"), { workspaceId, idempotencyKey: "run", request });
  await t.mutation(m("claim"), { jobId: r.jobId });
  await expect(t.mutation(m("complete"), { jobId: r.jobId, fence: 0, result: {} })).rejects.toThrow(
    "STALE_FENCE",
  );
  const effect = {
    jobId: r.jobId,
    fence: 1,
    callId: "1",
    tool: "video_project_get",
    inputHash: "hash",
    state: "dispatching",
  };
  await t.mutation(m("recordEffect"), effect);
  await t.mutation(m("recordEffect"), { ...effect, state: "succeeded", result: { ok: true } });
  await expect(
    t.mutation(m("recordEffect"), { ...effect, inputHash: "different" }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await t.mutation(m("complete"), { jobId: r.jobId, fence: 1, result: { emitted: [1] } });
  expect((await as.query(q("getJob"), { jobId: r.jobId })).result.emitted).toEqual([1]);
  const cancelled = await as.mutation(m("submit"), {
    workspaceId,
    idempotencyKey: "cancel",
    request,
  });
  await as.mutation(m("cancel"), { jobId: cancelled.jobId });
  expect(await t.mutation(m("claim"), { jobId: cancelled.jobId })).toBeNull();
});
test("provider jobs require explicit paid request and known model", async () => {
  const { as, workspaceId } = await setup();
  await expect(
    as.mutation(m("submit"), {
      workspaceId,
      idempotencyKey: "bad",
      request: {
        kind: "image",
        prompt: "x",
        model: "gpt-image-2.5-sunburst",
        quality: "high",
        size: "1024x1024",
      },
    }),
  ).rejects.toThrow("VALIDATION_ERROR");
});
test("gateway principal cannot claim or forge media completion", async () => {
  const { t, as, userId, workspaceId } = await setup();
  const r = await as.mutation(m("submit"), {
    workspaceId,
    idempotencyKey: "image",
    request: {
      kind: "image",
      allowPaid: true,
      prompt: "x",
      model: "gpt-image-2.5-sunburst",
      quality: "high",
      size: "1152x2048",
    },
  });
  await expect(
    t.mutation(m("claim"), { jobId: r.jobId, videoPrincipalId: userId }),
  ).rejects.toThrow("NOT_FOUND_OR_FORBIDDEN");
  await t.mutation(m("claim"), { jobId: r.jobId });
  await expect(
    t.mutation(m("complete"), {
      jobId: r.jobId,
      fence: 1,
      videoPrincipalId: userId,
      result: { kind: "image" },
    }),
  ).rejects.toThrow("NOT_FOUND_OR_FORBIDDEN");
});
test("effect admission is monotonic and expired executor never reclaims", async () => {
  const { t, as, workspaceId } = await setup();
  const r = await as.mutation(m("submit"), { workspaceId, idempotencyKey: "journal", request });
  await t.mutation(m("claim"), { jobId: r.jobId });
  const effect = {
    jobId: r.jobId,
    fence: 1,
    callId: "x",
    tool: "get",
    inputHash: "hash",
    state: "dispatching",
  };
  expect((await t.mutation(m("recordEffect"), effect)).created).toBe(true);
  await t.mutation(m("recordEffect"), { ...effect, state: "succeeded", result: { ok: true } });
  const replay = await t.mutation(m("recordEffect"), effect);
  expect(replay.created).toBe(false);
  expect(replay.existing.state).toBe("succeeded");
  await t.mutation(m("expireClaim"), { jobId: r.jobId, fence: 1 });
  expect((await as.query(q("getJob"), { jobId: r.jobId })).state).toBe("outcome_unknown");
  expect(await t.mutation(m("claim"), { jobId: r.jobId })).toBeNull();
});
