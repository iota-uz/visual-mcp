import { getFunctionName } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("./lib/objectStore", () => ({
  presignObject: vi.fn(
    async (key: string, method: string) =>
      `https://objects.example/${method.toLowerCase()}/${encodeURIComponent(key)}`,
  ),
  headObject: vi.fn(async (key: string) => ({
    ok: true,
    headers: new Headers({ "content-length": key.endsWith("-waveform") ? "123" : "45" }),
  })),
}));

vi.mock("./lib/worker", () => ({
  getWorkerConfig: () => ({ url: "https://worker.example", token: "worker-token" }),
}));

import { processMedia } from "./lib/videoProcessing";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("processMedia signs both waveform outputs and registers the worker result", async () => {
  const mutations: { name: string; args: Record<string, unknown> }[] = [];
  const ctx = {
    runQuery: vi.fn(async () => ({
      objectKey: "assets/source.wav",
      contentHash: "a".repeat(64),
      size: 2048,
      mimeType: "audio/wav",
    })),
    runMutation: vi.fn(
      async (reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
        const name = getFunctionName(reference);
        mutations.push({ name, args });
        if (name === "assets:commitAssetVersion")
          return { assetId: `saved-${String(args.originalFilename)}`, versionId: "revision-1" };
        return null;
      },
    ),
  };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    expect(Object.keys(request.outputs).sort()).toEqual(["report", "waveform"]);
    expect(request.inputs[0]).toMatchObject({
      asset: { assetId: "audio", revisionId: "source-revision" },
      sha256: "a".repeat(64),
      mimeType: "audio/wav",
    });
    return new Response(
      JSON.stringify({
        jobId: "job-1",
        fence: 7,
        kind: "waveform",
        source: { assetId: "audio", revisionId: "source-revision" },
        sourceSha256: "a".repeat(64),
        sources: [
          {
            asset: { assetId: "audio", revisionId: "source-revision" },
            sha256: "a".repeat(64),
          },
        ],
        outputs: [
          {
            name: "waveform",
            sha256: "b".repeat(64),
            sizeBytes: 123,
            mimeType: "image/png",
            width: 640,
            height: 160,
            durationMs: 1000,
          },
          {
            name: "report",
            sha256: "c".repeat(64),
            sizeBytes: 45,
            mimeType: "application/json",
            durationMs: 1000,
          },
        ],
        checks: [{ name: "audio_decode", outcome: "pass" }],
        sampling: {
          mode: "waveform",
          range: { startMs: 250, endMs: 1250 },
          limitation: "Decoded amplitude overview only.",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  process.env.WORKER_URL = "https://worker.example";
  process.env.WORKER_TOKEN = "worker-token";

  const result = await processMedia(
    ctx as never,
    {
      _id: "job-1" as never,
      fence: 7,
      principalId: "user-1" as never,
      workspaceId: "workspace-1" as never,
    },
    { assetId: "audio", revisionId: "source-revision" },
    {
      kind: "waveform",
      startMs: 250,
      durationMs: 1000,
      width: 640,
      height: 160,
      channel: "mixed",
    },
  );

  expect(result.outputs.map((output) => output.name)).toEqual(["waveform", "report"]);
  expect(
    mutations
      .filter((mutation) => mutation.name === "assets:acquireObjectLease")
      .map((mutation) => String(mutation.args.objectKey)),
  ).toEqual(["video-results/job-1/7/waveform-waveform", "video-results/job-1/7/waveform-report"]);
  expect(
    mutations
      .filter((mutation) => mutation.name === "assets:commitAssetVersion")
      .map((mutation) => mutation.args.kind),
  ).toEqual(["image", "data"]);
});
