import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalActionDefinition } from "@visual-canvas/video/character-action-library";
import { describe, expect, test, vi } from "vitest";
import { callVideoTool } from "../src/video/registry.js";

function localBackend() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    throw new Error("paid or persistent backend effect was not expected");
  };
  return { call, calls };
}
const data = (result: Awaited<ReturnType<typeof callVideoTool>>) =>
  result.structuredContent as { ok: boolean; data?: unknown; error?: { code: string } };

describe("character MCP authoring tools", () => {
  test("alignment reader accepts only authorized exact bytes and enforces hash, URL input, and size bounds", async () => {
    const artifact = {
      original: {
        characters: ["H", "i"],
        character_start_times_seconds: [0, 0.1],
        character_end_times_seconds: [0.1, 0.2],
      },
      normalized: null,
      language: "uz",
    };
    const body = JSON.stringify(artifact),
      sha256 = createHash("sha256").update(body).digest("hex");
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const inspect = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        url: "https://signed.example/alignment",
        sha256,
        mimeType: "application/json",
        sizeBytes: Buffer.byteLength(body),
      };
    };
    const fetcher = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetcher);
    try {
      const exact = await callVideoTool(
        "character_alignment_get",
        { workspace_id: "workspace", asset: { assetId: "alignment", revisionId: "1" }, sha256 },
        inspect,
      );
      expect(exact.isError).not.toBe(true);
      expect(data(exact).data).toEqual({
        asset: { assetId: "alignment", revisionId: "1" },
        sha256,
        artifact,
      });
      expect(calls).toEqual([
        {
          name: "inspectAsset",
          args: { workspaceId: "workspace", asset: { assetId: "alignment", revisionId: "1" } },
        },
      ]);
      const changed = await callVideoTool(
        "character_alignment_get",
        {
          workspace_id: "workspace",
          asset: { assetId: "alignment", revisionId: "1" },
          sha256: "0".repeat(64),
        },
        inspect,
      );
      expect(data(changed).error?.code).toBe("RESOURCE_CHANGED");
      expect(fetcher).toHaveBeenCalledTimes(1);
      const arbitrary = await callVideoTool(
        "character_alignment_get",
        {
          workspace_id: "workspace",
          asset: { assetId: "alignment", revisionId: "1" },
          sha256,
          url: "https://evil.example",
        },
        inspect,
      );
      expect(arbitrary.isError).toBe(true);
      expect(calls).toHaveLength(2);
      fetcher.mockImplementationOnce(
        async () => new Response(body.replace('"language":"uz"', '"language":"ru"')),
      );
      const corrupt = await callVideoTool(
        "character_alignment_get",
        { workspace_id: "workspace", asset: { assetId: "alignment", revisionId: "1" }, sha256 },
        inspect,
      );
      expect(data(corrupt).error?.code).toBe("RESOURCE_CHANGED");
      const oversized = await callVideoTool(
        "character_alignment_get",
        { workspace_id: "workspace", asset: { assetId: "alignment", revisionId: "1" }, sha256 },
        async () => ({
          url: "https://signed.example/alignment",
          sha256,
          mimeType: "application/json",
          sizeBytes: 2 * 1024 * 1024 + 1,
        }),
      );
      expect(oversized.isError).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  test("compiles inline and compound choreography locally without a paid or persistent effect", async () => {
    const { call, calls } = localBackend();
    const raw = {
      id: "reaction",
      label: "Reaction",
      content: {
        kind: "sequence" as const,
        durationSeconds: 1,
        actions: [
          { id: "look", atSeconds: 0, durationSeconds: 0.2, action: { type: "blink" } },
          { id: "settle", atSeconds: 0.5, durationSeconds: 0.2, action: { type: "blink" } },
        ],
      },
    };
    const revisionId = createHash("sha256").update(canonicalActionDefinition(raw)).digest("hex");
    const result = await callVideoTool(
      "character_choreography_compile",
      {
        timebase: { numerator: 30, denominator: 1 },
        definitions: [{ ...raw, revisionId }],
        steps: [
          {
            id: "beat",
            actorId: "Farq",
            placement: { kind: "at", seconds: 1 },
            holdSeconds: 0,
            action: { ref: { id: "reaction", revisionId } },
          },
        ],
      },
      call,
    );
    expect(result.isError).not.toBe(true);
    expect(data(result).data).toMatchObject({ actionOrder: ["beat-look", "beat-settle"] });
    const tampered = await callVideoTool(
      "character_choreography_compile",
      {
        timebase: { numerator: 30, denominator: 1 },
        definitions: [{ ...raw, label: "Changed without a new hash", revisionId }],
        steps: [],
      },
      call,
    );
    expect(data(tampered).error?.code).toBe("VALIDATION_ERROR");
    expect(calls).toHaveLength(0);
  });

  test("procedural bake is deterministic and rejects hostile or non-finite expressions locally", async () => {
    const { call, calls } = localBackend();
    const input = {
      source: '(t,ctx)=>({"root.x":noise(t,ctx)})',
      actorId: "Farq",
      startFrame: 0,
      durationFrames: 30,
      timebase: { numerator: 30, denominator: 1 },
      seed: 7,
    };
    const one = await callVideoTool("character_procedural_bake", input, call);
    const two = await callVideoTool("character_procedural_bake", input, call);
    expect(data(one).data).toEqual(data(two).data);
    for (const source of [
      '(t,ctx)=>({"root.x":fetch(t)})',
      '(t,ctx)=>({"root.x":Math.random()})',
      '(t,ctx)=>({"root.x":1/0})',
    ]) {
      const rejected = await callVideoTool("character_procedural_bake", { ...input, source }, call);
      expect(rejected.isError).toBe(true);
      expect(data(rejected).error?.code).toBe("VALIDATION_ERROR");
    }
    expect(calls).toHaveLength(0);
  });

  test("explicit revision-3 migration upgrades a genuine artifact and unknown revisions fail without dispatch", async () => {
    const props = JSON.parse(
      readFileSync(
        new URL("../../../packages/video/test/fixtures/character-scene-v3.json", import.meta.url),
        "utf8",
      ),
    );
    const { call, calls } = localBackend();
    const migrated = await callVideoTool("character_scene_migrate", { revision: "3", props }, call);
    expect(migrated.isError).not.toBe(true);
    expect(data(migrated).data).toMatchObject({
      revision: "4",
      props: {
        stage: { aspect: "9:16", width: 1080, height: 1920 },
        cameraSequence: [],
        effects: [],
      },
    });
    for (const revision of ["2", "4", "999"]) {
      const rejected = await callVideoTool("character_scene_migrate", { revision, props }, call);
      expect(rejected.isError).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });
});
