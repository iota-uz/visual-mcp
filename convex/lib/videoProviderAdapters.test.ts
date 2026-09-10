import { expect, test } from "vitest";
import { JobRequest } from "../../packages/video/src/jobs";
import {
  critique,
  generateImage,
  generateVoice,
  ProviderFailure,
  pollShot,
  submitShot,
} from "./videoProviderAdapters";

test("image memory envelope rejects oversized batches before dispatch while count4 remains available", () => {
  const base = {
    kind: "image",
    allowPaid: true,
    prompt: "Fixture",
    model: "gpt-image-2.5-sunburst",
    quality: "high",
    count: 4,
  };
  expect(JobRequest.safeParse({ ...base, size: "1152x2048" }).success).toBe(false);
  expect(JobRequest.safeParse({ ...base, size: "1024x1024" }).success).toBe(true);
  expect(JobRequest.safeParse({ ...base, count: 1, size: "2880x2880" }).success).toBe(true);
});
const image: Extract<JobRequest, { kind: "image" }> = {
  kind: "image",
  allowPaid: true,
  prompt: "Test",
  model: "gpt-image-2.5-sunburst",
  quality: "high",
  size: "1024x1024",
  references: [],
  count: 1,
  outputFormat: "png",
  background: "auto",
  referenceInstructions: [],
};
test("required missing alignment preserves paid audio as partial artifact", async () => {
  const result = await generateVoice(
    {
      kind: "voice",
      allowPaid: true,
      text: "Hi",
      language: "uz",
      voiceId: "voice",
      modelId: "eleven_v3",
      alignment: "required",
    },
    "fixture",
    async () => Response.json({ audio_base64: "aGk=", alignment: null }),
  );
  expect(result.artifacts[0]!.role).toBe("voice");
  expect(result.metadata.partial).toBe(true);
  expect(result.metadata.alignmentStatus).toBe("unavailable");
});
test("OpenAI sends chosen exact model once; unknown timeout never retries", async () => {
  let calls = 0;
  const transport: typeof fetch = async (_url, init) => {
    calls++;
    expect(JSON.parse(String(init?.body)).model).toBe("gpt-image-2.5-sunburst");
    throw new Error("connection reset secret=should-not-escape");
  };
  try {
    await generateImage(image, "fixture-key", [], transport);
    throw new Error("Expected failure");
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderFailure);
    expect((e as ProviderFailure).effect).toBe("unknown");
    expect((e as Error).message).not.toContain("secret");
  }
  expect(calls).toBe(1);
});
test("provider success returns bytes but no invented actual model or ready asset", async () => {
  const result = await generateImage(image, "fixture-key", [], async () =>
    Response.json({ data: [{ b64_json: "aGk=" }] }),
  );
  expect(new TextDecoder().decode(result.artifacts[0]!.bytes)).toBe("hi");
  expect(result.metadata.actualModel).toBeNull();
  expect(result).not.toHaveProperty("assetId");
});
test("ElevenLabs multilingual_v2 omits unsupported language_code and returns alignment", async () => {
  const result = await generateVoice(
    {
      kind: "voice",
      allowPaid: true,
      text: "Hi",
      language: "uz",
      voiceId: "voice",
      modelId: "eleven_multilingual_v2",
      alignment: "required",
    },
    "fixture",
    async (_url, init) => {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("language_code");
      return Response.json({
        audio_base64: "aGk=",
        alignment: {
          characters: ["H", "i"],
          character_start_times_seconds: [0, 0.1],
          character_end_times_seconds: [0.1, 0.2],
        },
      });
    },
  );
  expect(result.artifacts).toHaveLength(2);
  expect(result.metadata.languageQuality).toBe("not_human_verified");
});
test("Higgsfield verified schema and status receipt preserve async identity", async () => {
  const shot: Extract<JobRequest, { kind: "shot" }> = {
    kind: "shot",
    allowPaid: true,
    draftId: "d",
    scriptRevision: "r",
    sceneId: "s",
    shotId: "shot",
    startImage: { assetId: "a", revisionId: "r" },
    profileId: "higgsfield-kling-v2.5-turbo-pro",
    prompt: "Move",
    durationMs: 5000,
  };
  const result = await submitShot(
    shot,
    "https://storage.example/input",
    "id",
    "secret",
    async (url, init) => {
      expect(String(url)).toBe(
        "https://api.higgsfield.ai/kling-video/v2.5-turbo/pro/image-to-video",
      );
      expect(JSON.parse(String(init?.body)).duration).toBe(5);
      return Response.json({
        request_id: "request",
        status: "queued",
        status_url: "https://api.higgsfield.ai/requests/request/status",
        cancel_url: "https://api.higgsfield.ai/requests/request/cancel",
      });
    },
  );
  expect(result.request_id).toBe("request");
  await expect(
    pollShot("https://evil.example/requests/r/status", "id", "key", async () => {
      throw new Error("must not call");
    }),
  ).rejects.toThrow("PROVIDER_RECEIPT_INVALID");
});
test("Gemini rejects large video before any paid request", async () => {
  await expect(
    critique(
      {
        kind: "critique",
        allowPaid: true,
        asset: { assetId: "a", revisionId: "r" },
        modelId: "gemini-test",
        brief: "brief",
        rubric: "rubric",
        samplingFps: 1,
      },
      {
        bytes: new Uint8Array(12 * 1024 * 1024 + 1),
        durationMs: 1000,
        hasAudio: true,
        sha256: "a".repeat(64),
      },
      "fixture",
      ["gemini-test"],
      async () => {
        throw new Error("must not dispatch");
      },
    ),
  ).rejects.toThrow("ANALYSIS_PROXY_REQUIRED");
});
test("explicit observed criterion pass is eligible, missing coverage remains uncertain", async () => {
  const input: Extract<JobRequest, { kind: "critique" }> = {
    kind: "critique",
    allowPaid: true,
    asset: { assetId: "a", revisionId: "r" },
    modelId: "gemini-test",
    brief: "brief",
    rubric: "Title readable",
    samplingFps: 1,
  };
  const video = {
    bytes: new Uint8Array([1]),
    durationMs: 1000,
    hasAudio: false,
    sha256: "a".repeat(64),
  };
  const report = {
    findings: [],
    limitations: ["Model evaluation is sampled"],
    audioEvaluated: false,
    assessments: [
      {
        criterionId: "rubric",
        outcome: "pass",
        observation: "Title stays fully visible and legible throughout the supplied second",
      },
    ],
    blockingUncertainty: [],
    coverageComplete: true,
  };
  const run = (r: unknown) =>
    critique(input, video, "fixture", ["gemini-test"], async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(r) }] } }],
        modelVersion: "gemini-test-revision",
      }),
    );
  expect((await run(report)).metadata.outcome).toBe("pass");
  const incomplete = await run({ ...report, coverageComplete: false });
  expect(incomplete.metadata.outcome).toBe("uncertain");
  expect(incomplete.metadata.blockingUncertainty).toEqual(["Required video coverage incomplete"]);
});
