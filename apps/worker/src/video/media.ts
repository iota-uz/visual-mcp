import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
export const MAX_ARTIFACT_BYTES = 2_000_000_000;
export function validateTransferUrl(value: string) {
  const url = new URL(value);
  const localFixture =
    process.env.NODE_ENV === "test" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(localFixture && url.protocol === "http:"))
  )
    throw new Error("Transfer requires HTTPS or a local development fixture");
  return url;
}
export async function downloadSource(
  input: { url: string; sizeBytes: number; sha256: string },
  target: string,
  signal: AbortSignal,
) {
  const response = await fetch(validateTransferUrl(input.url), { redirect: "error", signal });
  if (!response.ok || !response.body) throw new Error("Input transfer failed");
  let bytes = 0;
  const hash = createHash("sha256");
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > input.sizeBytes || bytes > MAX_ARTIFACT_BYTES)
        return callback(new Error("Input size exceeds reserved bytes"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as never),
    verify,
    createWriteStream(target, { flags: "wx" }),
    { signal },
  );
  if (bytes !== input.sizeBytes || hash.digest("hex") !== input.sha256)
    throw new Error("Input checksum or size mismatch");
}
export async function fileIdentity(path: string) {
  const info = await stat(path);
  if (info.size <= 0 || info.size > MAX_ARTIFACT_BYTES)
    throw new Error("Output size is outside the asset limit");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return { sha256: hash.digest("hex"), sizeBytes: info.size };
}
export async function uploadArtifact(
  url: string,
  path: string,
  mimeType: string,
  signal: AbortSignal,
) {
  const { size } = await stat(path);
  const response = await fetch(validateTransferUrl(url), {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": mimeType, "content-length": String(size) },
    body: createReadStream(path),
    duplex: "half",
    signal,
  });
  if (!response.ok) throw new Error("Result persistence failed");
}
export interface Probe {
  streams: {
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
    nb_frames?: string;
    duration?: string;
    avg_frame_rate?: string;
    sample_rate?: string;
    channels?: number;
  }[];
  format: { duration?: string };
}
/** Magic-sniff a leaf container before invoking any demuxer. No manifests,
 * playlists, image sequences or nested external references are accepted. */
export async function safeMediaInput(path: string): Promise<string[]> {
  const file = await open(path, "r");
  const bytes = Buffer.alloc(64);
  try {
    await file.read(bytes, 0, bytes.length, 0);
  } finally {
    await file.close();
  }
  const ascii = (start: number, end: number) => bytes.toString("ascii", start, end);
  let demuxer: string;
  if (ascii(4, 8) === "ftyp") demuxer = "mov";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") demuxer = "wav";
  else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") demuxer = "webp_pipe";
  else if (ascii(0, 4) === "OggS") demuxer = "ogg";
  else if (ascii(0, 4) === "fLaC") demuxer = "flac";
  else if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) demuxer = "matroska";
  else if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0))
    demuxer = "mp3";
  else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    demuxer = "png_pipe";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) demuxer = "jpeg_pipe";
  else if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") demuxer = "gif";
  else throw new Error("Unsupported media container; playlists and indirect sources are forbidden");
  return [
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    demuxer,
    "-f",
    demuxer,
    ...(demuxer === "mov" ? ["-enable_drefs", "0", "-use_absolute_path", "0"] : []),
    "-i",
    path,
  ];
}
export async function safeLocalMediaArgs(args: string[]) {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "-i") {
      const path = args[++index];
      if (!path) throw new Error("Missing media input");
      result.push(...(await safeMediaInput(path)));
    } else result.push(args[index]!);
  }
  return result;
}
export async function probeMedia(path: string, signal?: AbortSignal): Promise<Probe> {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      ...(await safeMediaInput(path)),
    ],
    { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, signal },
  );
  return JSON.parse(stdout) as Probe;
}
export async function makePoster(video: string, poster: string, signal: AbortSignal) {
  await run(
    "ffmpeg",
    ["-v", "error", ...(await safeMediaInput(video)), "-frames:v", "1", "-y", poster],
    {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      signal,
    },
  );
}
