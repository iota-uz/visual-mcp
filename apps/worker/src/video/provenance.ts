import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VERSION } from "remotion";
import { fileIdentity } from "./media.js";

const run = promisify(execFile);
export function buildIdentity(value: string | undefined): string | null {
  return value && /^[a-f0-9]{40,64}$/i.test(value) ? value.toLowerCase() : null;
}
export async function renderEngine(
  fonts: { family: string; path: string }[],
  signal?: AbortSignal,
) {
  const { stdout } = await run("ffmpeg", ["-version"], {
    signal,
    timeout: 5000,
    maxBuffer: 16384,
    env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
  });
  const ffmpegVersion = /^ffmpeg version (\S+)/m.exec(stdout)?.[1];
  if (!ffmpegVersion || ffmpegVersion.length > 200) throw new Error("FFmpeg version unavailable");
  return {
    remotionVersion: VERSION,
    ffmpegVersion,
    workerBuildSha: buildIdentity(process.env.VIDEO_WORKER_BUILD_SHA),
    fonts: await Promise.all(
      fonts.map(async (font) => ({
        family: font.family,
        sha256: (await fileIdentity(font.path)).sha256,
      })),
    ),
  };
}
