/**
 * Thin client for the credential-free render worker (PLAN.md section 3/6).
 * The worker holds no Convex credential — every request carries short-lived
 * signed storage URLs instead, which is why callers pass `sources`/`upload`
 * URLs rather than any canvas identifier the worker could reuse.
 */

export interface WorkerConfig {
  url: string;
  token: string;
}

export function getWorkerConfig(): WorkerConfig {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) {
    throw new Error("render worker is not configured (WORKER_URL/WORKER_TOKEN unset)");
  }
  return { url: url.replace(/\/+$/, ""), token };
}

export async function callWorker<T>(config: WorkerConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : res.statusText;
    throw new Error(`worker ${path} failed (${res.status}): ${message}`);
  }
  return json as T;
}

/** Parses the `{storageId}` body Convex's upload URL returns, as forwarded by the worker. */
export function extractStorageId(uploadBody: unknown): string {
  if (
    uploadBody &&
    typeof uploadBody === "object" &&
    "storageId" in uploadBody &&
    typeof (uploadBody as { storageId: unknown }).storageId === "string"
  ) {
    return (uploadBody as { storageId: string }).storageId;
  }
  throw new Error("worker upload did not return a storageId");
}
