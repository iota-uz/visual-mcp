/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import {
  CharacterActionDefinition,
  canonicalActionDefinition,
} from "../packages/video/src/character-action-library";
import { sha256Hex } from "./lib/hash";
import { purgeWorkspace } from "./lib/purge";
import { purgeVideoProject } from "./lib/videoPurge";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const register = makeFunctionReference<"mutation">("characterLibrary:agentRegister");
const promote = makeFunctionReference<"mutation">("characterLibrary:agentPromote");
const get = makeFunctionReference<"query">("characterLibrary:agentGet");
const list = makeFunctionReference<"query">("characterLibrary:agentList");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const principal = await ctx.db.insert("users", {
      email: "agent@iota.uz",
      name: "Agent",
      lastSeenAt: 0,
    });
    const invalidPrincipal = await ctx.db.insert("users", {
      email: "outsider@example.com",
      name: "Outsider",
      lastSeenAt: 0,
    });
    const workspace = await ctx.db.insert("workspaces", {
      slug: "one",
      name: "One",
      createdBy: principal,
    });
    const otherWorkspace = await ctx.db.insert("workspaces", {
      slug: "two",
      name: "Two",
      createdBy: principal,
    });
    const project = await ctx.db.insert("videoProjects", {
      workspaceId: workspace,
      title: "One",
      brief: "{}",
      format: "{}",
      revisionId: "r1",
      createdBy: principal,
      updatedAt: 0,
    });
    const otherProject = await ctx.db.insert("videoProjects", {
      workspaceId: otherWorkspace,
      title: "Two",
      brief: "{}",
      format: "{}",
      revisionId: "r2",
      createdBy: principal,
      updatedAt: 0,
    });
    return { principal, invalidPrincipal, workspace, otherWorkspace, project, otherProject };
  });
  const raw = {
    id: "blink",
    label: "Blink",
    content: { kind: "single" as const, durationSeconds: 0.2, action: { type: "blink" } },
  };
  const revisionId = await sha256Hex(canonicalActionDefinition(raw));
  const definition = CharacterActionDefinition.parse({ ...raw, revisionId });
  return { t, ids, revisionId, definition: JSON.stringify(definition) };
}

describe("immutable character action library", () => {
  test("project deletion removes local definitions but preserves promoted workspace revisions", async () => {
    const { t, ids, definition, revisionId } = await fixture();
    await t.mutation(register, {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      projectId: ids.project,
      definition,
      idempotencyKey: "r",
    });
    await t.mutation(promote, {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      projectId: ids.project,
      revisionId,
      idempotencyKey: "p",
    });
    await t.run((ctx) => purgeVideoProject(ctx, ids.project));
    const rows = await t.run((ctx) => ctx.db.query("characterActions").take(10));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: "shared", revisionId });
  });

  test("workspace deletion removes promoted shared action definitions", async () => {
    const { t, ids, definition, revisionId } = await fixture();
    await t.mutation(register, {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      projectId: ids.project,
      definition,
      idempotencyKey: "workspace-register",
    });
    await t.mutation(promote, {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      projectId: ids.project,
      revisionId,
      idempotencyKey: "workspace-promote",
    });

    await t.run(async (ctx) => {
      const workspace = await ctx.db.get(ids.workspace);
      if (!workspace) throw new Error("Fixture workspace missing");
      await purgeWorkspace(ctx, workspace);
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("characterActions")
        .withIndex("by_workspaceId_and_scope_and_projectId", (q) =>
          q.eq("workspaceId", ids.workspace),
        )
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });
  test("register is canonical-hash verified, replay-safe, and conflicting replay fails", async () => {
    const { t, ids, definition, revisionId } = await fixture();
    const args = {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      projectId: ids.project,
      definition,
      idempotencyKey: "register-1",
    };
    const first = await t.mutation(register, args);
    await expect(t.mutation(register, args)).resolves.toEqual(first);
    const changedRaw = {
      id: "blink",
      label: "Blink!",
      content: { kind: "single" as const, durationSeconds: 0.2, action: { type: "blink" } },
    };
    const changedRevisionId = await sha256Hex(canonicalActionDefinition(changedRaw));
    const changed = JSON.stringify(
      CharacterActionDefinition.parse({ ...changedRaw, revisionId: changedRevisionId }),
    );
    await expect(t.mutation(register, { ...args, definition: changed })).rejects.toThrow(
      /IDEMPOTENCY_CONFLICT|different input/,
    );
    const bad = JSON.stringify({ ...JSON.parse(definition), revisionId: "0".repeat(64) });
    await expect(
      t.mutation(register, { ...args, definition: bad, idempotencyKey: "bad-hash" }),
    ).rejects.toThrow(/HASH_MISMATCH/);
    expect(first).toMatchObject({ revisionId, scope: "project" });
  });

  test("promotion preserves immutable bytes and workspace isolation", async () => {
    const { t, ids, definition, revisionId } = await fixture();
    await t.mutation(register, {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      projectId: ids.project,
      definition,
      idempotencyKey: "r",
    });
    await t.mutation(promote, {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      projectId: ids.project,
      revisionId,
      idempotencyKey: "p",
    });
    const shared = await t.query(get, {
      videoPrincipalId: ids.principal,
      workspaceId: ids.workspace,
      scope: "shared",
      revisionId,
    });
    expect(shared).toMatchObject({
      scope: "shared",
      projectId: null,
      definition: JSON.parse(definition),
    });
    await expect(
      t.query(get, {
        videoPrincipalId: ids.principal,
        workspaceId: ids.otherWorkspace,
        scope: "shared",
        revisionId,
      }),
    ).rejects.toThrow(/NOT_FOUND_OR_FORBIDDEN/);
    await expect(
      t.mutation(promote, {
        videoPrincipalId: ids.principal,
        workspaceId: ids.otherWorkspace,
        projectId: ids.project,
        revisionId,
        idempotencyKey: "wrong",
      }),
    ).rejects.toThrow(/NOT_FOUND_OR_FORBIDDEN/);
  });

  test("invalid principals, invalid scope shapes, and page bounds fail", async () => {
    const { t, ids, definition } = await fixture();
    await expect(
      t.mutation(register, {
        videoPrincipalId: ids.invalidPrincipal,
        workspaceId: ids.workspace,
        projectId: ids.project,
        definition,
        idempotencyKey: "x",
      }),
    ).rejects.toThrow(/NOT_FOUND_OR_FORBIDDEN/);
    await expect(
      t.query(list, {
        videoPrincipalId: ids.principal,
        workspaceId: ids.workspace,
        scope: "shared",
        projectId: ids.project,
        paginationOpts: { cursor: null, numItems: 20 },
      }),
    ).rejects.toThrow(/Shared definitions/);
    for (const numItems of [0, 51])
      await expect(
        t.query(list, {
          videoPrincipalId: ids.principal,
          workspaceId: ids.workspace,
          scope: "project",
          projectId: ids.project,
          paginationOpts: { cursor: null, numItems },
        }),
      ).rejects.toThrow(/Page size/);
  });
});
