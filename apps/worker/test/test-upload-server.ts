import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedUpload {
  path: string;
  bytes: Buffer;
  contentType: string | undefined;
}

export interface TestUploadServer {
  baseUrl: string;
  uploads: RecordedUpload[];
  putUrl(id: string): string;
  close(): Promise<void>;
}

/** A minimal stand-in for Convex's pre-signed upload URLs: POST -> {storageId}. */
export async function startTestUploadServer(): Promise<TestUploadServer> {
  const uploads: RecordedUpload[] = [];

  const server: Server = createServer((req, res) => {
    // Real Convex upload URLs only accept POST (StorageWriter.generateUploadUrl's
    // doc comment) — enforcing that here is what would have caught the
    // PUT-vs-POST bug in upload.ts before it ever reached a real deployment.
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `expected POST, got ${req.method}` }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bytes = Buffer.concat(chunks);
      uploads.push({ path: req.url ?? "", bytes, contentType: req.headers["content-type"] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ storageId: req.url }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    uploads,
    putUrl: (id: string) => `${baseUrl}/${id}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
