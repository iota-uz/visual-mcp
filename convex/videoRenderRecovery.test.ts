/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { canonical } from "../packages/video/src/contracts";
import { resolvedCritiquePolicy } from "../packages/video/src/jobs";
import { sha256HexBytes } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const mutation = (name: string) => makeFunctionReference<"mutation">(name);
const action = (name: string) => makeFunctionReference<"action">(name);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("render persistence failure preserves the worker receipt and can recover reserved-only bytes without rerender", async () => {
  const t = convexTest(schema, modules);
  const { userId, workspaceId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "recovery@iota.uz",
      name: "Recovery",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "recovery",
      name: "Recovery",
      createdBy: userId,
    });
    return { userId, workspaceId };
  });
  const as = t.withIdentity({ subject: `${userId}|session`, issuer: "convex" });
  const p = await as.mutation(mutation("video:createProject"), {
    workspaceId,
    idempotencyKey: "project",
    title: "Recovery",
    brief: { topic: "fixture", direction: "fixture" },
    languages: ["ru"],
    format: {
      width: 1080,
      height: 1920,
      fps: { numerator: 30, denominator: 1 },
    },
  });
  const d = p.drafts[0];
  const cp = await as.mutation(mutation("video:checkpoint"), {
    draftId: d.draftId,
    idempotencyKey: "version",
    expectedProjectRevision: p.revisionId,
    expectedScriptRevision: d.scriptRevision,
    expectedTimelineRevision: d.timelineRevision,
    label: "Fixture",
  });
  const { version: policyVersion, ...rubricPolicy } = resolvedCritiquePolicy({
    rubric: "Exact technical fixture",
  });
  const rubricHash = await sha256HexBytes(
    new TextEncoder().encode(
      canonical({ version: policyVersion, ...rubricPolicy }),
    ),
  );
  const accepted = await as.mutation(mutation("videoJobs:submit"), {
    workspaceId,
    projectId: p.projectId,
    versionId: cp.version.versionId,
    idempotencyKey: "render",
    request: {
      kind: "render",
      versionId: cp.version.versionId,
      mode: "final",
      rubricPolicy,
      rubricHash,
    },
  });
  for (const [k, value] of Object.entries({
    WORKER_URL: "https://worker.example",
    WORKER_TOKEN: "fixture",
    S3_ASSET_ENDPOINT: "https://storage.example",
    S3_ASSET_BUCKET: "bucket",
    S3_ASSET_ACCESS_KEY_ID: "fixture",
    S3_ASSET_SECRET_ACCESS_KEY: "fixture",
  }))
    vi.stubEnv(k, value);
  const result = {
    jobId: accepted.jobId,
    fence: 1,
    video: {
      sha256: "a".repeat(64),
      sizeBytes: 1,
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      durationMs: 2000,
      fps: { numerator: 30, denominator: 1 },
    },
    poster: {
      sha256: "b".repeat(64),
      sizeBytes: 2,
      mimeType: "image/png",
      width: 1080,
      height: 1920,
    },
    captions: { sha256: "c".repeat(64), sizeBytes: 3, mimeType: "text/vtt" },
    partial: false,
    checks: [
      "dimensions_frames_duration_fps",
      "source_integrity",
      "audio_presence",
      "font_mapping",
    ].map((name) => ({ name, outcome: "pass" })),
  };
  let renderPosts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/video/render")) {
        renderPosts++;
        return Response.json(
          {
            error: {
              code: "RESULT_PERSISTENCE_FAILED",
              reasonCode: "RESULT_UPLOAD_FAILED",
              message:
                "Rendered bytes exist but persistence could not be confirmed",
              effect: "partial",
              result,
              persisted: ["video"],
            },
          },
          { status: 500 },
        );
      }
      return new Response(null, { status: 404 });
    }),
  );
  await t.action(action("videoRender:run"), { jobId: accepted.jobId });
  const failed = await t.run((ctx) => ctx.db.get("videoJobs", accepted.jobId));
  expect(failed?.state).not.toBe("succeeded");
  expect(failed?.errorReasonCode).toBe("RESULT_UPLOAD_FAILED");
  expect(failed?.persistenceReceipt?.state).toBe("partially_persisted");
  expect(failed?.persistenceReceipt?.result).toBeTruthy();
  if (!failed?.persistenceReceipt)
    throw new Error("Expected retained render receipt");
  const storedReceipt = failed.persistenceReceipt;
  await t.run((ctx) =>
    ctx.db.patch("videoJobs", accepted.jobId, {
      persistenceReceipt: {
        state: "partially_persisted",
        kind: "render",
        artifacts: storedReceipt.artifacts,
      },
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).not.toContain("/video/render");
      expect(url).not.toContain("openai.com");
      if (url.includes("/media/verify")) {
        const request = JSON.parse(String(init?.body));
        const recovered =
          request.declaredMimeType === "video/mp4"
            ? { sha256: "a".repeat(64), sizeBytes: 1 }
            : request.declaredMimeType === "image/png"
              ? { sha256: "b".repeat(64), sizeBytes: 2 }
              : { sha256: "c".repeat(64), sizeBytes: 3 };
        return Response.json({
          sha256: request.expectedSha256 ?? recovered.sha256,
          sizeBytes: request.expectedSize ?? recovered.sizeBytes,
          mimeType: request.declaredMimeType,
          kind:
            request.declaredMimeType === "video/mp4"
              ? "video"
              : request.declaredMimeType === "image/png"
                ? "image"
                : "data",
          ...(request.declaredMimeType !== "text/vtt"
            ? { width: 1080, height: 1920 }
            : {}),
          ...(request.declaredMimeType === "video/mp4"
            ? {
                durationMs: 30000,
                frameCount: 900,
                fps: "30/1",
                hasAudio: false,
              }
            : {}),
        });
      }
      return new Response(null, { status: 200 });
    }),
  );
  await t.mutation(mutation("videoRecovery:begin"), {
    jobId: accepted.jobId,
    principalId: userId,
  });
  await t.action(action("videoRecovery:run"), {
    jobId: accepted.jobId,
    fence: 2,
  });
  const ready = await t.run((ctx) => ctx.db.get("videoJobs", accepted.jobId));
  expect(ready?.state).toBe("succeeded");
  if (!ready?.result) throw new Error("Expected recovered render result");
  const saved = JSON.parse(ready.result);
  expect(saved.evidenceId).toBeTruthy();
  expect(saved.sha256).toBe(result.video.sha256);
  expect(renderPosts).toBe(1);
  const asset = await t.run((ctx) =>
    ctx.db.get("assetVersions", saved.video.revisionId),
  );
  expect(asset?.mediaMetadata?.width).toBe(1080);
  expect(asset?.mediaMetadata?.frameCount).toBe(900);
  const evidence = await t.run((ctx) =>
    ctx.db.get("videoWorkflowEvidence", saved.evidenceId),
  );
  if (!evidence) throw new Error("Expected recovered render evidence");
  const measurement = JSON.parse(evidence.content);
  expect(measurement.outcome).toBe("uncertain");
  expect(measurement.artifactSha256).toBe(result.video.sha256);

  const unavailable = await as.mutation(mutation("videoJobs:submit"), {
    workspaceId,
    projectId: p.projectId,
    versionId: cp.version.versionId,
    idempotencyKey: "render-unavailable",
    request: {
      kind: "render",
      versionId: cp.version.versionId,
      mode: "final",
      rubricPolicy,
      rubricHash,
    },
  });
  await t.run(async (ctx) => {
    const keys = {
      video: `video-results/${unavailable.jobId}/1/video`,
      poster: `video-results/${unavailable.jobId}/1/poster`,
      captions: `video-results/${unavailable.jobId}/1/captions`,
    };
    await ctx.db.patch("videoJobs", unavailable.jobId, {
      state: "failed",
      stage: "persisting",
      errorCode: "RESULT_PERSISTENCE_FAILED",
      errorEffect: "partial",
      persistenceReceipt: {
        state: "partially_persisted",
        kind: "render",
        artifacts: Object.entries(keys).map(([role, objectKey]) => ({
          role,
          objectKey,
        })),
      },
    });
    for (const [name, objectKey] of Object.entries(keys))
      await ctx.db.insert("assetObjectLeases", {
        objectKey,
        leaseId: `${unavailable.jobId}:1:${name}`,
        createdAt: Date.now(),
      });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 422 })),
  );
  vi.stubEnv("WORKER_URL", "https://worker.example");
  vi.stubEnv("WORKER_TOKEN", "fixture");
  await t.mutation(mutation("videoRecovery:begin"), {
    jobId: unavailable.jobId,
    principalId: userId,
  });
  const recovering = await t.run((ctx) =>
    ctx.db.get("videoJobs", unavailable.jobId),
  );
  if (!recovering) throw new Error("Expected render recovery job");
  await t.action(action("videoRecovery:run"), {
    jobId: unavailable.jobId,
    fence: recovering.fence,
  });

  const unavailableStored = await t.run((ctx) =>
    ctx.db.get("videoJobs", unavailable.jobId),
  );
  expect(unavailableStored?.state).toBe("failed");
  expect(unavailableStored?.stage).toBe("recovery_source_unavailable");
  expect(unavailableStored?.errorReasonCode).toBe("STORED_OUTPUT_UNAVAILABLE");
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("assetObjectLeases")
        .filter((q) =>
          q.eq(
            q.field("objectKey"),
            `video-results/${unavailable.jobId}/1/video`,
          ),
        )
        .collect(),
    ),
  ).toHaveLength(0);
  const unavailablePublic = await as.query(
    makeFunctionReference<"query">("videoJobs:getJob"),
    {
      jobId: unavailable.jobId,
    },
  );
  expect(unavailablePublic.error?.recovery).toEqual({
    kind: "regenerate",
    safeToRegenerate: true,
  });
  expect(unavailablePublic.error?.reasonCode).toBe("STORED_OUTPUT_UNAVAILABLE");

  if (!unavailableStored) throw new Error("Expected unavailable render job");
  const notAppliedObjectKey = `video-results/${unavailable.jobId}/${unavailableStored.fence}/video`;
  await t.run(async (ctx) => {
    await ctx.db.patch("videoJobs", unavailable.jobId, {
      state: "running",
      stage: "unrelated_progress_label",
      persistenceReceipt: {
        state: "reserved",
        kind: "render",
        artifacts: [{ role: "video", objectKey: notAppliedObjectKey }],
      },
    });
    await ctx.db.insert("assetObjectLeases", {
      objectKey: notAppliedObjectKey,
      leaseId: `${unavailable.jobId}:${unavailableStored.fence}:video`,
      createdAt: Date.now(),
    });
  });
  await t.mutation(mutation("videoJobs:fail"), {
    jobId: unavailable.jobId,
    fence: unavailableStored.fence,
    code: "RENDER_FAILED",
    reasonCode: "SOURCE_TRIM_EXCEEDED",
    outcomeUnknown: false,
    effect: "not_applied",
  });
  const notAppliedPublic = await as.query(
    makeFunctionReference<"query">("videoJobs:getJob"),
    {
      jobId: unavailable.jobId,
    },
  );
  expect(notAppliedPublic.error?.recovery).toEqual({
    kind: "regenerate",
    safeToRegenerate: true,
  });
  expect(notAppliedPublic.error?.reasonCode).toBe("SOURCE_TRIM_EXCEEDED");
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("assetObjectLeases")
        .withIndex("by_objectKey", (q) =>
          q.eq("objectKey", notAppliedObjectKey),
        )
        .collect(),
    ),
  ).toHaveLength(0);

  const mediaCleanup = await t.run(async (ctx) => {
    const jobId = await ctx.db.insert("videoJobs", {
      workspaceId,
      principalId: userId,
      idempotencyKey: "media-not-applied",
      operationId: "media-not-applied-operation",
      attemptNumber: 1,
      inputHash: "media-not-applied",
      request: JSON.stringify({
        kind: "media",
        asset: { assetId: "asset", revisionId: "revision" },
        operation: { kind: "qa" },
      }),
      kind: "media",
      state: "running",
      fence: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stage: "outputs_reserved",
      persistenceReceipt: {
        state: "reserved",
        kind: "media",
        artifacts: [],
      },
    });
    const objectKey = `video-results/${jobId}/1/qa-report`;
    await ctx.db.patch(jobId, {
      persistenceReceipt: {
        state: "reserved",
        kind: "media",
        artifacts: [{ role: "report", objectKey }],
      },
    });
    await ctx.db.insert("assetObjectLeases", {
      objectKey,
      leaseId: `${jobId}:1:qa:report`,
      createdAt: Date.now(),
    });
    return { jobId, objectKey };
  });
  await t.mutation(mutation("videoJobs:fail"), {
    jobId: mediaCleanup.jobId,
    fence: 1,
    code: "MEDIA_PROCESS_FAILED",
    outcomeUnknown: false,
    effect: "not_applied",
  });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("assetObjectLeases")
        .withIndex("by_objectKey", (q) =>
          q.eq("objectKey", mediaCleanup.objectKey),
        )
        .collect(),
    ),
  ).toHaveLength(0);
});
