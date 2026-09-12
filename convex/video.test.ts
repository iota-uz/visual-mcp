/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ref = (name: string) => makeFunctionReference<"mutation">(`video:${name}`);
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "video@iota.uz",
      name: "Video",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Video",
      slug: "video",
      createdBy: userId,
    });
    return { userId, workspaceId };
  });
  return { t, as: t.withIdentity({ subject: `${ids.userId}|session`, issuer: "convex" }), ...ids };
}
const input = {
  title: "Farq",
  brief: { topic: "Тест", direction: "Демонстрация" },
  languages: ["ru", "uz"],
  format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
};
test("planned duration initializes the timeline but never overrides its actual duration", async () => {
  const { as, workspaceId } = await setup();
  const created = await as.mutation(ref("createProject"), {
    ...input,
    workspaceId,
    idempotencyKey: "planned-duration",
    languages: ["ru"],
    format: { ...input.format, plannedDurationMs: 55_000 },
  });
  const draft = await as.query(makeFunctionReference<"query">("video:getDraft"), {
    draftId: created.drafts[0].draftId,
  });
  expect(draft.timeline.durationFrames).toBe(1650);

  const changed = await as.mutation(ref("patchTimeline"), {
    draftId: draft.draftId,
    idempotencyKey: "actual-duration",
    expectedRevision: draft.timelineRevision,
    operations: [{ op: "replace", path: "/durationFrames", value: 900 }],
  });
  const actual = await as.query(makeFunctionReference<"query">("video:getDraft"), {
    draftId: draft.draftId,
  });
  const project = await as.query(makeFunctionReference<"query">("video:getProject"), {
    projectId: created.projectId,
  });
  expect(changed.changed).toBe(true);
  expect(actual.timeline.durationFrames).toBe(900);
  expect(project.format.plannedDurationMs).toBe(55_000);
});

test("explicit duration migration rewrites the legacy planning field", async () => {
  const { t, as, workspaceId } = await setup();
  const created = await as.mutation(ref("createProject"), {
    ...input,
    workspaceId,
    idempotencyKey: "legacy-duration",
    languages: ["ru"],
  });
  await t.run((ctx) =>
    ctx.db.patch("videoProjects", created.projectId, {
      format: JSON.stringify({ ...input.format, targetDurationMs: 55_000 }),
      revisionId: "legacy-revision",
    }),
  );
  await expect(
    t.mutation(makeFunctionReference<"mutation">("videoDurationMigration:renamePlanningHint"), {
      projectId: created.projectId,
      expectedProjectRevision: "legacy-revision",
    }),
  ).resolves.toMatchObject({ changed: true, versions: 0 });
  const project = await as.query(makeFunctionReference<"query">("video:getProject"), {
    projectId: created.projectId,
  });
  expect(project.format).toMatchObject({ plannedDurationMs: 55_000 });
  expect(project.format).not.toHaveProperty("targetDurationMs");
});

test("timeline patch atomically repairs a saved document whose component revision is unsupported", async () => {
  const { t, as, workspaceId } = await setup();
  const created = await as.mutation(ref("createProject"), {
    ...input,
    workspaceId,
    idempotencyKey: "repair-create",
    languages: ["ru"],
  });
  const draftId = created.drafts[0].draftId;
  const legacy = {
    fps: input.format.fps,
    durationFrames: 60,
    trackOrder: ["visual"],
    tracksById: {
      visual: {
        kind: "visual",
        clipOrder: ["pilot"],
        clipsById: {
          pilot: {
            startFrame: 0,
            durationFrames: 60,
            source: {
              kind: "component",
              component: { resourceId: "video/component/character-scene", revisionId: "1" },
              props: { legacy: true },
            },
          },
        },
      },
    },
  };
  await t.run((ctx) =>
    ctx.db.patch("videoDrafts", draftId, {
      timeline: JSON.stringify(legacy),
      timelineRevision: "legacy-timeline-revision",
    }),
  );
  const repaired = await as.mutation(ref("patchTimeline"), {
    draftId,
    idempotencyKey: "repair-timeline",
    expectedRevision: "legacy-timeline-revision",
    operations: [
      {
        op: "replace",
        path: "/tracksById/visual/clipsById/pilot/source",
        value: { kind: "text", text: "Repaired" },
      },
    ],
  });
  expect(repaired.changed).toBe(true);
  expect(repaired.staleDependents).toContainEqual({
    kind: "draft_dependents",
    draftId,
    reason: "additional_dependencies_require_review",
  });
  const draft = await as.query(makeFunctionReference<"query">("video:getDraft"), { draftId });
  expect(draft.timeline.tracksById.visual.clipsById.pilot.source).toEqual({
    kind: "text",
    text: "Repaired",
  });
});

