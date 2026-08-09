import { readFile } from "node:fs/promises";

export interface UploadResult {
  status: number;
  body: unknown;
}

/**
 * PUTs a file's bytes to a pre-signed, single-use upload URL. The response
 * body is forwarded as-is (parsed as JSON when possible) rather than
 * interpreted here — Convex's upload endpoint shape is the caller's
 * concern, not this credential-free worker's (PLAN.md section 3).
 */
export async function uploadFile(
  putUrl: string,
  absolutePath: string,
  contentType: string,
): Promise<UploadResult> {
  const bytes = await readFile(absolutePath);
  const res = await fetch(putUrl, {
    method: "PUT",
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
