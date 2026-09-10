/** One-shot administrator migration. Default dry-run; never loads .env or writes the source. */

import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convertLegacyScenario } from "../convex/lib/videoMigration.ts";
import { canonical } from "../packages/video/src/contracts.ts";

const { values } = parseArgs({
  options: {
    backup: { type: "string" },
    "source-assets": { type: "string" },
    "expected-backup-sha": { type: "string" },
    "run-id": { type: "string" },
    "workspace-id": { type: "string" },
    "principal-id": { type: "string" },
    url: { type: "string" },
    environment: { type: "string", default: "local" },
    "confirm-production-url": { type: "string" },
    apply: { type: "boolean", default: false },
    "convex-cli": { type: "boolean", default: false },
    "convex-env-file": { type: "string" },
  },
});
const required = (name: keyof typeof values) => {
  const value = values[name];
  if (typeof value !== "string" || !value) throw new Error(`Required --${name}`);
  return value;
};
const digest = async (path: string) => {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
};
const backup = await realpath(required("backup")),
  assets = await realpath(required("source-assets")),
  expected = required("expected-backup-sha"),
  runId = required("run-id");
if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Invalid expected backup SHA256");
const actual = await digest(backup);
if (actual.sha256 !== expected)
  throw new Error("Source backup SHA256 mismatch; no writes attempted");
// immutable avoids journal/WAL creation or accidental reads from a changing live DB.
const sqliteUri = `file:${backup}?immutable=1`;
const readTable = (sql: string) =>
  JSON.parse(
    execFileSync("sqlite3", ["-json", sqliteUri, sql], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    }) || "[]",
  );
const tables = readTable(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
) as { name: string }[];
const unknownTables = tables.filter(
  (t) => !["records", "metadata", "review_requests"].includes(t.name),
);
if (unknownTables.length)
  throw new Error(
    `Unmapped source tables (${unknownTables.map((t) => t.name).join(", ")}); explicitly archive their schema and rows before importing`,
  );
const records = readTable("SELECT kind,id,data FROM records ORDER BY kind,id") as {
  kind: string;
  id: string;
  data: string;
}[];
const metadata = readTable("SELECT key,value FROM metadata ORDER BY key");
const reviewRequests = readTable("SELECT id,digest,result FROM review_requests ORDER BY id");
const sourceRun = records.find((r) => r.kind === "run" && r.id === runId);
if (!sourceRun) throw new Error("Requested source run absent");
if (records.filter((r) => r.kind === "run").length !== 1)
  throw new Error("This importer requires a single-run export; do not silently import other runs");
for (const record of records.filter((r) => r.kind === "version")) {
  const { id, hash, createdAt, ...input } = JSON.parse(record.data);
  if (id !== record.id || createHash("sha256").update(canonical(input)).digest("hex") !== hash)
    throw new Error(`Original version hash mismatch: ${record.id}`);
}
const inputAssets = records
  .filter((r) => r.kind === "asset")
  .map((r) => JSON.parse(r.data) as { hash: string; bytes: number; mime: string });
let totalBytes = 0;
const verified = [];
for (const asset of inputAssets) {
  if (!/^[a-f0-9]{64}$/.test(asset.hash)) throw new Error("Invalid asset filename hash");
  const path = await realpath(join(assets, asset.hash));
  if (path !== resolve(assets, asset.hash)) throw new Error("Source asset symlink escapes archive");
  if (!(await stat(path)).isFile()) throw new Error("Asset is not a file");
  const found = await digest(path);
  if (found.sha256 !== asset.hash || found.size !== asset.bytes)
    throw new Error(`Source bytes mismatch: ${asset.hash}`);
  verified.push({ ...asset, path });
  totalBytes += found.size;
}
const run = JSON.parse(sourceRun.data);
const nativePreflight = Object.entries(run.latest as Record<string, string>).map(
  ([language, id]) => {
    const version = JSON.parse(
      records.find((r) => r.kind === "version" && r.id === id)?.data ?? "null",
    );
    if (!version) throw new Error(`Latest ${language} version absent`);
    const converted = convertLegacyScenario(
      version.manifest.scenario,
      verified.map((a) => ({
        sha256: a.hash,
        sizeBytes: a.bytes,
        mimeType: a.mime,
        asset: { assetId: `preflight-${a.hash}`, revisionId: `preflight-${a.hash}` },
      })),
    );
    return {
      language,
      sourceVersionId: id,
      format: converted.format,
      durationFrames: converted.timeline.durationFrames,
      scenes: converted.script.sceneOrder.length,
      warning: converted.warning,
    };
  },
);
const archiveBytes = new TextEncoder().encode(
  JSON.stringify({
    format: "claude-reels-archive-v1",
    sourceBackupSha256: expected,
    records,
    metadata,
    reviewRequests,
  }),
);
if (archiveBytes.length > 700000)
  throw new Error("Archive too large for bounded one-shot import; split explicitly");
