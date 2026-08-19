import { AwsClient } from "aws4fetch";

export type ObjectStoreName = "source" | "delivery";

export interface ObjectStoreConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  urlStyle: "virtual" | "path";
}

function envPrefix(store: ObjectStoreName): string {
  return store === "source" ? "S3_SOURCE" : "S3_DELIVERY";
}

export function objectStoreConfigured(store: ObjectStoreName): boolean {
  const prefix = envPrefix(store);
  return Boolean(
    process.env[`${prefix}_ENDPOINT`] &&
      process.env[`${prefix}_BUCKET`] &&
      process.env[`${prefix}_ACCESS_KEY_ID`] &&
      process.env[`${prefix}_SECRET_ACCESS_KEY`],
  );
}

export function getObjectStoreConfig(store: ObjectStoreName): ObjectStoreConfig {
  const prefix = envPrefix(store);
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const bucket = process.env[`${prefix}_BUCKET`];
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(`${prefix} object storage is not configured`);
  }
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env[`${prefix}_REGION`] || "auto",
    urlStyle: process.env[`${prefix}_URL_STYLE`] === "path" ? "path" : "virtual",
  };
}

function encodeKey(key: string): string {
  if (!key || key.startsWith("/") || key.split("/").includes("..")) {
    throw new Error(`Invalid object key: ${key}`);
  }
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function objectUrl(config: ObjectStoreConfig, key: string): string {
  const endpoint = new URL(config.endpoint);
  const encoded = encodeKey(key);
  if (config.urlStyle === "path") {
    endpoint.pathname = `/${encodeURIComponent(config.bucket)}/${encoded}`;
    return endpoint.toString();
  }
  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `/${encoded}`;
  return endpoint.toString();
}

function client(config: ObjectStoreConfig): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
    retries: 2,
  });
}

export async function presignObject(
  store: ObjectStoreName,
  key: string,
  method: "GET" | "PUT",
  expiresSeconds = 900,
): Promise<string> {
  const config = getObjectStoreConfig(store);
  const url = new URL(objectUrl(config, key));
  url.searchParams.set("X-Amz-Expires", String(Math.max(1, Math.min(expiresSeconds, 604800))));
  const request = await client(config).sign(url.toString(), {
    method,
    aws: { signQuery: true, service: "s3", region: config.region },
  });
  return request.url;
}

export async function getObject(store: ObjectStoreName, key: string): Promise<Response> {
  const config = getObjectStoreConfig(store);
  return client(config).fetch(objectUrl(config, key), { method: "GET" });
}

export async function headObject(store: ObjectStoreName, key: string): Promise<Response> {
  const config = getObjectStoreConfig(store);
  return client(config).fetch(objectUrl(config, key), { method: "HEAD" });
}

export async function putObject(
  store: ObjectStoreName,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const config = getObjectStoreConfig(store);
  const response = await client(config).fetch(objectUrl(config, key), {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  if (!response.ok) {
    throw new Error(`Object upload failed (${store}/${key}): HTTP ${response.status}`);
  }
}

export async function deleteObject(store: ObjectStoreName, key: string): Promise<void> {
  const config = getObjectStoreConfig(store);
  const response = await client(config).fetch(objectUrl(config, key), { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object delete failed (${store}/${key}): HTTP ${response.status}`);
  }
}
