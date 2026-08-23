export function getWorkerConfig(): { url: string; token: string } {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) throw new Error("render worker is not configured");
  return { url: url.replace(/\/+$/, ""), token };
}

export async function callWorker<T>(
  config: { url: string; token: string },
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : response.statusText;
    throw new Error(`worker ${path} failed (${response.status}): ${message}`);
  }
  return json as T;
}

export function extractStorageId(body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "storageId" in body &&
    typeof (body as { storageId: unknown }).storageId === "string"
  ) {
    return (body as { storageId: string }).storageId;
  }
  throw new Error("worker upload did not return a storageId");
}
