import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function characterRenderCacheKey(value: {
  timeline: unknown;
  format: unknown;
  range: unknown;
  engine: unknown;
  inputs: readonly {
    asset?: unknown;
    sha256: string;
    mimeType?: string;
    sizeBytes?: number;
    url?: string;
  }[];
  jobId?: string;
  outputs?: unknown;
  fence?: unknown;
}) {
  // Strip transport only at its known boundary. Names such as "outputs" and
  // "fence" are valid authored actor/action IDs and MUST remain in the AST hash.
  const { timeline, format, range, engine } = value;
  const inputs = value.inputs.map(({ asset, sha256, mimeType, sizeBytes }) => ({
    asset,
    sha256,
    mimeType,
    sizeBytes,
  }));
  return hash(JSON.stringify(canonical({ timeline, format, range, engine, inputs })));
}
type Metadata = { sha256: string; sizeBytes: number; createdAt: number };

export async function readCharacterRenderCache(
  root: string,
  key: string,
  destination: string,
  options: { ttlMs: number; maxEntryBytes: number },
) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid cache key");
  const video = join(root, `${key}.mp4`),
    metadataPath = join(root, `${key}.json`);
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Metadata;
    const info = await stat(video);
    if (
      !Number.isFinite(metadata.createdAt) ||
      metadata.createdAt > Date.now() ||
      Date.now() - metadata.createdAt > options.ttlMs ||
      info.size !== metadata.sizeBytes ||
      info.size > options.maxEntryBytes ||
      hash(await readFile(video)) !== metadata.sha256
    )
      throw new Error("invalid cache entry");
    await copyFile(video, destination);
    return true;
  } catch {
    await Promise.all([rm(video, { force: true }), rm(metadataPath, { force: true })]);
    return false;
  }
}

export async function writeCharacterRenderCache(
  root: string,
  key: string,
  source: string,
  options: { maxEntryBytes: number; maxTotalBytes: number; maxEntries: number },
) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid cache key");
  await mkdir(root, { recursive: true });
  if ((await stat(source)).size > options.maxEntryBytes) return false;
  const bytes = await readFile(source);
  if (bytes.byteLength > options.maxEntryBytes) return false;
  const video = join(root, `${key}.mp4`),
    metadataPath = join(root, `${key}.json`);
  await writeFile(video, bytes, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const metadata: Metadata = {
    sha256: hash(bytes),
    sizeBytes: bytes.byteLength,
    createdAt: Date.now(),
  };
  await writeFile(metadataPath, JSON.stringify(metadata));
  const entries = (await readdir(root)).filter((name) => /^[a-f0-9]{64}\.mp4$/.test(name));
  const sized = await Promise.all(
    entries.map(async (name) => ({ name, info: await stat(join(root, name)) })),
  );
  sized.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  let total = sized.reduce((sum, item) => sum + item.info.size, 0);
  for (const [index, item] of sized.entries())
    if (index >= options.maxEntries || total > options.maxTotalBytes) {
      await Promise.all([
        rm(join(root, item.name), { force: true }),
        rm(join(root, item.name.replace(/\.mp4$/, ".json")), { force: true }),
      ]);
      total -= item.info.size;
    }
  return true;
}
