/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { canonical } from "../packages/video/src/contracts";
import { sha256HexBytes } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const hash = (value: unknown) => sha256HexBytes(new TextEncoder().encode(canonical(value)));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("migration retains exact legacy rows and creates only unrendered native lane checkpoints; replay is resumable", async () => {
  const t = convexTest(schema, modules),
    sourceBackupSha256 = "b".repeat(64),
    sourceRunId = "legacy-run";
  const records = [
    {
      kind: "run",
      id: sourceRunId,
      data: JSON.stringify({
        id: sourceRunId,
        brand: "farq.uz",
        prompt: "Synthetic fixture, not a publication-ready advert",
        languages: ["ru", "uz"],
        latest: { ru: "legacy-ru", uz: "legacy-uz" },
        provenance: { identity: "fixture", verifiedIdentity: false },
      }),
    },
    { kind: "job", id: "old-job", data: '{"state":"running","provider":"fixture"}' },
    {
      kind: "feedback",
      id: "old-feedback",
      data: '{"provenance":{"identity":"fixture","verifiedIdentity":false},"text":"Historical feedback"}',
    },
  ];
  for (const language of ["ru", "uz"]) {
    const input = {
      runId: sourceRunId,
      language,
      baseVersionId: null,
      sceneIds: ["hook"],
      assetHashes: [],
      manifest: {
        scenario: {
          language,
          title: "Fixture",
          width: 360,
          height: 640,
          fps: 30,
          durationFrames: 60,
          scenes: [
            { id: "hook", startFrame: 0, endFrame: 60, script: "Fixture", title: "Fixture" },
          ],
          captions: [{ startFrame: 0, endFrame: 60, text: "Fixture" }],
        },
      },
    };
    records.push({
      kind: "version",
      id: `legacy-${language}`,
      data: JSON.stringify({
        ...input,
        id: `legacy-${language}`,
        hash: await hash(input),
        createdAt: "2026-09-09T00:00:00Z",
      }),
    });
  }
  const payload = { sourceBackupSha256, records },
    bytes = new TextEncoder().encode(JSON.stringify(payload)),
    archiveSha256 = await sha256HexBytes(bytes);
  const ids = await t.run(async (ctx) => {
    const principalId = await ctx.db.insert("users", {
      email: "migration@iota.uz",
      name: "Migration",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "migration",
      name: "Migration",
      createdBy: principalId,
    });
    const assetId = await ctx.db.insert("assets", {
      scope: "workspace",
      workspaceId,
      slug: "source-archive",
      name: "Archive",
      tags: [],
      kind: "data",
      searchText: "archive",
      createdBy: principalId,
      updatedAt: 0,
    });
    const revisionId = await ctx.db.insert("assetVersions", {
      assetId,
      revision: 1,
      objectKey: "archive",
      contentHash: archiveSha256,
      mimeType: "application/json",
      size: bytes.length,
      originalFilename: "archive.json",
      sourceType: "upload",
      createdBy: principalId,
    });
    return { principalId, workspaceId, archiveAsset: { assetId, revisionId } };
  });
  for (const [k, value] of Object.entries({
    S3_ASSET_ENDPOINT: "https://storage.example",
    S3_ASSET_BUCKET: "bucket",
    S3_ASSET_ACCESS_KEY_ID: "fixture",
    S3_ASSET_SECRET_ACCESS_KEY: "fixture",
  }))
    vi.stubEnv(k, value);
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input instanceof Request ? input.url : input)).toContain("storage.example");
      reads++;
      return new Response(bytes);
    }),
  );
  const args = { ...ids, sourceBackupSha256, sourceRunId, archiveSha256, assetMap: [] };
  const first = await t.action(makeFunctionReference<"action">("videoMigration:migrate"), args);
  const replay = await t.action(makeFunctionReference<"action">("videoMigration:migrate"), args);
  expect(replay).toEqual(first);
  expect(reads).toBe(2);
  expect(first.versions).toHaveLength(2);
  const saved = await t.run(async (ctx) => ({
    records: await ctx.db.query("videoLegacyRecords").collect(),
    jobs: await ctx.db.query("videoJobs").collect(),
    versions: await ctx.db.query("videoVersions").collect(),
    approvals: await ctx.db.query("videoApprovals").collect(),
    evidence: await ctx.db.query("videoWorkflowEvidence").collect(),
  }));
  expect(saved.records.map((r) => ({ kind: r.kind, id: r.sourceId, data: r.data }))).toEqual(
    records,
  );
  expect(saved.jobs).toHaveLength(0);
  expect(saved.approvals).toHaveLength(0);
  expect(saved.evidence).toHaveLength(0);
  expect(saved.versions).toHaveLength(2);
  expect(saved.versions.every((v) => v.label.includes("needs new render"))).toBe(true);
  await expect(
    t.action(makeFunctionReference<"action">("videoMigration:migrate"), {
      ...args,
      archiveSha256: "a".repeat(64),
    }),
  ).rejects.toThrow("Archive identity mismatch");
  await expect(
    t.query(makeFunctionReference<"query">("videoMigration:getArchive"), {
      projectId: first.projectId,
    }),
  ).rejects.toThrow("Not signed in");
});