test("patch identifies only changed scenes and exact current dependent clips/checkpoint/render jobs", async () => {
  const { as, workspaceId } = await setup();
  const p = await as.mutation(ref("createProject"), {
    ...input,
    languages: ["ru"],
    workspaceId,
    idempotencyKey: "dependencies",
  });
  const d = p.drafts[0];
  const scene = (text: string) => ({
    purpose: text,
    narration: text,
    onScreenText: [text],
    visual: { description: text, shot: "static", motion: "static" },
    shotOrder: [],
    shotsById: {},
    claims: [],
  });
  const script = await as.mutation(ref("patchScript"), {
    draftId: d.draftId,
    expectedRevision: d.scriptRevision,
    idempotencyKey: "scenes",
    operations: [
      { op: "replace", path: "/sceneOrder", value: ["one", "two"] },
      { op: "replace", path: "/scenesById", value: { one: scene("One"), two: scene("Two") } },
    ],
  });
  const clips = {
    one: {
      sceneId: "one",
      startFrame: 0,
      durationFrames: 30,
      source: { kind: "text", text: "One" },
    },
    two: {
      sceneId: "two",
      startFrame: 30,
      durationFrames: 30,
      source: { kind: "text", text: "Two" },
    },
  };
  const timeline = await as.mutation(ref("patchTimeline"), {
    draftId: d.draftId,
    expectedRevision: d.timelineRevision,
    idempotencyKey: "clips",
    operations: [
      { op: "replace", path: "/trackOrder", value: ["captions"] },
      {
        op: "replace",
        path: "/tracksById",
        value: { captions: { kind: "caption", clipOrder: ["one", "two"], clipsById: clips } },
      },
    ],
  });
  const cp = await as.mutation(ref("checkpoint"), {
    draftId: d.draftId,
    expectedProjectRevision: p.revisionId,
    expectedScriptRevision: script.revisionId,
    expectedTimelineRevision: timeline.revisionId,
    idempotencyKey: "dependency-checkpoint",
    label: "Before edit",
  });
  const render = await as.mutation(makeFunctionReference<"mutation">("videoJobs:submit"), {
    workspaceId,
    projectId: p.projectId,
    versionId: cp.version.versionId,
    idempotencyKey: "render-dependency",
    request: { kind: "render", versionId: cp.version.versionId, mode: "draft" },
  });
  const changed = await as.mutation(ref("patchScript"), {
    draftId: d.draftId,
    expectedRevision: script.revisionId,
    idempotencyKey: "one-narration",
    operations: [{ op: "replace", path: "/scenesById/one/narration", value: "Changed one" }],
  });
  expect(changed.affectedSceneIds).toEqual(["one"]);
  expect(changed.staleDependents).toContainEqual({
    kind: "checkpoint",
    versionId: cp.version.versionId,
    reason: "script_changed",
  });
  expect(changed.staleDependents).toContainEqual({
    kind: "job",
    jobId: render.jobId,
    versionId: cp.version.versionId,
    reason: "script_changed",
  });
  expect(changed.staleDependents).toContainEqual({
    kind: "timeline_clip",
    draftId: d.draftId,
    timelineRevision: timeline.revisionId,
    trackId: "captions",
    clipId: "one",
    reason: "narration_changed",
  });
  expect(changed.staleDependents.some((dep: { clipId?: string }) => dep.clipId === "two")).toBe(
    false,
  );
  const noop = await as.mutation(ref("patchScript"), {
    draftId: d.draftId,
    expectedRevision: changed.revisionId,
    idempotencyKey: "no-op-dependencies",
    operations: [{ op: "replace", path: "/scenesById/one/narration", value: "Changed one" }],
  });
  expect(noop.changed).toBe(false);
  expect(noop.affectedSceneIds).toEqual([]);
  expect(noop.staleDependents).toEqual([]);
  const timing = await as.mutation(ref("patchTimeline"), {
    draftId: d.draftId,
    expectedRevision: timeline.revisionId,
    idempotencyKey: "one-timing",
    operations: [
      { op: "replace", path: "/tracksById/captions/clipsById/one/durationFrames", value: 29 },
    ],
  });
  expect(timing.affectedSceneIds).toEqual(["one"]);
  expect(timing.staleDependents).toContainEqual({
    kind: "job",
    jobId: render.jobId,
    versionId: cp.version.versionId,
    reason: "timeline_changed",
  });
});
test("ABA edits never revive old CAS identity and nested validation returns an actionable pointer", async () => {
  const { t, as, workspaceId } = await setup();
  const p = await as.mutation(ref("createProject"), {
    ...input,
    workspaceId,
    idempotencyKey: "aba-create",
  });
  const d = p.drafts[0];
  const original = await t.run((ctx) => ctx.db.get("videoDrafts", d.draftId));
  const a = await as.mutation(ref("patchScript"), {
    draftId: d.draftId,
    idempotencyKey: "aba-b",
    expectedRevision: d.scriptRevision,
    operations: [{ op: "replace", path: "/premise", value: "Different B" }],
  });
  const b = await as.mutation(ref("patchScript"), {
    draftId: d.draftId,
    idempotencyKey: "aba-a",
    expectedRevision: a.revisionId,
    operations: [{ op: "replace", path: "/premise", value: JSON.parse(original!.script).premise }],
  });
  expect(b.revisionId).not.toBe(d.scriptRevision);
  await expect(
    as.mutation(ref("patchScript"), {
      draftId: d.draftId,
      idempotencyKey: "aba-stale",
      expectedRevision: d.scriptRevision,
      operations: [{ op: "replace", path: "/premise", value: "Stale" }],
    }),
  ).rejects.toThrow("REVISION_CONFLICT");
  try {
    await as.mutation(ref("patchTimeline"), {
      draftId: d.draftId,
      idempotencyKey: "nested-invalid",
      expectedRevision: d.timelineRevision,
      operations: [
        {
          op: "add",
          path: "/tracksById/main",
          value: {
            kind: "visual",
            clipOrder: ["clip"],
            clipsById: {
              clip: {
                startFrame: 0,
                durationFrames: 1,
                source: { kind: "text", text: "Fixture", style: { fontSize: 1 } },
              },
            },
          },
        },
        { op: "replace", path: "/trackOrder", value: ["main"] },
      ],
    });
    throw new Error("Expected rejection");
  } catch (error) {
    expect(String(error)).toContain("VALIDATION_ERROR");
    expect(String(error)).toContain("/tracksById/main/clipsById/clip/source/style/fontSize");
  }
});
test("gateway authenticates token again and shares browser dedup domain", async () => {
  const { t, as, workspaceId, userId } = await setup();
  const tokenId = await t.run((ctx) =>
    ctx.db.insert("mcpTokens", {
      userId,
      name: "test",
      prefix: "test",
      tokenHash: "a".repeat(64),
      expiresAt: Date.now() + 60000,
    }),
  );
  process.env.AGENT_GATEWAY_SECRET = "video-test-secret";
  const call = async (name: string, args: unknown) => {
    const response = await t.fetch("/agent-gateway", {
      method: "POST",
      headers: { authorization: "Bearer video-test-secret", "content-type": "application/json" },
      body: JSON.stringify({ operation: "video", args: { tokenId, name, input: args } }),
    });
    return response.json();
  };
  try {
    const args = { ...input, workspaceId, idempotencyKey: "shared" };
    expect(
      await call("getOperation", {
        workspaceId: "video",
        tool: "createProject",
        idempotencyKey: "shared",
      }),
    ).toEqual({ result: { ok: true, data: { state: "unknown" } } });
    const created = await as.mutation(ref("createProject"), args);
    expect(await call("createProject", args)).toEqual({ result: { ok: true, data: created } });
    expect(
      await call("getOperation", {
        workspaceId: "video",
        tool: "createProject",
        idempotencyKey: "shared",
      }),
    ).toEqual({ result: { ok: true, data: { state: "applied", result: created } } });
    expect(await call("createProject", args)).toEqual({ result: { ok: true, data: created } });
    expect(await t.run((ctx) => ctx.db.query("videoProjects").collect())).toHaveLength(1);
    expect(
      await call("listProjects", {
        workspaceId: "video",
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).toMatchObject({
      result: { ok: true, data: { page: [{ projectId: created.projectId }], isDone: true } },
    });
    const slugArgs = { ...input, workspaceId: "video", idempotencyKey: "slug-create" };
    const slugCreated = await call("createProject", slugArgs);
    expect(slugCreated.result.ok).toBe(true);
    expect(await call("createProject", slugArgs)).toEqual(slugCreated);
    expect(await t.run((ctx) => ctx.db.query("videoProjects").collect())).toHaveLength(2);
    const conflict = await call("createProject", { ...args, title: "Changed" });
    expect(conflict.result.error.code).toBe("IDEMPOTENCY_CONFLICT");
    await t.run((ctx) => ctx.db.patch(tokenId, { revokedAt: Date.now() }));
    expect((await call("getProject", { projectId: created.projectId })).result.error.code).toBe(
      "NOT_FOUND_OR_FORBIDDEN",
    );
  } finally {
    delete process.env.AGENT_GATEWAY_SECRET;
  }
});
test("asset references cannot cross workspace and failed write is atomic", async () => {
  const { t, as, workspaceId, userId } = await setup();
  const p = await as.mutation(ref("createProject"), {
    ...input,
    workspaceId,
    idempotencyKey: "create",
  });
  const d = p.drafts[0];
  const asset = await t.run(async (ctx) => {
    const other = await ctx.db.insert("workspaces", {
      name: "Other",
      slug: "other",
      createdBy: userId,
    });
    const assetId = await ctx.db.insert("assets", {
      scope: "workspace",
      workspaceId: other,
      slug: "x",
      name: "x",
      tags: [],
      kind: "image",
      searchText: "x",
      createdBy: userId,
      updatedAt: 0,
    });
    const revisionId = await ctx.db.insert("assetVersions", {
      assetId,
      revision: 1,
      objectKey: "x",
      contentHash: "a".repeat(64),
      mimeType: "image/png",
      size: 10,
      originalFilename: "x.png",
      sourceType: "upload",
      createdBy: userId,
    });
    return { assetId, revisionId };
  });
  await expect(
    as.mutation(ref("patchTimeline"), {
      draftId: d.draftId,
      idempotencyKey: "cross",
      expectedRevision: d.timelineRevision,
      operations: [
        {
          op: "add",
          path: "/tracksById/main",
          value: {
            kind: "visual",
            clipOrder: ["clip"],
            clipsById: {
              clip: { startFrame: 0, durationFrames: 1, source: { kind: "asset", asset } },
            },
          },
        },
        { op: "replace", path: "/trackOrder", value: ["main"] },
      ],
    }),
  ).rejects.toThrow("NOT_FOUND_OR_FORBIDDEN");
  expect((await t.run((ctx) => ctx.db.get("videoDrafts", d.draftId)))?.timelineRevision).toBe(
    d.timelineRevision,
  );
});
test("durable dedup, CAS, independent lanes, immutable checkpoint", async () => {
  const { t, as, workspaceId } = await setup();
  const args = { ...input, workspaceId, idempotencyKey: "create" };
  const p = await as.mutation(ref("createProject"), args);
  expect(await as.mutation(ref("createProject"), args)).toEqual(p);
  await expect(as.mutation(ref("createProject"), { ...args, title: "Different" })).rejects.toThrow(
    "IDEMPOTENCY_CONFLICT",
  );
  const ru = p.drafts.find((d: { language: string }) => d.language === "ru"),
    uz = p.drafts.find((d: { language: string }) => d.language === "uz");
  const patch = {
    draftId: ru.draftId,
    idempotencyKey: "patch",
    expectedRevision: ru.scriptRevision,
    operations: [{ op: "replace", path: "/premise", value: "New premise" }],
  };
  const changed = await as.mutation(ref("patchScript"), patch);
  expect(changed.changed).toBe(true);
  expect(await as.mutation(ref("patchScript"), patch)).toEqual(changed);
  await expect(
    as.mutation(ref("patchScript"), { ...patch, idempotencyKey: "stale" }),
  ).rejects.toThrow("REVISION_CONFLICT");
  const before = await t.run((ctx) => ctx.db.get("videoDrafts", uz.draftId));
  expect(before?.scriptRevision).toBe(uz.scriptRevision);
  const cp = {
    draftId: ru.draftId,
    idempotencyKey: "checkpoint",
    expectedProjectRevision: p.revisionId,
    expectedScriptRevision: changed.revisionId,
    expectedTimelineRevision: ru.timelineRevision,
    label: "Candidate",
  };
  const version = await as.mutation(ref("checkpoint"), cp);
  expect(await as.mutation(ref("checkpoint"), cp)).toEqual(version);
  await as.mutation(ref("patchScript"), {
    ...patch,
    idempotencyKey: "next",
    expectedRevision: changed.revisionId,
    operations: [{ op: "replace", path: "/premise", value: "Next" }],
  });
  const snapshot = await t.run((ctx) => ctx.db.get("videoVersions", version.version.versionId));
  expect(JSON.parse(snapshot!.manifest).script.premise).toBe("New premise");
  expect(await t.run((ctx) => ctx.db.query("canvasVersions").take(1))).toEqual([]);
});
test("invalid atomic patch and immutable language leave draft unchanged", async () => {
  const { t, as, workspaceId } = await setup();
  const p = await as.mutation(ref("createProject"), {
    ...input,
    workspaceId,
    idempotencyKey: "create",
  });
  const d = p.drafts[0];
  for (const operations of [
    [
      { op: "replace", path: "/premise", value: "would change" },
      { op: "add", path: "/approved", value: true },
    ],
    [{ op: "replace", path: "/language", value: d.language === "ru" ? "uz" : "ru" }],
  ])
    await expect(
      as.mutation(ref("patchScript"), {
        draftId: d.draftId,
        idempotencyKey: "bad",
        expectedRevision: d.scriptRevision,
        operations,
      }),
    ).rejects.toThrow("VALIDATION_ERROR");
  expect((await t.run((ctx) => ctx.db.get("videoDrafts", d.draftId)))?.scriptRevision).toBe(
    d.scriptRevision,
  );
});
test("requires authenticated session and validates rational fps", async () => {
  const { t, as, workspaceId } = await setup();
  await expect(
    t.mutation(ref("createProject"), { ...input, workspaceId, idempotencyKey: "anon" }),
  ).rejects.toThrow("Not signed in");
  await expect(
    as.mutation(ref("createProject"), {
      ...input,
      workspaceId,
      idempotencyKey: "fps",
      format: { ...input.format, fps: { numerator: 60000, denominator: 1 } },
    }),
  ).rejects.toThrow("FPS");
});
const qref = (name: string) => makeFunctionReference<"query">(`video:${name}`);
test("renames a project and hard-deletes its drafts", async () => {
  const { t, as, workspaceId } = await setup();
  const created = await as.mutation(ref("createProject"), {
    ...input,
    workspaceId,
    idempotencyKey: "rename-delete",
  });
  const renamed = await as.mutation(ref("renameProject"), {
    projectId: created.projectId,
    title: "Renamed reel",
  });
  expect(renamed.title).toBe("Renamed reel");
  const listed = await as.query(qref("listProjects"), {
    workspaceId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(listed.page[0]?.title).toBe("Renamed reel");
  expect(listed.page[0]?.topic).toBe("Тест");
  expect(listed.page[0]?.languages).toEqual(["ru", "uz"]);
  await as.mutation(ref("deleteProject"), { projectId: created.projectId });
  const after = await as.query(qref("listProjects"), {
    workspaceId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(after.page).toEqual([]);
  await t.run(async (ctx) => {
    expect(await ctx.db.get("videoProjects", created.projectId)).toBeNull();
    const drafts = await ctx.db
      .query("videoDrafts")
      .withIndex("by_projectId_and_language", (q) => q.eq("projectId", created.projectId))
      .take(4);
    expect(drafts).toEqual([]);
  });
});
