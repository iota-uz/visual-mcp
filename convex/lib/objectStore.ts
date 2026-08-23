import { AwsClient } from "aws4fetch";

export interface ObjectStoreConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  urlStyle: "virtual" | "path";
}

const ENV_PREFIX = "S3_ASSET";

export function objectStoreConfigured(): boolean {
  return Boolean(
    process.env[`${ENV_PREFIX}_ENDPOINT`] &&
      process.env[`${ENV_PREFIX}_BUCKET`] &&
      process.env[`${ENV_PREFIX}_ACCESS_KEY_ID`] &&
      process.env[`${ENV_PREFIX}_SECRET_ACCESS_KEY`],
  );
}

export function getObjectStoreConfig(): ObjectStoreConfig {
  const endpoint = process.env[`${ENV_PREFIX}_ENDPOINT`];
  const bucket = process.env[`${ENV_PREFIX}_BUCKET`];
  const accessKeyId = process.env[`${ENV_PREFIX}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${ENV_PREFIX}_SECRET_ACCESS_KEY`];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(`${ENV_PREFIX} object storage is not configured`);
  }
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env[`${ENV_PREFIX}_REGION`] || "auto",
    urlStyle: process.env[`${ENV_PREFIX}_URL_STYLE`] === "path" ? "path" : "virtual",
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
  key: string,
  method: "GET" | "PUT",
  expiresSeconds = 900,
): Promise<string> {
  const config = getObjectStoreConfig();
  const url = new URL(objectUrl(config, key));
  url.searchParams.set("X-Amz-Expires", String(Math.max(1, Math.min(expiresSeconds, 604800))));
  const request = await client(config).sign(url.toString(), {
    method,
    aws: { signQuery: true, service: "s3", region: config.region },
  });
  return request.url;
}

export async function getObject(key: string): Promise<Response> {
  const config = getObjectStoreConfig();
  return client(config).fetch(objectUrl(config, key), { method: "GET" });
}

export async function headObject(key: string): Promise<Response> {
  const config = getObjectStoreConfig();
  return client(config).fetch(objectUrl(config, key), { method: "HEAD" });
}

export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const config = getObjectStoreConfig();
  const response = await client(config).fetch(objectUrl(config, key), {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  if (!response.ok) {
    throw new Error(`Object upload failed (${key}): HTTP ${response.status}`);
  }
}

export async function deleteObject(key: string): Promise<void> {
  const config = getObjectStoreConfig();
  const response = await client(config).fetch(objectUrl(config, key), { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object delete failed (${key}): HTTP ${response.status}`);
  }
}
