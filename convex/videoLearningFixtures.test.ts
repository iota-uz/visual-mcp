/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { FIXTURE_CASES } from "./videoLearningFixtures";

const modules = import.meta.glob("./**/*.ts");
test("real Convex handler offline fixture cases assert guards and roll back all fixture state", async () => {
  const t = convexTest(schema, modules),
    principalId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "fixture@iota.uz", name: "Fixture", lastSeenAt: 0 }),
    );
  for (const caseId of FIXTURE_CASES) {
    let captured: unknown;
    try {
      await t.mutation(makeFunctionReference<"mutation">("videoLearningFixtures:exercise"), {
        principalId,
        caseId,
        nonce: `nonce-${caseId}`,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({
      data: {
        code: "INTERNAL_FIXTURE_ROLLBACK",
        nonce: `nonce-${caseId}`,
        caseId,
        report: { outcome: "pass", workspaceRolledBack: true },
      },
    });
    expect(await t.run((ctx) => ctx.db.query("workspaces").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("videoJobs").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("videoProjects").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("assets").take(1))).toEqual([]);
  }
});
