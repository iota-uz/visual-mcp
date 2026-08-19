import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { AssetImportRequest } from "./schemas.js";

type ResolvedAddress = { address: string; family: 4 | 6 };

export function isForbiddenImportAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "::" || normalized === "0.0.0.0") return true;
  if (/^(?:127|10)\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  if (/^169\.254\./.test(normalized) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(normalized))
    return true;
  if (/^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/i.test(normalized)) return true;
  return false;
}

function validateUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Asset imports require an HTTPS URL");
  if (url.username || url.password) throw new Error("Asset import URLs cannot contain credentials");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Asset import URL resolves to a forbidden host");
  }
  if (isIP(host) && isForbiddenImportAddress(host)) {
    throw new Error("Asset import URL resolves to a forbidden host");
  }
  return url;
}

async function resolvePublicAddress(hostname: string): Promise<ResolvedAddress> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isForbiddenImportAddress(entry.address))
  ) {
    throw new Error("Asset import hostname resolves to a forbidden network");
  }
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new Error("Asset import hostname has no usable address");
  }
  return { address: selected.address, family: selected.family };
}

async function downloadOnce(
  url: URL,
  maxBytes: number,
): Promise<{ bytes?: Uint8Array; mimeType?: string; redirect?: string }> {
  const resolved = await resolvePublicAddress(url.hostname);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: resolved.address,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        headers: {
          accept: "*/*",
          host: url.host,
          "user-agent": "Visual-Canvas-Asset-Importer/1.0",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ redirect: response.headers.location });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Asset import failed: HTTP ${status}`));
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          response.destroy();
          reject(new Error(`Asset exceeds ${maxBytes} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxBytes) {
            response.destroy(new Error(`Asset exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            bytes: new Uint8Array(Buffer.concat(chunks)),
            mimeType: String(response.headers["content-type"] ?? "application/octet-stream"),
          }),
        );
      },
    );
    req.setTimeout(20_000, () => req.destroy(new Error("Asset import timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function handleAssetImport(input: AssetImportRequest) {
  let url = validateUrl(input.url);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const result = await downloadOnce(url, input.maxBytes);
    if (result.redirect) {
      url = validateUrl(new URL(result.redirect, url).toString());
      continue;
    }
    if (!result.bytes || !result.mimeType) throw new Error("Asset import returned no bytes");
    const uploaded = await fetch(input.upload.putUrl, {
      method: "PUT",
      headers: { "content-type": result.mimeType },
      body: result.bytes,
    });
    if (!uploaded.ok) throw new Error(`Asset staging upload failed: HTTP ${uploaded.status}`);
    return { finalUrl: url.toString(), mimeType: result.mimeType, size: result.bytes.byteLength };
  }
  throw new Error("Asset import has too many redirects");
}
