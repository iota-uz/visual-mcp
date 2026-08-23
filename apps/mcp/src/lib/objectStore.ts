import { AwsClient } from "aws4fetch";

type Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  urlStyle: "virtual" | "path";
};

function config(): Config {
  const endpoint = process.env.S3_ASSET_ENDPOINT;
  const bucket = process.env.S3_ASSET_BUCKET;
  const accessKeyId = process.env.S3_ASSET_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_ASSET_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error("S3_ASSET object storage is not configured");
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_ASSET_REGION || "auto",
    urlStyle: process.env.S3_ASSET_URL_STYLE === "path" ? "path" : "virtual",
  };
}

function objectUrl(c: Config, key: string): string {
  if (!key || key.startsWith("/") || key.split("/").includes(".."))
    throw new Error(`Invalid object key: ${key}`);
  const url = new URL(c.endpoint);
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  if (c.urlStyle === "path") url.pathname = `/${encodeURIComponent(c.bucket)}/${encoded}`;
  else {
    url.hostname = `${c.bucket}.${url.hostname}`;
    url.pathname = `/${encoded}`;
  }
  return url.toString();
}

function client(c: Config): AwsClient {
  return new AwsClient({
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    service: "s3",
    region: c.region,
    retries: 2,
  });
}

export async function presignObject(
  key: string,
  method: "GET" | "PUT",
  expiresSeconds = 900,
): Promise<string> {
  const c = config();
  const url = new URL(objectUrl(c, key));
  url.searchParams.set("X-Amz-Expires", String(Math.max(1, Math.min(expiresSeconds, 604800))));
  return (
    await client(c).sign(url.toString(), {
      method,
      aws: { signQuery: true, service: "s3", region: c.region },
    })
  ).url;
}

export async function getObject(key: string): Promise<Response> {
  const c = config();
  return client(c).fetch(objectUrl(c, key), { method: "GET" });
}
export async function headObject(key: string): Promise<Response> {
  const c = config();
  return client(c).fetch(objectUrl(c, key), { method: "HEAD" });
}
export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const c = config();
  const response = await client(c).fetch(objectUrl(c, key), {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  if (!response.ok) throw new Error(`Object upload failed (${key}): HTTP ${response.status}`);
}
export async function deleteObject(key: string): Promise<void> {
  const c = config();
  const response = await client(c).fetch(objectUrl(c, key), { method: "DELETE" });
  if (!response.ok && response.status !== 404)
    throw new Error(`Object delete failed (${key}): HTTP ${response.status}`);
}
