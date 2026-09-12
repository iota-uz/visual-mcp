/**
 * Offline acceptance compiler for the character dialogue specification.
 *
 * Usage:
 *   npx tsx scripts/character-spec-acceptance.ts path/to/pinned-voices.json
 *   npx tsx scripts/character-spec-acceptance.ts path/to/pinned-voices.json --render
 *   npx tsx scripts/character-spec-acceptance.ts path/to/pinned-voices.json --render --repeat
 *
 * The input must contain already-generated, local audio plus the exact pinned
 * provider alignment JSON. This script never downloads media or calls a paid provider.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { runCharacterQualityDiagnostics } from "../apps/worker/src/video/character-quality.js";
import { CharacterSceneProps } from "../packages/video/src/character.js";
import {
  canonicalActionDefinition,
  createProjectActionLibrary,
} from "../packages/video/src/character-action-library.js";
import { compileCharacterAudioPlan } from "../packages/video/src/character-audio-plan.js";
import { choreography } from "../packages/video/src/character-choreography.js";
import { ElevenLabsAlignmentArtifact } from "../packages/video/src/character-dialogue.js";
import {
  builtInCharacterPacks,
  phoneCharacterProp,
} from "../packages/video/src/character-packs.js";
import { bakeProceduralAction } from "../packages/video/src/character-procedural.js";
import { Timeline } from "../packages/video/src/contracts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const outputDir = process.env.ACCEPTANCE_OUTPUT_DIR
  ? resolve(process.env.ACCEPTANCE_OUTPUT_DIR)
  : join(root, "output", "character-spec-acceptance");
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const SuppliedVoice = z
  .object({
    lineId: z.enum(["customerQuestion", "farqAnswer"]),
    text: z.string().min(1).max(200),
    localAudioPath: z.string().min(1),
    audio: z
      .object({
        assetId: z.string().min(1),
        revisionId: z.string().min(1),
        sha256: Hash,
        mimeType: z.literal("audio/mpeg"),
        durationFrames: z.number().int().min(1).max(300),
      })
      .strict(),
    alignment: z
      .object({
        assetId: z.string().min(1),
        revisionId: z.string().min(1),
        sha256: Hash,
        artifact: ElevenLabsAlignmentArtifact,
      })
      .strict(),
  })
  .strict();
const Input = z
  .object({
    provenance: z.literal("real-elevenlabs-provider-output"),
    note: z.string().min(1).max(500),
    voices: z.tuple([SuppliedVoice, SuppliedVoice]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.voices.map((voice) => (voice as { lineId: string }).lineId)).size !== 2)
      ctx.addIssue({
        code: "custom",
        path: ["voices"],
        message: "Provide exactly one voice for each acceptance line",
      });
  });

const inputPath = process.argv[2];
if (!inputPath || inputPath === "--render")
  throw new Error("Provide pinned-voices.json before the optional --render flag");
type Voice = z.infer<typeof SuppliedVoice>;
const supplied = Input.parse(JSON.parse(await readFile(resolve(inputPath), "utf8"))) as {
  provenance: "real-elevenlabs-provider-output";
  note: string;
  voices: [Voice, Voice];
};
const hashFile = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const byId = Object.fromEntries(supplied.voices.map((voice) => [voice.lineId, voice])) as Record<
  Voice["lineId"],
  Voice
>;
for (const voice of supplied.voices) {
  const bytes = await readFile(resolve(voice.localAudioPath));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== voice.audio.sha256)
    throw new Error(`${voice.lineId} local audio does not match its pinned SHA-256`);
}

const durationFrames = 750;
const line = (
  id: "customerQuestion" | "farqAnswer",
  actorId: string,
  startFrame: number,
  targetId: string,
  emotion: "confused" | "confident",
  gesture: "shrug" | "present",
) => {
  const suppliedLine = byId[id];
  return {
    id,
    sceneId: "phonePriceDialogue",
    actorId,
    text: suppliedLine.text,
    startFrame,
    target: { kind: "actor" as const, actorId: targetId },
    emotion,
    gesture,
    listenersByActorId:
      id === "farqAnswer"
        ? { customer: { reaction: "relieved" as const, reactionDelayFrames: 18 } }
        : {},
    voice: {
      asset: { assetId: suppliedLine.audio.assetId, revisionId: suppliedLine.audio.revisionId },
      sha256: suppliedLine.audio.sha256,
      mimeType: suppliedLine.audio.mimeType,
      durationFrames: suppliedLine.audio.durationFrames,
      alignment: {
        asset: {
          assetId: suppliedLine.alignment.assetId,
          revisionId: suppliedLine.alignment.revisionId,
        },
        sha256: suppliedLine.alignment.sha256,
        provider: "elevenlabs" as const,
        timingBasis: "provider_supplied" as const,
        artifact: suppliedLine.alignment.artifact,
      },
    },
  };
};
const audioPlan = compileCharacterAudioPlan({
  dialogue: {
    timebase: { numerator: 30, denominator: 1 },
    durationFrames,
    lineOrder: ["customerQuestion", "farqAnswer"],
    linesById: {
      customerQuestion: line("customerQuestion", "customer", 75, "farq", "confused", "shrug"),
      farqAnswer: line("farqAnswer", "farq", 390, "customer", "confident", "present"),
    },
  },
  music: [],
  sfx: [],
  mastering: { sampleRate: 48000, targetLufs: -16, maxTruePeakDb: -1, loudnessRange: 8 },
});

const compoundContent = {
  kind: "sequence" as const,
  durationSeconds: 1.2,
  actions: [
    {
      id: "agree",
      atSeconds: 0,
      durationSeconds: 0.7,
      action: { type: "gesture" as const, preset: "agree" as const },
    },
    { id: "blink", atSeconds: 0.72, durationSeconds: 0.16, action: { type: "blink" as const } },
  ],
};
const compoundCanonical = canonicalActionDefinition({
  id: "confirmChoice",
  label: "Confirm choice",
  content: compoundContent,
});
const compoundRevisionId = createHash("sha256").update(compoundCanonical).digest("hex");
const actionLibrary = createProjectActionLibrary([
  {
    id: "confirmChoice",
    revisionId: compoundRevisionId,
    label: "Confirm choice",
    content: compoundContent,
  },
]);
const reusableMain = choreography({ numerator: 30, denominator: 1 }, actionLibrary)
  .at(21)
  .use("closingConfirm", "farq", { id: "confirmChoice", revisionId: compoundRevisionId })
  .compile();
const reusableEpilogue = choreography({ numerator: 30, denominator: 1 }, actionLibrary)
  .at(1)
  .use("epilogueConfirm", "customer", { id: "confirmChoice", revisionId: compoundRevisionId })
  .compile();
const actionsById = {
  ...structuredClone(audioPlan.dialogue.actionsById),
  ...reusableMain.actionsById,
};
const actionOrder = [
  ...audioPlan.dialogue.actionOrder,
  ...reusableMain.actionOrder,
  "farqProceduralAccent",
];
actionsById.farqProceduralAccent = bakeProceduralAction({
  source: '(t,ctx)=>({"root.y": -8*sin(t*3.141592653589793)})',
  actorId: "farq",
  startFrame: 360,
  durationFrames: 120,
  timebase: { numerator: 30, denominator: 1 },
  seed: 20260912,
  mode: "additive",
  priority: 1,
});
actionOrder.sort(
  (a, b) => actionsById[a]!.startFrame - actionsById[b]!.startFrame || a.localeCompare(b),
);
const phone = {
  ...structuredClone(phoneCharacterProp),
  x: 0.5,
  y: 0.43,
  scale: 2.4,
  initiallyVisible: true,
};
const scene = CharacterSceneProps.parse({
  stage: { aspect: "9:16", width: 1080, height: 1920 },
  timebase: { numerator: 30, denominator: 1 },
  seed: 20260912,
  staging: { layout: "two-shot", focalActorId: "farq" },
  camera: { movement: "locked", startFrame: 0, durationFrames },
  cameraSequence: [
    {
      id: "opening",
      startFrame: 0,
      durationFrames: 360,
      type: "frame",
      x: 0.5,
      y: 0.52,
      zoom: 0.88,
    },
    {
      id: "answerPush",
      startFrame: 360,
      durationFrames: 240,
      type: "push",
      x: 0.54,
      y: 0.52,
      zoom: 0.96,
      intensity: 0.24,
    },
    { id: "ctaHold", startFrame: 600, durationFrames: 150, type: "hold" },
  ],
  effects: [],
  environment: {
    background: "#120d0a",
    horizonY: 0.78,
    ground: "#251611",
    accent: "#ffb52e",
    layers: [
      {
        id: "pricePanel",
        plane: "midground",
        shape: "panel",
        x: 0.5,
        y: 0.3,
        width: 0.72,
        height: 0.22,
        color: "#f7ead8",
        opacity: 1,
        parallax: 0.08,
      },
    ],
  },
  characterPacksById: {
    "farq-official": structuredClone(builtInCharacterPacks["farq-official"]),
    customer: structuredClone(builtInCharacterPacks.customer),
  },
  actorOrder: ["customer", "farq"],
  actorsById: {
    customer: {
      characterPackId: "customer",
      x: 0.3,
      y: 0.67,
      scale: 0.98,
      facing: "right",
      initialEmotion: "neutral",
    },
    farq: {
      characterPackId: "farq-official",
      x: 0.68,
      y: 0.65,
      scale: 1.18,
      facing: "left",
      initialEmotion: "happy",
    },
  },
  propOrder: ["phone"],
  propsById: { phone },
  actionOrder,
  actionsById,
  overlayOrder: ["priceOne", "priceTwo", "cta"],
  overlaysById: {
    priceOne: {
      text: "158 000 сум",
      x: 0.32,
      y: 0.21,
      startFrame: 30,
      endFrame: 600,
      style: "price-old",
      accent: "#9aa7b6",
    },
    priceTwo: {
      text: "129 000 сум",
      x: 0.68,
      y: 0.29,
      startFrame: 330,
      endFrame: 690,
      style: "price-new",
      accent: "#ffb52e",
    },
    cta: {
      text: "Сравни цены до покупки",
      x: 0.5,
      y: 0.88,
      startFrame: 600,
      endFrame: 750,
      style: "cta",
      accent: "#ffb52e",
    },
  },
  caption: "Real provider audio fixture; perceptual acceptance requires human review",
});
const epilogueScene = CharacterSceneProps.parse({
  ...structuredClone(scene),
  camera: { movement: "locked", startFrame: 0, durationFrames: 120 },
  cameraSequence: [],
  actionOrder: reusableEpilogue.actionOrder,
  actionsById: reusableEpilogue.actionsById,
  overlayOrder: ["cta"],
  overlaysById: {
    cta: {
      text: "Сравни цены до покупки",
      x: 0.5,
      y: 0.88,
      startFrame: 0,
      endFrame: 120,
      style: "cta",
      accent: "#ffb52e",
    },
  },
  caption: "Second fixture reusing the exact confirmChoice compound revision",
});
const diagnosticFrames = [0, 75, 210, 390, 510, 660, 749] as const;
const qualityDiagnostics = runCharacterQualityDiagnostics(scene, diagnosticFrames);

const timeline = Timeline.parse({
  ...audioPlan.timeline,
  trackOrder: ["visual", ...audioPlan.timeline.trackOrder],
  tracksById: {
    visual: {
      kind: "visual",
      clipOrder: ["acceptanceScene"],
      clipsById: {
        acceptanceScene: {
          sceneId: "phonePriceDialogue",
          startFrame: 0,
          durationFrames,
          source: {
            kind: "component",
            component: { resourceId: "video/component/character-scene", revisionId: "4" },
            props: scene,
          },
        },
      },
    },
    ...audioPlan.timeline.tracksById,
  },
});
await mkdir(outputDir, { recursive: true });
await writeFile(
  join(outputDir, "source.json"),
  JSON.stringify(
    {
      supplied,
      compoundAction: {
        id: "confirmChoice",
        revisionId: compoundRevisionId,
        canonical: compoundCanonical,
      },
      sceneFixtures: { dialogue: scene, epilogue: epilogueScene },
      dialogue: audioPlan.dialogue,
      qualityDiagnostics,
    },
    null,
    2,
  ),
);
await writeFile(join(outputDir, "timeline.json"), JSON.stringify(timeline, null, 2));
await writeFile(
  join(outputDir, "audio-mix-operation.json"),
  JSON.stringify({ inputs: audioPlan.inputs, operation: audioPlan.operation }, null, 2),
);

if (process.argv.includes("--render") || process.argv.includes("--stills-only")) {
  const publicDir = join(outputDir, "public"),
    bundleDir = join(outputDir, "bundle");
  await mkdir(publicDir, { recursive: true });
  const fontDir =
    process.env.VIDEO_FONT_DIR ??
    (process.platform === "darwin"
      ? "/System/Library/Fonts/Supplemental"
      : "/usr/share/fonts/truetype/dejavu");
  for (const [source, target] of process.platform === "darwin" && !process.env.VIDEO_FONT_DIR
    ? [
        ["Arial.ttf", "DejaVuSans.ttf"],
        ["Times New Roman.ttf", "DejaVuSerif.ttf"],
        ["Courier New.ttf", "DejaVuSansMono.ttf"],
      ]
    : [
        ["DejaVuSans.ttf", "DejaVuSans.ttf"],
        ["DejaVuSerif.ttf", "DejaVuSerif.ttf"],
        ["DejaVuSansMono.ttf", "DejaVuSansMono.ttf"],
      ])
    await copyFile(join(fontDir, source), join(publicDir, target));
  const files: Record<string, { path: string; mimeType: string }> = {};
  for (const voice of supplied.voices) {
    const filename = `${voice.lineId}-${basename(voice.localAudioPath)}`;
    await copyFile(resolve(voice.localAudioPath), join(publicDir, filename));
    files[`${voice.audio.assetId}:${voice.audio.revisionId}`] = {
      path: filename,
      mimeType: voice.audio.mimeType,
    };
  }
  const [{ bundle }, { renderMedia, renderStill, selectComposition }, { chromium }] =
    await Promise.all([
      import("@remotion/bundler"),
      import("@remotion/renderer"),
      import("playwright"),
    ]);
  const serveUrl = await bundle({
    entryPoint: join(root, "apps", "worker", "dist", "video", "entry.js"),
    outDir: bundleDir,
    publicDir,
    enableCaching: false,
  });
  const inputProps = {
    format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
    timeline,
    files,
  };
  const browserExecutable = process.env.VIDEO_BROWSER_EXECUTABLE ?? chromium.executablePath();
  const composition = await selectComposition({
    serveUrl,
    id: "VideoStudio",
    inputProps,
    browserExecutable,
    logLevel: "error",
  });
  const singleThreadFfmpeg = ({ args }: { type: "pre-stitcher" | "stitcher"; args: string[] }) => [
    ...args.slice(0, -1),
    "-threads",
    "1",
    args.at(-1)!,
  ];
  if (process.argv.includes("--bad-epilogue-still")) {
    const badSceneInput = structuredClone(epilogueScene);
    badSceneInput.actorsById.farq = { ...badSceneInput.actorsById.farq!, x: 0.98, scale: 1.6 };
    const badScene = CharacterSceneProps.parse(badSceneInput);
    const badTimeline = Timeline.parse({
      fps: { numerator: 30, denominator: 1 },
      durationFrames: 120,
      trackOrder: ["visual"],
      tracksById: {
        visual: {
          kind: "visual",
          clipOrder: ["badEpilogue"],
          clipsById: {
            badEpilogue: {
              startFrame: 0,
              durationFrames: 120,
              source: {
                kind: "component",
                component: { resourceId: "video/component/character-scene", revisionId: "4" },
                props: badScene,
              },
            },
          },
        },
      },
    });
    const badProps = {
      format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
      timeline: badTimeline,
      files: {},
    };
    const badComposition = await selectComposition({
      serveUrl,
      id: "VideoStudio",
      inputProps: badProps,
      browserExecutable,
      logLevel: "error",
    });
    const badScenePath = join(outputDir, "intentional-bad-epilogue-scene.json");
    const badPngPath = join(outputDir, "intentional-bad-epilogue-frame-60.png");
    await writeFile(
      badScenePath,
      JSON.stringify(
        {
          intent:
            "Deliberately out-of-safe-frame held actor for independent scoped defect detection",
          selectedFixture: "epilogue",
          selectedFrame: 60,
          unchangedDialogueSceneSha256: createHash("sha256")
            .update(JSON.stringify(scene))
            .digest("hex"),
          scene: badScene,
          qualityDiagnostics: runCharacterQualityDiagnostics(badScene, [60]),
        },
        null,
        2,
      ),
    );
    await renderStill({
      composition: badComposition,
      serveUrl,
      inputProps: badProps,
      output: badPngPath,
      frame: 60,
      browserExecutable,
      imageFormat: "png",
      logLevel: "error",
    });
    await writeFile(
      join(outputDir, "intentional-bad-epilogue-receipt.json"),
      JSON.stringify(
        {
          selectedFixture: "epilogue",
          selectedFrame: 60,
          sceneSha256: await hashFile(badScenePath),
          pngSha256: await hashFile(badPngPath),
          unchangedDialogueSceneSha256: createHash("sha256")
            .update(JSON.stringify(scene))
            .digest("hex"),
          evidenceLimit:
            "Deliberate negative spatial fixture only; no overall quality score or audiovisual claim.",
        },
        null,
        2,
      ),
    );
  }
  if (process.argv.includes("--fixed-epilogue-still")) {
    const scopedBadPath = process.env.SCOPED_BAD_SCENE;
    const scopedBaselinePath = process.env.SCOPED_BASELINE_SOURCE;
    const scopedBadPngPath = process.env.SCOPED_BAD_PNG;
    if (!scopedBadPath || !scopedBaselinePath || !scopedBadPngPath)
      throw new Error(
        "Scoped fix requires SCOPED_BAD_SCENE, SCOPED_BAD_PNG and SCOPED_BASELINE_SOURCE",
      );
    const scopedBad = JSON.parse(await readFile(resolve(scopedBadPath), "utf8")) as {
      scene: unknown;
      unchangedDialogueSceneSha256: string;
    };
    const scopedBaseline = JSON.parse(await readFile(resolve(scopedBaselinePath), "utf8")) as {
      sceneFixtures: { dialogue: unknown };
    };
    const baselineDialogue = CharacterSceneProps.parse(scopedBaseline.sceneFixtures.dialogue);
    const baselineDialogueHash = createHash("sha256")
      .update(JSON.stringify(baselineDialogue))
      .digest("hex");
    if (baselineDialogueHash !== scopedBad.unchangedDialogueSceneSha256)
      throw new Error("Original bad receipt does not match the actual baseline dialogue fixture");
    const badScene = CharacterSceneProps.parse(scopedBad.scene);
    const fixedSceneInput = structuredClone(badScene);
    fixedSceneInput.actorsById.farq = { ...fixedSceneInput.actorsById.farq!, x: 0.68, scale: 1.18 };
    const fixedScene = CharacterSceneProps.parse(fixedSceneInput);
    const fixedTimeline = Timeline.parse({
      fps: { numerator: 30, denominator: 1 },
      durationFrames: 120,
      trackOrder: ["visual"],
      tracksById: {
        visual: {
          kind: "visual",
          clipOrder: ["fixedEpilogue"],
          clipsById: {
            fixedEpilogue: {
              startFrame: 0,
              durationFrames: 120,
              source: {
                kind: "component",
                component: { resourceId: "video/component/character-scene", revisionId: "4" },
                props: fixedScene,
              },
            },
          },
        },
      },
    });
    const fixedProps = {
      format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
      timeline: fixedTimeline,
      files: {},
    };
    const fixedComposition = await selectComposition({
      serveUrl,
      id: "VideoStudio",
      inputProps: fixedProps,
      browserExecutable,
      logLevel: "error",
    });
    const fixedScenePath = join(outputDir, "fixed-epilogue-scene.json");
    const fixedPngPath = join(outputDir, "fixed-epilogue-frame-60.png");
    const dialogueHash = baselineDialogueHash;
    const beforeFixtures = { dialogue: baselineDialogue, epilogue: badScene };
    const afterFixtures = { dialogue: baselineDialogue, epilogue: fixedScene };
    await writeFile(
      fixedScenePath,
      JSON.stringify(
        {
          scope: "Epilogue actor placement only, following independent clipping finding",
          selectedFixture: "epilogue",
          selectedFrame: 60,
          unchangedDialogueSceneSha256: dialogueHash,
          scene: fixedScene,
          qualityDiagnostics: runCharacterQualityDiagnostics(fixedScene, [60]),
        },
        null,
        2,
      ),
    );
    await renderStill({
      composition: fixedComposition,
      serveUrl,
      inputProps: fixedProps,
      output: fixedPngPath,
      frame: 60,
      browserExecutable,
      imageFormat: "png",
      logLevel: "error",
    });
    await writeFile(
      join(outputDir, "fixed-epilogue-receipt.json"),
      JSON.stringify(
        {
          selectedFixture: "epilogue",
          selectedFrame: 60,
          before: {
            projectFixturesSha256: createHash("sha256")
              .update(JSON.stringify(beforeFixtures))
              .digest("hex"),
            epilogueSceneSha256: createHash("sha256")
              .update(JSON.stringify(badScene))
              .digest("hex"),
            pngSha256: await hashFile(resolve(scopedBadPngPath)),
            sceneIds: Object.keys(beforeFixtures),
          },
          after: {
            projectFixturesSha256: createHash("sha256")
              .update(JSON.stringify(afterFixtures))
              .digest("hex"),
            epilogueSceneSha256: createHash("sha256")
              .update(JSON.stringify(fixedScene))
              .digest("hex"),
            sceneArtifactSha256: await hashFile(fixedScenePath),
            pngSha256: await hashFile(fixedPngPath),
            qualityDiagnostics: runCharacterQualityDiagnostics(fixedScene, [60]),
            sceneIds: Object.keys(afterFixtures),
          },
          unchangedDialogueSceneSha256: dialogueHash,
        },
        null,
        2,
      ),
    );
  }
  if (process.argv.includes("--short-encoding-test")) {
    const conditions = [
      { id: "default-serial", disallowParallelEncoding: true, imageFormat: undefined },
      { id: "png-parallel", disallowParallelEncoding: false, imageFormat: "png" as const },
      { id: "png-serial", disallowParallelEncoding: true, imageFormat: "png" as const },
    ];
    const results = [];
    for (const condition of conditions) {
      const paths = ["a", "b"].map((runId) =>
        join(outputDir, `short-${condition.id}-${runId}.mp4`),
      );
      for (const path of paths)
        await renderMedia({
          composition,
          serveUrl,
          inputProps,
          outputLocation: path,
          browserExecutable,
          codec: "h264",
          pixelFormat: "yuv420p",
          ...(condition.imageFormat ? { imageFormat: condition.imageFormat } : {}),
          frameRange: [0, 29],
          crf: 18,
          concurrency: 1,
          disallowParallelEncoding: condition.disallowParallelEncoding,
          logLevel: "error",
        });
      const frameFiles = paths.map((_, index) =>
        join(outputDir, `short-${condition.id}-${index}.framemd5`),
      );
      for (let index = 0; index < paths.length; index++)
        await run("ffmpeg", [
          "-v",
          "error",
          "-i",
          paths[index]!,
          "-map",
          "0:v:0",
          "-f",
          "framemd5",
          "-y",
          frameFiles[index]!,
        ]);
      const hashes = await Promise.all(frameFiles.map(hashFile));
      results.push({ ...condition, frameMd5Sha256: hashes, identical: hashes[0] === hashes[1] });
    }
    await writeFile(
      join(outputDir, "short-encoding-determinism.json"),
      JSON.stringify(
        {
          basis: "same frozen bundle/inputProps; 30-frame H.264 range; decoded framemd5",
          results,
        },
        null,
        2,
      ),
    );
  }
  if (process.argv.includes("--render"))
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation: join(outputDir, "acceptance.mp4"),
      browserExecutable,
      codec: "h264",
      pixelFormat: "yuv420p",
      imageFormat: "png",
      crf: 18,
      concurrency: 1,
      disallowParallelEncoding: true,
      ffmpegOverride: singleThreadFfmpeg,
      logLevel: "error",
    });
  if (process.argv.includes("--render") && process.argv.includes("--repeat")) {
    const repeatPath = join(outputDir, "acceptance-repeat.mp4");
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation: repeatPath,
      browserExecutable,
      codec: "h264",
      pixelFormat: "yuv420p",
      imageFormat: "png",
      crf: 18,
      concurrency: 1,
      disallowParallelEncoding: true,
      ffmpegOverride: singleThreadFfmpeg,
      logLevel: "error",
    });
    const frameMd5 = async (media: string, output: string) =>
      run("ffmpeg", ["-v", "error", "-i", media, "-map", "0:v:0", "-f", "framemd5", "-y", output]);
    const firstFrames = join(outputDir, "acceptance.framemd5"),
      repeatFrames = join(outputDir, "acceptance-repeat.framemd5");
    await frameMd5(join(outputDir, "acceptance.mp4"), firstFrames);
    await frameMd5(repeatPath, repeatFrames);
    const firstFrameHash = await hashFile(firstFrames),
      repeatFrameHash = await hashFile(repeatFrames);
    await writeFile(
      join(outputDir, "determinism-receipt.json"),
      JSON.stringify(
        {
          basis: "ffmpeg decoded video framemd5",
          identical: firstFrameHash === repeatFrameHash,
          runs: [
            {
              path: join(outputDir, "acceptance.mp4"),
              encodedSha256: await hashFile(join(outputDir, "acceptance.mp4")),
              frameMd5Sha256: firstFrameHash,
            },
            {
              path: repeatPath,
              encodedSha256: await hashFile(repeatPath),
              frameMd5Sha256: repeatFrameHash,
            },
          ],
          sourceSha256: await hashFile(join(outputDir, "source.json")),
          timelineSha256: await hashFile(join(outputDir, "timeline.json")),
        },
        null,
        2,
      ),
    );
  }
  for (const frame of [75, 210, 390, 510, 660]) {
    await renderStill({
      composition,
      serveUrl,
      inputProps,
      output: join(outputDir, `frame-${frame}.png`),
      frame,
      browserExecutable,
      imageFormat: "png",
      logLevel: "error",
    });
    if (process.argv.includes("--repeat-stills")) {
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        output: join(outputDir, `frame-${frame}-repeat.png`),
        frame,
        browserExecutable,
        imageFormat: "png",
        logLevel: "error",
      });
    }
  }
  if (process.argv.includes("--repeat-stills")) {
    const samples = await Promise.all(
      [75, 210, 390, 510, 660].map(async (frame) => {
        const first = await hashFile(join(outputDir, `frame-${frame}.png`));
        const repeat = await hashFile(join(outputDir, `frame-${frame}-repeat.png`));
        return { frame, firstSha256: first, repeatSha256: repeat, identical: first === repeat };
      }),
    );
    await writeFile(
      join(outputDir, "still-determinism-receipt.json"),
      JSON.stringify(
        {
          basis: "same frozen bundle/inputProps, separate renderStill PNG calls",
          identical: samples.every((sample) => sample.identical),
          samples,
        },
        null,
        2,
      ),
    );
  }
  if (process.argv.includes("--render")) {
    const renderedPath = join(outputDir, "acceptance.mp4");
    await writeFile(
      join(outputDir, "render-receipt.json"),
      JSON.stringify(
        {
          artifact: {
            path: renderedPath,
            sha256: await hashFile(renderedPath),
            sizeBytes: (await stat(renderedPath)).size,
          },
          sourceSha256: await hashFile(join(outputDir, "source.json")),
          timelineSha256: await hashFile(join(outputDir, "timeline.json")),
          expected: {
            durationFrames,
            fps: { numerator: 30, denominator: 1 },
            width: 1080,
            height: 1920,
            audio: true,
          },
          renderSettings: {
            codec: "h264",
            pixelFormat: "yuv420p",
            imageFormat: "png",
            concurrency: 1,
            disallowParallelEncoding: true,
            ffmpegThreads: 1,
          },
          qualityDiagnostics,
          evidenceLimits:
            "Compiler and renderer receipt only; pronunciation, sync, pacing and approval require review of the exact MP4 bytes.",
        },
        null,
        2,
      ),
    );
  }
}
console.log(`Character acceptance artifacts written to ${outputDir}`);
