/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { sha256HexBytes } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Provider",
      email: "provider@iota.uz",
      lastSeenAt: 0,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      slug: "provider",
      name: "Provider",
      createdBy: userId,
    });
    return { userId, workspaceId };
  });
  for (const [key, value] of Object.entries({
    OPENAI_API_KEY: "fixture",
    WORKER_URL: "https://worker.example",
    WORKER_TOKEN: "fixture",
    S3_ASSET_ENDPOINT: "https://storage.example",
    S3_ASSET_BUCKET: "bucket",
    S3_ASSET_ACCESS_KEY_ID: "fixture",
    S3_ASSET_SECRET_ACCESS_KEY: "fixture",
  }))
    vi.stubEnv(key, value);
  const as = t.withIdentity({
    subject: `${ids.userId}|session`,
    issuer: "convex",
  });
  const receipt = await as.mutation(makeFunctionReference<"mutation">("videoJobs:submit"), {
    workspaceId: ids.workspaceId,
    idempotencyKey: "generation",
    request: {
      kind: "image",
      allowPaid: true,
      prompt: "fixture",
      model: "gpt-image-2.5-sunburst",
      size: "1152x2048",
      quality: "high",
    },
  });
  return { t, as, receipt };
}
test("image action registers only worker-verified persisted bytes, provenance survives job", async () => {
  const { t, as, receipt } = await setup();
  let posts = 0;
  const hash = await sha256HexBytes(new TextEncoder().encode("hi"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.openai.com")) {
        posts++;
        return Response.json({ data: [{ b64_json: "aGk=" }] });
      }
      if (url.includes("worker.example")) {
        expect(JSON.parse(String(init?.body)).expectedSha256).toBe(hash);
        return Response.json({
          kind: "image",
          mimeType: "image/png",
          sha256: hash,
          sizeBytes: 2,
        });
      }
      return new Response(null, { status: 200 });
    }),
  );
  await t.action(makeFunctionReference<"action">("videoProviders:run"), {
    jobId: receipt.jobId,
  });
  const job = await as.query(makeFunctionReference<"query">("videoJobs:getJob"), {
    jobId: receipt.jobId,
  });
  expect(job.state).toBe("succeeded");
  expect(posts).toBe(1);
  const asset = job.result.artifacts[0].asset;
  const revision = await t.run((ctx) => ctx.db.get(asset.revisionId as Id<"assetVersions">));
  expect(revision?.provenance?.actualModel).toBeNull();
  expect(revision?.provenance?.provider).toBe("openai");
  await t.action(makeFunctionReference<"action">("videoProviders:run"), {
    jobId: receipt.jobId,
  });
  expect(posts).toBe(1);
});
test("verification failure retains staged paid result and never claims ready", async () => {
  const { t, as, receipt } = await setup();
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.openai.com")) {
        posts++;
        return Response.json({ data: [{ b64_json: "aGk=" }] });
      }
      return new Response(null, {
        status: url.includes("worker.example") ? 422 : 200,
      });
    }),
  );
  await t.action(makeFunctionReference<"action">("videoProviders:run"), {
    jobId: receipt.jobId,
  });
  const job = await as.query(makeFunctionReference<"query">("videoJobs:getJob"), {
    jobId: receipt.jobId,
  });
  expect(job.state).toBe("failed");
  expect(job.error.effect).toBe("partial");
  expect(job.error.recovery.safeToRegenerate).toBe(false);
  const stored = await t.run((ctx) => ctx.db.get(receipt.jobId as Id<"videoJobs">));
  expect(stored?.persistenceReceipt?.state).toBe("persisted");
  expect(stored?.persistenceReceipt?.artifacts).toHaveLength(1);
  await t.run((ctx) =>
    ctx.db.patch(receipt.jobId as Id<"videoJobs">, {
      persistenceReceipt: stored?.persistenceReceipt
        ? { ...stored.persistenceReceipt, state: "source_unavailable" }
        : undefined,
    }),
  );
  const providerWithUnavailableSource = await as.query(
    makeFunctionReference<"query">("videoJobs:getJob"),
    { jobId: receipt.jobId },
  );
  expect(providerWithUnavailableSource.error.recovery.safeToRegenerate).toBe(false);
  expect(providerWithUnavailableSource.error.recovery.kind).not.toBe("regenerate");
  await t.run((ctx) =>
    ctx.db.patch(receipt.jobId as Id<"videoJobs">, {
      persistenceReceipt: stored?.persistenceReceipt,
    }),
  );
  expect((await t.run((ctx) => ctx.db.query("assets").collect())).length).toBe(0);
  expect(posts).toBe(1);
  const hash = await sha256HexBytes(new TextEncoder().encode("hi"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).not.toContain("openai.com");
      expect(url).not.toContain("video/render");
      return Response.json({
        kind: "image",
        mimeType: "image/png",
        sha256: hash,
        sizeBytes: 2,
        width: 200,
        height: 100,
        hasAlpha: true,
        alphaMin: 0,
        alphaMax: 255,
      });
    }),
  );
  const retry = await t.mutation(makeFunctionReference<"mutation">("videoRecovery:begin"), {
    jobId: receipt.jobId,
    principalId: stored!.principalId,
  });
  expect(retry.state).toBe("running");
  await t.action(makeFunctionReference<"action">("videoRecovery:run"), {
    jobId: receipt.jobId,
    fence: 2,
  });
  const recovered = await as.query(makeFunctionReference<"query">("videoJobs:getJob"), {
    jobId: receipt.jobId,
  });
  expect(recovered.state).toBe("succeeded");
  expect(recovered.result.artifacts).toHaveLength(1);
  const restored = await t.run((ctx) =>
    ctx.db.get(recovered.result.artifacts[0].asset.revisionId as Id<"assetVersions">),
  );
  expect(restored?.mediaMetadata?.width).toBe(200);
  expect(restored?.mediaMetadata?.height).toBe(100);
  expect(restored?.mediaMetadata?.alphaMin).toBe(0);
  expect(posts).toBe(1);
});