const archiveSha = createHash("sha256").update(archiveBytes).digest("hex");
const summary = {
  mode: values.apply ? "apply" : "dry-run",
  sourceBackupSha256: expected,
  runId,
  recordCounts: Object.fromEntries(
    [...new Set(records.map((r) => r.kind))].map((kind) => [
      kind,
      records.filter((r) => r.kind === kind).length,
    ]),
  ),
  assets: verified.length,
  totalBytes,
  archiveSha256: archiveSha,
  historicalJobs: "archive_only_never_resubmitted",
  historicalFeedbackIdentity: "preserved_not_verified",
  nativeRendering: "new_checkpoint_requires_new_render",
};
console.log(JSON.stringify({ ...summary, nativePreflight }));
if (values.apply) {
  const url = required("url"),
    parsed = new URL(url),
    workspaceId = required("workspace-id"),
    principalId = required("principal-id");
  if (values.environment === "local") {
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      parsed.protocol !== "http:"
    )
      throw new Error("Local mode requires an explicit loopback HTTP backend");
  } else if (values.environment === "production") {
    if (parsed.protocol !== "https:" || values["confirm-production-url"] !== url)
      throw new Error("Production apply requires exact --confirm-production-url matching --url");
  } else throw new Error("Environment must be local or production");
  let action: (name: string, args: Record<string, unknown>) => Promise<any>;
  let query: (name: string, args: Record<string, unknown>) => Promise<any>;
  if (values["convex-cli"]) {
    const deployment = /^([a-z0-9-]+)\.convex\.cloud$/.exec(parsed.hostname)?.[1];
    if (
      values.environment !== "production" ||
      !deployment ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(
        "CLI transport requires the exact confirmed HTTPS Convex production deployment origin",
      );
    const envFile = required("convex-env-file"),
      run = promisify(execFile);
    const invoke = async (name: string, args: Record<string, unknown>) => {
      try {
        const { stdout } = await run(
          resolve("node_modules/.bin/convex"),
          [
            "run",
            name,
            JSON.stringify(args),
            "--deployment",
            deployment,
            "--env-file",
            envFile,
            "--typecheck",
            "disable",
            "--codegen",
            "disable",
          ],
          {
            encoding: "utf8",
            maxBuffer: 2 * 1024 * 1024,
            timeout: 120000,
            env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
          },
        );
        return JSON.parse(stdout);
      } catch {
        throw new Error(
          `CLI migration call ${name} did not return a confirmed result; inspect the existing operation and rerun with the same source hash. Raw CLI output is suppressed.`,
        );
      }
    };
    action = invoke;
    query = invoke;
  } else {
    const key = process.env.MIGRATION_CONVEX_ADMIN_KEY;
    if (!key)
      throw new Error(
        "Supply MIGRATION_CONVEX_ADMIN_KEY in the administrator runtime; never in command arguments or files",
      );
    const client = new ConvexHttpClient(url);
    (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(key);
    action = (name: string, args: Record<string, unknown>) =>
      client.action(makeFunctionReference<"action">(name), args);
    query = (name: string, args: Record<string, unknown>) =>
      client.query(makeFunctionReference<"query">(name), args);
  }
  const upload = async (
    sha256: string,
    sizeBytes: number,
    mimeType: string,
    filename: string,
    path?: string,
  ) => {
    const reserved = await action("videoMedia:agentPrepareUpload", {
      videoPrincipalId: principalId,
      workspaceId,
      idempotencyKey: `migration:${expected}:${sha256}`,
      sha256,
      sizeBytes,
      mimeType,
      filename,
      source: "upload",
    });
    if (reserved.state === "ready") return reserved.asset;
    if (reserved.upload) {
      const body = path ? createReadStream(path) : archiveBytes;
      const response = await fetch(reserved.upload.url, {
        method: "PUT",
        headers: { ...reserved.upload.headers, "content-type": mimeType },
        body: body as unknown as BodyInit,
        ...(path ? { duplex: "half" } : {}),
      });
      if (!response.ok)
        throw new Error(`Upload failed HTTP${response.status}; rerun same import safely`);
    }
    await action("videoMedia:agentFinalizeUpload", {
      videoPrincipalId: principalId,
      uploadId: reserved.uploadId,
    });
    for (let i = 0; i < 180; i++) {
      const row = await query("videoMedia:agentGetUpload", {
        videoPrincipalId: principalId,
        uploadId: reserved.uploadId,
      });
      if (row.state === "ready") return row.asset;
      if (row.state === "failed")
        throw new Error(
          `Verification failed for ${sha256}; rerun to retry ingestion, not generation`,
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Verification still pending; rerun safely after checking the existing upload");
  };
  const assetMap = [];
  for (const asset of verified) {
    const ref = await upload(asset.hash, asset.bytes, asset.mime, asset.hash, asset.path);
    assetMap.push({ sha256: asset.hash, sizeBytes: asset.bytes, mimeType: asset.mime, asset: ref });
  }
  const archiveAsset = await upload(
    archiveSha,
    archiveBytes.length,
    "application/json",
    "claude-reels-source-archive.json",
  );
  const result = await action("videoMigration:migrate", {
    workspaceId,
    principalId,
    sourceBackupSha256: expected,
    sourceRunId: runId,
    archiveAsset,
    archiveSha256: archiveSha,
    assetMap,
  });
  console.log(JSON.stringify({ migration: result, verifiedBytes: totalBytes, providerCalls: 0 }));
}
