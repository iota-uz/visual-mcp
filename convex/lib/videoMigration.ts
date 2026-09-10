import { z } from "zod";
import { AssetRef, Format, Script, Timeline } from "../../packages/video/src/contracts";
export const migrationWarning =
  "Imported editable approximation, not a byte-equivalent render. Original fonts, layout, author components and historical reviews are retained in the archive only. Render and review this new native checkpoint before approval. Historical jobs and observations are not trusted evidence or live work.";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ArchiveRecord = z
  .object({
    kind: z.string().min(1).max(64),
    id: z.string().min(1).max(200),
    data: z.string().max(262144),
  })
  .strict();
export const AssetMapping = z
  .object({
    sha256: hash,
    sizeBytes: z.number().int().positive(),
    mimeType: z.string(),
    asset: AssetRef,
  })
  .strict();
const Scenario = z.object({
  language: z.enum(["ru", "uz"]),
  title: z.string(),
  width: z.number(),
  height: z.number(),
  fps: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
  mixHash: hash.optional(),
  musicHash: hash.optional(),
  audioHash: hash.optional(),
  scenes: z.array(
    z.object({
      id: z.string(),
      startFrame: z.number().int().nonnegative(),
      endFrame: z.number().int().positive(),
      title: z.string().optional(),
      script: z.string().optional(),
      imageHash: hash.optional(),
      videoHash: hash.optional(),
      videoStartSeconds: z.number().nonnegative().optional(),
      videoMuted: z.boolean().optional(),
      motion: z.enum(["static", "push-in", "pull-out"]).optional(),
    }),
  ),
  captions: z
    .array(
      z.object({
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
        text: z.string(),
      }),
    )
    .default([]),
});
export function convertLegacyScenario(input: unknown, mappings: z.infer<typeof AssetMapping>[]) {
  const scenario = Scenario.parse(input),
    byHash = new Map(mappings.map((m) => [m.sha256, m.asset]));
  if (
    (scenario.musicHash && !scenario.mixHash) ||
    scenario.scenes.some((s) => s.videoHash && s.videoMuted === false)
  )
    throw new Error(
      "Legacy unmixed music or audible video requires an explicit audio mapping before native conversion",
    );
  const ref = (h: string) => {
    const asset = byHash.get(h);
    if (!asset) throw new Error(`Missing archived asset ${h}`);
    return asset;
  };
  const script = Script.parse({
    language: scenario.language,
    writingSystem: scenario.language === "ru" ? "cyrillic" : "latin",
    title: scenario.title,
    premise: migrationWarning,
    sceneOrder: scenario.scenes.map((s) => s.id),
    scenesById: Object.fromEntries(
      scenario.scenes.map((s) => [
        s.id,
        {
          purpose: s.title ?? s.id,
          narration: s.script ?? "",
          onScreenText: s.title ? [s.title] : [],
          visual: {
            description: "Imported legacy visual; inspect original archive for provenance",
            shot: "Imported",
            motion: s.motion ?? "static",
            keyframeOrder: s.imageHash ? ["start"] : [],
            keyframesById: s.imageHash
              ? {
                  start: {
                    position: "start",
                    prompt: "Imported source image",
                    references: [],
                    selectedImage: ref(s.imageHash),
                  },
                }
              : {},
          },
          shotOrder: [],
          shotsById: {},
          claims: [],
        },
      ]),
    ),
  });
  const visual = Object.fromEntries(
    scenario.scenes
      .filter((s) => s.imageHash || s.videoHash)
      .map((s) => [
        s.id,
        {
          sceneId: s.id,
          startFrame: s.startFrame,
          durationFrames: s.endFrame - s.startFrame,
          motion: s.motion ?? "static",
          source: {
            kind: "asset",
            asset: ref(s.videoHash ?? s.imageHash!),
            ...(s.videoHash ? { sourceStartMs: (s.videoStartSeconds ?? 0) * 1000 } : {}),
          },
        },
      ]),
  );
  const captions = Object.fromEntries(
    scenario.captions.map((c, i) => [
      `caption-${i}`,
      {
        startFrame: c.startFrame,
        durationFrames: c.endFrame - c.startFrame,
        source: { kind: "text", text: c.text },
        layout: { x: 0.06, y: 0.7, width: 0.88, height: 0.22, fit: "contain" },
      },
    ]),
  );
  const audioHash = scenario.mixHash ?? scenario.audioHash;
  const timeline = Timeline.parse({
    fps: { numerator: scenario.fps, denominator: 1 },
    durationFrames: scenario.durationFrames,
    trackOrder: ["visual", "captions", ...(audioHash ? ["audio"] : [])],
    tracksById: {
      visual: { kind: "visual", clipOrder: Object.keys(visual), clipsById: visual },
      captions: { kind: "caption", clipOrder: Object.keys(captions), clipsById: captions },
      ...(audioHash
        ? {
            audio: {
              kind: "voice",
              clipOrder: ["audio"],
              clipsById: {
                audio: {
                  startFrame: 0,
                  durationFrames: scenario.durationFrames,
                  source: { kind: "asset", asset: ref(audioHash) },
                },
              },
            },
          }
        : {}),
    },
  });
  return {
    script,
    timeline,
    format: Format.parse({ width: scenario.width, height: scenario.height, fps: timeline.fps }),
    warning: migrationWarning,
  };
}
