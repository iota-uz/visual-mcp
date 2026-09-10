import { fork } from "node:child_process";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import { isForbiddenImportAddress } from "./asset-import.js";
import { acquireMediaCapacity } from "./video/capacity.js";
import { fileIdentity, probeMedia, uploadArtifact } from "./video/media.js";
export class MediaTransferError extends Error {
  constructor(
    public code: string,
    public effect: "not_applied" | "unknown",
  ) {
    super(code);
  }
}
export const MediaTransferRequest = z
  .object({
    sourceUrl: z.string().url(),
    declaredMimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/gif",
      "video/mp4",
      "video/webm",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "text/vtt",
      "application/json",
      "font/ttf",
    ]),
    maxBytes: z.number().int().positive().max(2000000000),
    expectedSize: z.number().int().positive().max(2000000000).optional(),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    destinationUrl: z.string().url().optional(),
  })
  .strict();
async function download(
  raw: string,
  path: string,
  max: number,
  signal: AbortSignal,
): Promise<void> {
  const url = new URL(raw);
  const testLoopback =
    process.env.NODE_ENV === "test" && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((!testLoopback && url.protocol !== "https:") || url.username || url.password)
    throw new Error("Source requires HTTPS");
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(
      (a) => isForbiddenImportAddress(a.address) && !(testLoopback && a.address === "127.0.0.1"),
    )
  )
    throw new Error("Source resolves to a forbidden network");
  const selected = addresses[0]!;
  await new Promise<void>((resolve, reject) => {
    const req = (testLoopback ? httpRequest : request)(
      {
        hostname: selected.address,
        port: url.port || (testLoopback ? 80 : 443),
        path: url.pathname + url.search,
        servername: url.hostname,
        headers: { host: url.host },
        signal,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error("Source unavailable or redirected"));
          return;
        }
        if (Number(response.headers["content-length"] ?? 0) > max) {
          response.destroy();
          reject(new Error("Source exceeds reserved size"));
          return;
        }
        let total = 0;
        const limit = new Transform({
          transform(chunk: Buffer, _enc, callback) {
            total += chunk.length;
            callback(total > max ? new Error("Source exceeds byte limit") : null, chunk);
          },
        });
        pipeline(response, limit, createWriteStream(path, { flags: "wx" }), {
          signal,
        }).then(() => resolve(), reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Source timed out")));
    req.end();
  });
}
export async function inspectTransferredFile(path: string, mime: string) {
  if (mime === "font/ttf") {
    if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error("Font archive too large");
    const bytes = await readFile(path);
    if (bytes.length < 12 || bytes.readUInt32BE(0) !== 0x00010000)
      throw new Error("Invalid TrueType signature");
    const tables = bytes.readUInt16BE(4);
    if (!tables || tables > 4096 || 12 + tables * 16 > bytes.length)
      throw new Error("Invalid TrueType table directory");
    for (let i = 0; i < tables; i++) {
      const offset = bytes.readUInt32BE(12 + i * 16 + 8),
        size = bytes.readUInt32BE(12 + i * 16 + 12);
      if (offset + size > bytes.length) throw new Error("Invalid TrueType table bounds");
    }
    // Archived bytes only. This never adds a font to the trusted renderer registry.
    return { mimeType: mime, kind: "data" as const };
  }
  if (mime.startsWith("image/")) {
    const image = await sharp(path, { limitInputPixels: 100000000 }).metadata();
    const formats: Record<string, string> = {
      png: "image/png",
      jpeg: "image/jpeg",
      webp: "image/webp",
      avif: "image/avif",
      heif: "image/avif",
      gif: "image/gif",
    };
    if (!image.format || formats[image.format] !== mime || !image.width || !image.height)
      throw new Error("Image MIME mismatch");
    const stats = image.hasAlpha
      ? await sharp(path, { limitInputPixels: 100000000 }).stats()
      : null;
    const alpha = stats?.channels.at(-1);
    return {
      mimeType: mime,
      kind: "image" as const,
      width: image.width,
      height: image.height,
      hasAlpha: !!image.hasAlpha,
      alphaMin: alpha?.min ?? null,
      alphaMax: alpha?.max ?? null,
    };
  }
  if (mime === "application/json" || mime === "text/vtt") {
    if ((await stat(path)).size > 4 * 1024 * 1024)
      throw new Error("Text asset exceeds inspection limit");
    const bytes = await readFile(path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (mime === "application/json") JSON.parse(text);
    else if (!text.startsWith("WEBVTT")) throw new Error("Invalid VTT");
    return { mimeType: mime, kind: "data" as const };
  }
  const probe = await probeMedia(path);
  const container = (probe.format as { format_name?: string }).format_name?.split(",") ?? [];
  const expected: Record<string, string[]> = {
    "video/mp4": ["mp4"],
    "video/webm": ["webm"],
    "audio/mpeg": ["mp3"],
    "audio/wav": ["wav"],
    "audio/ogg": ["ogg"],
  };
  if (!expected[mime]?.some((name) => container.includes(name)))
    throw new Error("Media container does not match MIME");
  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.filter((s) => s.codec_type === "audio");
  const seconds = Number(probe.format.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Media duration unavailable");
  if (
    (mime.startsWith("video/") && !video) ||
    (mime.startsWith("audio/") && (!audio.length || video))
  )
    throw new Error("Media stream does not match MIME");
  return {
    mimeType: mime,
    kind: video ? ("video" as const) : ("audio" as const),
    ...(video
      ? {
          width: video.width,
          height: video.height,
          fps: video.avg_frame_rate ?? null,
        }
      : {}),
    durationMs: Math.round(seconds * 1000),
    hasAudio: audio.length > 0,
    audioStreams: audio.map((s) => ({
      codec: s.codec_name ?? null,
      channels: s.channels ?? null,
      sampleRateHz: s.sample_rate ? Number(s.sample_rate) : null,
    })),
  };
}
export async function executeMediaTransfer(raw: unknown) {
  const input = MediaTransferRequest.parse(raw);
  let scratch: string | undefined;
  try {
    const root = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
    await mkdir(root, { recursive: true });
    scratch = await mkdtemp(join(root, "media-transfer-"));
    const file = join(scratch, "source");
    const signal = AbortSignal.timeout(10 * 60 * 1000);
    await download(input.sourceUrl, file, input.maxBytes, signal);
    const identity = await fileIdentity(file);
    if (
      (input.expectedSize !== undefined && identity.sizeBytes !== input.expectedSize) ||
      (input.expectedSha256 && identity.sha256 !== input.expectedSha256)
    )
      throw new Error("Checksum or size mismatch");
    const metadata = await inspectTransferredFile(file, input.declaredMimeType);
    if (input.destinationUrl)
      await uploadArtifact(input.destinationUrl, file, metadata.mimeType, signal);
    return { ...identity, ...metadata, persisted: !!input.destinationUrl };
  } finally {
    try {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    } finally {
    }
  }
}
export async function handleMediaTransfer(raw: unknown, callerSignal?: AbortSignal) {
  const input = MediaTransferRequest.parse(raw);
  if (callerSignal?.aborted) throw new MediaTransferError("MEDIA_INTERRUPTED", "not_applied");
  const release = acquireMediaCapacity();
  if (!release) throw new MediaTransferError("WORKER_BUSY", "not_applied");
  let scratch: string | undefined;
  try {
    const root = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
    await mkdir(root, { recursive: true });
    scratch = await mkdtemp(join(root, "media-worker-"));
    return await new Promise<Awaited<ReturnType<typeof executeMediaTransfer>>>(
      (resolve, reject) => {
        const child = fork(
          fileURLToPath(new URL("./media-transfer-child.js", import.meta.url)),
          [],
          {
            detached: process.platform !== "win32",
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            execArgv: ["--max-old-space-size=1024"],
            env: {
              PATH: process.env.PATH,
              VIDEO_RENDER_TMP_ROOT: scratch,
              NODE_ENV: process.env.NODE_ENV,
            },
          },
        );
        let done = false;
        const finish = (
          error?: Error,
          result?: Awaited<ReturnType<typeof executeMediaTransfer>>,
        ) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          callerSignal?.removeEventListener("abort", abort);
          try {
            if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {}
          if (error) reject(error);
          else resolve(result!);
        };
        const abort = () => finish(new MediaTransferError("MEDIA_INTERRUPTED", "unknown"));
        const timer = setTimeout(abort, 10 * 60 * 1000);
        callerSignal?.addEventListener("abort", abort, { once: true });
        child.once("error", () => finish(new MediaTransferError("MEDIA_WORKER_FAILED", "unknown")));
        child.once("exit", () => {
          if (!done) finish(new MediaTransferError("MEDIA_WORKER_FAILED", "unknown"));
        });
        child.on(
          "message",
          (wire: { ok?: boolean; result?: Awaited<ReturnType<typeof executeMediaTransfer>> }) =>
            wire.ok && wire.result
              ? finish(undefined, wire.result)
              : finish(new MediaTransferError("MEDIA_VERIFICATION_FAILED", "unknown")),
        );
        child.send(input);
      },
    );
  } finally {
    try {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    } finally {
      release();
    }
  }
}
