import { sha256HexBytes } from "./hash";

export const ASSET_MAX_BYTES = 25 * 1024 * 1024;

export const ASSET_MIME_TYPES = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/avif": "image",
  "image/gif": "image",
  "image/svg+xml": "svg",
  "font/woff2": "font",
  "font/woff": "font",
  "font/ttf": "font",
  "font/otf": "font",
  "video/mp4": "video",
  "video/webm": "video",
  "application/json": "data",
} as const;

export type AssetKind = (typeof ASSET_MIME_TYPES)[keyof typeof ASSET_MIME_TYPES];

function sniffMime(bytes: Uint8Array, declared: string): string {
  if (
    bytes.length >= 8 &&
    bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" ||
    new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a"
  )
    return "image/gif";
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")))
    return "image/svg+xml";
  if (head.startsWith("{") || head.startsWith("["))
    return declared === "application/json" ? declared : "application/octet-stream";
  return declared.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

export async function validateAssetBytes(
  bytes: Uint8Array,
  declaredMime: string,
): Promise<{ bytes: Uint8Array; mimeType: string; kind: AssetKind; contentHash: string }> {
  if (bytes.byteLength === 0) throw new Error("Asset is empty");
  if (bytes.byteLength > ASSET_MAX_BYTES) throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
  const mimeType = sniffMime(bytes, declaredMime);
  const kind = ASSET_MIME_TYPES[mimeType as keyof typeof ASSET_MIME_TYPES];
  if (!kind) throw new Error(`Unsupported asset MIME type: ${mimeType}`);
  return {
    bytes,
    mimeType,
    kind,
    contentHash: await sha256HexBytes(bytes),
  };
}

export function assertSafeImportUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Asset imports require an HTTPS URL");
  if (url.username || url.password) throw new Error("Asset import URLs cannot contain credentials");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "metadata.google.internal"
  ) {
    throw new Error("Asset import URL resolves to a forbidden host");
  }
  return url;
}
