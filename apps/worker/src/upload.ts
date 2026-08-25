import { readFile } from "node:fs/promises";

export interface UploadResult {
  status: number;
  body: unknown;
}

/**
 * Uploads bytes through a caller-provided signed URL. Convex Storage uses
 * POST; cached embed PNGs in the private asset S3 bucket use PUT. The method
 * is part of the signed-upload contract so the credential-free worker
 * supports both without learning either backend's credentials.
 */
export async function uploadFile(
  putUrl: string,
  absolutePath: string,
  contentType: string,
  method: "POST" | "PUT" = "POST",
): Promise<UploadResult> {
  return uploadBytes(putUrl, await readFile(absolutePath), contentType, method);
}

/** Same contract as `uploadFile`, for bytes that were never written to disk (e.g. a thumbnail). */
export async function uploadBytes(
  putUrl: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
  method: "POST" | "PUT" = "POST",
): Promise<UploadResult> {
  const res = await fetch(putUrl, {
    method,
    headers: { "content-type": contentType },
    body: bytes,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}
