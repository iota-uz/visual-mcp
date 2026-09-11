/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { canonical } from "../packages/video/src/contracts";
import { sha256HexBytes } from "./lib/hash";
import {
  MAX_CRITIQUE_REPORT_BYTES,
  MAX_CRITIQUE_SUMMARY_BYTES,
  utf8Prefix,
} from "./lib/videoCritiqueLimits";
import { Critique } from "./lib/videoProviderAdapters";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts"),
  m = (name: string) => makeFunctionReference<"mutation">(name),
  a = (name: string) => makeFunctionReference<"action">(name);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("valid >4MiB CJK report reconciles unchanged bytes into bounded UTF8 summary, never regenerates", async () => {
  const t = convexTest(schema, modules),
    text = "漢".repeat(4000),
    sourceHash = "a".repeat(64);
  const ids = await t.run(async (ctx) => {
    const principalId = await ctx.db.insert("users", {
      email: "critique@iota.uz",
      name: "Critique",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Critique",
      slug: "critique",
      createdBy: principalId,
    });
    const assetId = await ctx.db.insert("assets", {
      scope: "workspace",
      workspaceId,
      slug: "source",
      name: "Source",
      tags: [],
      kind: "video",
      searchText: "source",
      createdBy: principalId,
      updatedAt: 0,
    });
    const revisionId = await ctx.db.insert("assetVersions", {
      assetId,
      revision: 1,
      objectKey: "source",
      contentHash: sourceHash,
      mimeType: "video/mp4",
      size: 2,
      originalFilename: "source.mp4",
      sourceType: "upload",
      createdBy: principalId,
    });
    return { principalId, workspaceId, asset: { assetId, revisionId } };
  });
  const report = Critique.parse({
    findings: Array.from({ length: 100 }, () => ({
      startMs: 0,
      endMs: 1000,
      severity: "note",
      observation: text,
      suggestedChange: text,
      confidence: null,
    })),
    limitations: Array(100).fill(text),
    audioEvaluated: false,
    assessments: Array.from({ length: 30 }, (_, i) => ({
      criterionId: `criterion-${i}`,
      outcome: "inconclusive",
      observation: text,
    })),
    blockingUncertainty: Array(30).fill(text),
    coverageComplete: false,
  });
  const metadata = {
    provider: "gemini",
    requestedModel: "gemini-fixture",
    actualModel: null,
    requestId: null,
    originalVideoSha256: sourceHash,
    videoSha256: sourceHash,
    durationMs: 1000,
    criteria: Array.from({ length: 30 }, (_, i) => ({
      id: `criterion-${i}`,
      description: "Fixture",
    })),
    blockingUncertainty: report.blockingUncertainty,
    outcome: "uncertain",
  };
  const bytes = new TextEncoder().encode(
      JSON.stringify({ report, metadata, outcome: "uncertain" }),
    ),
    sha256 = await sha256HexBytes(bytes);
  expect(bytes.length).toBeGreaterThan(4 * 1024 * 1024);
  expect(bytes.length).toBeLessThan(MAX_CRITIQUE_REPORT_BYTES);
  const as = t.withIdentity({ subject: `${ids.principalId}|session`, issuer: "convex" });
  const accepted = await as.mutation(m("videoJobs:submit"), {
    workspaceId: ids.workspaceId,
    idempotencyKey: "critique",
    request: {
      kind: "critique",
      allowPaid: true,
      asset: ids.asset,
      modelId: "gemini-fixture",
      brief: "Fixture",
      rubric: "Fixture",
      samplingFps: 1,
      criteria: metadata.criteria,
    },
  });
  await t.mutation(m("videoJobs:claim"), { jobId: accepted.jobId });
  await t.mutation(m("videoJobs:markDispatch"), { jobId: accepted.jobId, fence: 1 });
  // Start at the documented durable-persistence failure boundary, retaining the
  // original completed report; the recovery path itself may only GET these bytes.
  await t.mutation(m("videoJobs:savePersistenceReceipt"), {
    jobId: accepted.jobId,
    fence: 1,
    receipt: {
      state: "persisted",
      kind: "critique",
      artifacts: [
        {
          role: "critique",
          objectKey: `video-results/${accepted.jobId}/1/critique`,
          sha256,
          sizeBytes: bytes.length,
          mimeType: "application/json",
        },
      ],
      persistedRoles: ["critique"],
    },
  });
  await t.mutation(m("videoJobs:fail"), {
    jobId: accepted.jobId,
    fence: 1,
    code: "RESULT_PERSISTENCE_FAILED",
    effect: "partial",
    outcomeUnknown: false,
  });
  for (const [key, value] of Object.entries({
    S3_ASSET_ENDPOINT: "https://storage.example",
    S3_ASSET_BUCKET: "bucket",
    S3_ASSET_ACCESS_KEY_ID: "fixture",
    S3_ASSET_SECRET_ACCESS_KEY: "fixture",
  }))
    vi.stubEnv(key, value);
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).toContain("storage.example");
      expect(url).not.toContain("googleapis");
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (method === "HEAD")
        return new Response(null, { headers: { "content-length": String(bytes.length) } });
      expect(method).toBe("GET");
      reads++;
      return new Response(bytes);
    }),
  );
  await t.mutation(m("videoRecovery:begin"), {
    jobId: accepted.jobId,
    principalId: ids.principalId,
  });
  await t.action(a("videoRecovery:run"), { jobId: accepted.jobId, fence: 2 });
  const job = await t.run((ctx) => ctx.db.get("videoJobs", accepted.jobId));
  expect(job?.state).toBe("succeeded");
  const result = JSON.parse(job!.result!);
  expect(new TextEncoder().encode(canonical(result)).length).toBeLessThan(
    MAX_CRITIQUE_SUMMARY_BYTES,
  );
  expect(result.reportSha256).toBe(sha256);
  expect(result.metadata.findingCount).toBe(100);
  expect(result.metadata.findingsSummaryOnly).toBe(true);
  expect(reads).toBe(1);
  const stored = await t.run((ctx) => ctx.db.get("assetVersions", result.report.revisionId));
  expect(stored?.size).toBe(bytes.length);
  expect(stored?.contentHash).toBe(sha256);
  expect(await sha256HexBytes(bytes)).toBe(sha256);
  expect(new TextEncoder().encode(utf8Prefix("😀".repeat(100), 31)).length).toBeLessThanOrEqual(31);
});
