import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { chromium } from "playwright";
import { buildCharacterScenario } from "../apps/web/src/dev/character-animation-lab/scenarios.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "output", "character-benchmark");
const bundleDir = join(outputDir, "bundle");
const publicDir = join(outputDir, "public");
await mkdir(publicDir, { recursive: true });
const fontDir =
  process.env.VIDEO_FONT_DIR ??
  (process.platform === "darwin"
    ? "/System/Library/Fonts/Supplemental"
    : "/usr/share/fonts/truetype/dejavu");
const localMacFonts = !process.env.VIDEO_FONT_DIR && process.platform === "darwin";
for (const [source, target] of localMacFonts
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

const scenario = buildCharacterScenario("golden-ad");
const timebase = scenario.props.timebase;
const inputProps = {
  format: { width: 1080, height: 1920, fps: timebase },
  timeline: {
    fps: timebase,
    durationFrames: scenario.totalFrames,
    trackOrder: ["visual"],
    tracksById: {
      visual: {
        kind: "visual",
        clipOrder: ["golden"],
        clipsById: {
          golden: {
            startFrame: 0,
            durationFrames: scenario.totalFrames,
            source: {
              kind: "component",
              component: { resourceId: "video/component/character-scene", revisionId: "4" },
              props: scenario.props,
            },
          },
        },
      },
    },
  },
  files: {},
};

const serveUrl = await bundle({
  entryPoint: join(root, "apps", "worker", "dist", "video", "entry.js"),
  outDir: bundleDir,
  publicDir,
  enableCaching: false,
});
const browserExecutable = process.env.VIDEO_BROWSER_EXECUTABLE ?? chromium.executablePath();
const composition = await selectComposition({
  serveUrl,
  id: "VideoStudio",
  inputProps,
  browserExecutable,
  logLevel: "error",
});

await renderMedia({
  imageFormat: "png",
  composition,
  serveUrl,
  inputProps,
  outputLocation: join(outputDir, "golden-ad.mp4"),
  browserExecutable,
  codec: "h264",
  pixelFormat: "yuv420p",
  crf: 18,
  concurrency: 1,
  logLevel: "error",
});
for (const frame of [0, 90, 132, 144, 174, 190, 191, 220])
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    output: join(outputDir, `golden-ad-frame-${String(frame).padStart(3, "0")}.png`),
    frame,
    browserExecutable,
    imageFormat: "png",
    logLevel: "error",
  });

console.log(`Character benchmark rendered to ${outputDir}`);
