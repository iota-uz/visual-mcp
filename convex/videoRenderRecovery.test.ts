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
    format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
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
    new TextEncoder().encode(canonical({ version: policyVersion, ...rubricPolicy })),
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
              message: "Rendered bytes exist but persistence could not be confirmed",
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
  expect(failed?.persistenceReceipt).toContain("result");
  if (!failed?.persistenceReceipt) throw new Error("Expected retained render receipt");
  const storedReceipt = JSON.parse(failed.persistenceReceipt);
  await t.run((ctx) =>
    ctx.db.patch("videoJobs", accepted.jobId, {
      persistenceReceipt: JSON.stringify({ kind: "render", keys: storedReceipt.keys }),
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
          ...(request.declaredMimeType !== "text/vtt" ? { width: 1080, height: 1920 } : {}),
          ...(request.declaredMimeType === "video/mp4"
            ? { durationMs: 30000, frameCount: 900, fps: "30/1", hasAudio: false }
            : {}),
        });
      }
      return new Response(null, { status: 200 });
    }),
  );
  await t.mutation(mutation("videoRecovery:begin"), { jobId: accepted.jobId, principalId: userId });
  await t.action(action("videoRecovery:run"), { jobId: accepted.jobId, fence: 2 });
  const ready = await t.run((ctx) => ctx.db.get("videoJobs", accepted.jobId));
  expect(ready?.state).toBe("succeeded");
  if (!ready?.result) throw new Error("Expected recovered render result");
  const saved = JSON.parse(ready.result);
  expect(saved.evidenceId).toBeTruthy();
  expect(saved.sha256).toBe(result.video.sha256);
  expect(renderPosts).toBe(1);
  const asset = await t.run((ctx) => ctx.db.get("assetVersions", saved.video.revisionId));
  expect(asset?.mediaMetadata?.width).toBe(1080);
  expect(asset?.mediaMetadata?.frameCount).toBe(900);
  const evidence = await t.run((ctx) => ctx.db.get("videoWorkflowEvidence", saved.evidenceId));
  if (!evidence) throw new Error("Expected recovered render evidence");
  const measurement = JSON.parse(evidence.content);
  expect(measurement.outcome).toBe("uncertain");
  expect(measurement.artifactSha256).toBe(result.video.sha256);
});
