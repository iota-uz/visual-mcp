import { readFile } from "node:fs/promises";

export interface UploadResult {
  status: number;
  body: unknown;
}

/**
 * POSTs a file's bytes to a pre-signed, single-use upload URL — Convex's
 * `ctx.storage.generateUploadUrl()` contract requires POST, not PUT (see
 * convex/StorageWriter.generateUploadUrl's doc comment: "The client should
 * make a POST request to this URL with the file as the body"). The response
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
    method: "POST",
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
