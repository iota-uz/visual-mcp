import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { chromium } from "playwright";
import { CharacterSceneProps } from "../packages/video/src/character.js";
import { builtInCharacterPacks } from "../packages/video/src/character-packs.js";
import { Timeline } from "../packages/video/src/contracts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = process.env.EMOTION_OUTPUT_DIR
  ? resolve(process.env.EMOTION_OUTPUT_DIR)
  : join(root, "output", "character-emotion-blind-stills", "20260912-runtime-freeze");
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

// The order is deliberately not written to any artifact. Share it only after blind review.
const privateOrder = ["angry", "neutral", "shocked", "sad", "happy"] as const;
const sceneFor = (emotion: (typeof privateOrder)[number]) =>
  CharacterSceneProps.parse({
    stage: { aspect: "9:16", width: 1080, height: 1920 },
    timebase: { numerator: 30, denominator: 1 },
    seed: 20260912,
    staging: { layout: "reaction-closeup", focalActorId: "farq" },
    camera: { movement: "locked", startFrame: 0, durationFrames: 60 },
    cameraSequence: [],
    effects: [],
    environment: {
      background: "#171717",
      horizonY: 0.84,
      ground: "#242424",
      accent: "#ffb52e",
      layers: [],
    },
    characterPacksById: {
      "farq-official": structuredClone(builtInCharacterPacks["farq-official"]),
    },
    actorOrder: ["farq"],
    actorsById: {
      farq: {
        characterPackId: "farq-official",
        x: 0.5,
        y: 0.63,
        scale: 1.48,
        facing: "right",
        initialEmotion: emotion,
      },
    },
    propOrder: [],
    propsById: {},
    actionOrder: [],
    actionsById: {},
    overlayOrder: [],
    overlaysById: {},
  });
const serveUrl = await bundle({
  entryPoint: join(root, "apps", "worker", "dist", "video", "entry.js"),
  outDir: bundleDir,
  publicDir,
  enableCaching: false,
});
const browserExecutable = process.env.VIDEO_BROWSER_EXECUTABLE ?? chromium.executablePath();
const hashes = [];
for (let index = 0; index < privateOrder.length; index++) {
  const scene = sceneFor(privateOrder[index]!);
  const timeline = Timeline.parse({
    fps: { numerator: 30, denominator: 1 },
    durationFrames: 60,
    trackOrder: ["visual"],
    tracksById: {
      visual: {
        kind: "visual",
        clipOrder: ["emotion"],
        clipsById: {
          emotion: {
            startFrame: 0,
            durationFrames: 60,
            source: {
              kind: "component",
              component: { resourceId: "video/component/character-scene", revisionId: "4" },
              props: scene,
            },
          },
        },
      },
    },
  });
  const inputProps = {
    format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
    timeline,
    files: {},
  };
  const composition = await selectComposition({
    serveUrl,
    id: "VideoStudio",
    inputProps,
    browserExecutable,
    logLevel: "error",
  });
  const full = join(outputDir, `sample-${index + 1}.png`),
    website = join(outputDir, `sample-${index + 1}-website.png`);
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    output: full,
    frame: 30,
    browserExecutable,
    imageFormat: "png",
    logLevel: "error",
  });
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    output: website,
    frame: 30,
    scale: 320 / 1080,
    browserExecutable,
    imageFormat: "png",
    logLevel: "error",
  });
  const hash = async (path: string) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  hashes.push({
    sample: index + 1,
    fullSha256: await hash(full),
    websiteSha256: await hash(website),
  });
}
await writeFile(
  join(outputDir, "blind-receipt.json"),
  JSON.stringify(
    {
      scope:
        "Five unlabeled isolated facial-state stills; identical actor, stage, camera, pose and frame",
      frame: 30,
      fps: 30,
      fullSize: { width: 1080, height: 1920 },
      websiteWidth: 320,
      samples: hashes,
      evidenceLimit:
        "Still-image distinguishability only; no intended labels, motion, dialogue, pronunciation, sync, pacing or approval claim.",
    },
    null,
    2,
  ),
);
console.log(`Blind emotion stills written to ${outputDir}`);
