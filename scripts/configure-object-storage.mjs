import { readFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";

const [sourcePath, deliveryPath] = process.argv.slice(2);
if (!sourcePath || !deliveryPath) {
  throw new Error("Usage: node scripts/configure-object-storage.mjs <source-credentials.json> <delivery-credentials.json>");
}

function bucketUrl(config) {
  const url = new URL(config.endpoint);
  if (config.urlStyle === "path") {
    url.pathname = `/${encodeURIComponent(config.bucketName)}`;
  } else {
    url.hostname = `${config.bucketName}.${url.hostname}`;
  }
  url.searchParams.set("cors", "");
  return url;
}

async function configureCors(config, origins, methods) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });
  const rules = origins
    .map(
      (origin) => `<CORSRule><AllowedOrigin>${origin}</AllowedOrigin>${methods
        .map((method) => `<AllowedMethod>${method}</AllowedMethod>`)
        .join("")}<AllowedHeader>Content-Type</AllowedHeader><AllowedHeader>x-amz-*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule>`,
    )
    .join("");
  const body = `<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${rules}</CORSConfiguration>`;
  const response = await client.fetch(bucketUrl(config), {
    method: "PUT",
    headers: { "content-type": "application/xml" },
    body,
  });
  if (!response.ok) {
    throw new Error(`CORS configuration failed for ${config.bucketName}: HTTP ${response.status} ${await response.text()}`);
  }
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const delivery = JSON.parse(await readFile(deliveryPath, "utf8"));
await configureCors(source, ["https://canvas.iota.uz", "http://localhost:5173"], ["GET", "HEAD", "PUT"]);
await configureCors(delivery, ["https://canvas.iota.uz", "http://localhost:5173"], ["GET", "HEAD"]);
console.log("Configured object-storage CORS for production and local development origins.");
