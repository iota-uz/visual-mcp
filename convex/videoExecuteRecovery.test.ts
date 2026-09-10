/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts"),
  expire = makeFunctionReference<"mutation">("videoExecuteRecovery:expireQueued");
test("queued watchdog distinguishes never-started, claimed and contradictory effects without rerunning code", async () => {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", {
      email: "watchdog@iota.uz",
      name: "Fixture",
      lastSeenAt: 0,
    });
    const workspace = await ctx.db.insert("workspaces", {
      name: "Watchdog",
      slug: "watchdog",
      createdBy: user,
    });
    const create = (key: string, state: "queued" | "running", fence: number) =>
      ctx.db.insert("videoJobs", {
        workspaceId: workspace,
        principalId: user,
        idempotencyKey: key,
        inputHash: "hash",
        request: "{}",
        kind: "execute",
        state,
        fence,
        createdAt: 0,
        updatedAt: 0,
        stage: state,
      });
    return {
      queued: await create("queued", "queued", 0),
      running: await create("running", "running", 1),
      inconsistent: await create("bad", "queued", 0),
    };
  });
  await t.run((ctx) =>
    ctx.db.insert("videoJobEffects", {
      jobId: fixture.inconsistent,
      callId: "one",
      tool: "write",
      inputHash: "hash",
      state: "dispatching",
      updatedAt: 0,
    }),
  );
  expect(await t.mutation(expire, { jobId: fixture.queued, createdAt: 0 })).toEqual({
    expired: true,
    effect: "not_applied",
  });
  expect(await t.mutation(expire, { jobId: fixture.running, createdAt: 0 })).toEqual({
    expired: false,
  });
  expect(await t.mutation(expire, { jobId: fixture.inconsistent, createdAt: 0 })).toEqual({
    expired: true,
    effect: "unknown",
  });
  const job = await t.run((ctx) => ctx.db.get(fixture.queued));
  expect(job).toMatchObject({
    state: "failed",
    fence: 0,
    errorCode: "EXECUTE_NOT_STARTED",
    errorEffect: "not_applied",
  });
  expect(await t.mutation(expire, { jobId: fixture.queued, createdAt: 0 })).toEqual({
    expired: false,
  });
});
