#!/usr/bin/env node
/**
 * Brings up an isolated local stack an agent can drive on its own, and
 * leaves the live deployment strictly alone.
 *
 * The problem it solves: every authenticated surface in this app sits behind
 * Google OAuth restricted to @iota.uz, and this project's *live* deployment
 * is the dev one — so "just run it locally" meant pointing the SPA at
 * production, asking a human to sign in by hand, and still not being able to
 * see a kind=canvas viewport (there isn't one up there) or render the
 * viewer's iframe (production CSP allows one origin, and localhost is not
 * it). This script gives you your own backend instead: own database, own
 * SITE_URL, own SPA_ORIGIN, own sign-in that needs no Google.
 *
 * Usage:
 *   npm run dev:agent                # backend + seed + dev server on :5173
 *   npm run dev:agent -- --no-serve  # same, without the dev server
 *
 * Both forms keep running until you stop them: a local Convex deployment is
 * a child process of `convex dev`, not a service, so the stack is only up
 * while this is. Only a newly created isolated deployment is seeded.
 *
 * What it does NOT do: touch the live deployment, or read its credentials.
 * Nothing here runs `convex env set` without `--env-file .env.agent`.
 */

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AGENT_ENV = resolve(process.env.VIDEO_AGENT_ENV_FILE ?? join(ROOT, ".env.agent"));
const LIVE_ENV = join(ROOT, ".env.local");
const WEB_ENV = resolve(process.env.VIDEO_AGENT_WEB_ENV_FILE ?? join(ROOT, "apps/web/.env.local"));
const CLOUD_PORT = Number(process.env.VIDEO_AGENT_CLOUD_PORT ?? 3210);
const SITE_PORT = Number(process.env.VIDEO_AGENT_SITE_PORT ?? 3211);
const WEB_PORT = Number(process.env.VIDEO_AGENT_WEB_PORT ?? 5173);
const MCP_PORT = Number(process.env.VIDEO_AGENT_MCP_PORT ?? 3212);
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const PORT_ARGS = [
  "--local-cloud-port",
  String(CLOUD_PORT),
  "--local-site-port",
  String(SITE_PORT),
];
const TEMP_ROOT = process.env.VIDEO_AGENT_TMP_ROOT;
if (!TEMP_ROOT || !TEMP_ROOT.startsWith("/"))
  throw new Error("Set VIDEO_AGENT_TMP_ROOT to an explicit temporary output directory.");
mkdirSync(TEMP_ROOT, { recursive: true });
// Current Convex stores one local deployment per checkout. An alternate env
// selects that existing local database; it must never imply a fresh database.
const freshDeployment = false;
const SEED_EMAIL = "agent@iota.uz";
const LOCAL_ASSET_PORT = Number(process.env.VIDEO_AGENT_ASSET_PORT ?? 3213);
const LOCAL_ASSET_BUCKET = "visual-canvas-agent";
const LOCAL_ASSET_ENDPOINT = `http://127.0.0.1:${LOCAL_ASSET_PORT}`;
const LOCAL_ASSET_ACCESS_KEY = "visual-canvas-local";
const LOCAL_ASSET_SECRET_KEY = "visual-canvas-local-secret";

const argv = process.argv.slice(2);
const serve = !argv.includes("--no-serve");
for (const port of [CLOUD_PORT, SITE_PORT, WEB_PORT, MCP_PORT, LOCAL_ASSET_PORT])
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Local stack ports must be integers 1024–65535.");
if (new Set([CLOUD_PORT, SITE_PORT, WEB_PORT, MCP_PORT, LOCAL_ASSET_PORT]).size !== 5)
  throw new Error("Each local service needs its own port.");

function step(message) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

/*
 * `convex dev` rewrites .env.local with whatever deployment it just talked
 * to, and it does so even when the deployment came from --env-file. Left
 * alone, one `npm run dev:agent` would silently repoint every *other*
 * convex command in this repo — `npx convex env list`, the deploy step — at
 * the local backend. So: snapshot before, restore after, every time.
 */
function withLiveEnvPreserved(fn) {
  const had = existsSync(LIVE_ENV);
  const before = had ? readFileSync(LIVE_ENV, "utf8") : null;
  try {
    return fn();
  } finally {
    if (before !== null) writeFileSync(LIVE_ENV, before);
    else if (existsSync(LIVE_ENV)) rmSync(LIVE_ENV);
  }
}

function convex(args, opts = {}) {
  return withLiveEnvPreserved(() => {
    try {
      const output = execFileSync("npx", ["convex", ...args], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
      if (!opts.capture && !(args[0] === "env" && args.includes("set")))
        process.stdout.write(output);
      return output;
    } catch {
      // Never expose execFileSync's error: it embeds argv, including env secrets.
      throw new Error(
        `Local Convex ${args[0] ?? "operation"} failed. Arguments and output were withheld to protect credentials.`,
      );
    }
  });
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    // Convex appends a `# team: …, project: …` comment to CONVEX_DEPLOYMENT.
    if (match) out[match[1]] = match[2].replace(/\s+#.*$/, "").trim();
  }
  return out;
}

// ---------------------------------------------------------------- deployment

if (!existsSync(AGENT_ENV)) {
  const configPath = join(ROOT, ".convex/local/default/config.json");
  if (!existsSync(configPath))
    throw new Error(
      "No project-local Convex deployment exists. Configure one explicitly first; this script never creates a cloud project.",
    );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (typeof config.deploymentName !== "string" || !config.deploymentName.startsWith("local-"))
    throw new Error("Expected an existing linked local deployment; no deployment was changed.");
  writeFileSync(
    AGENT_ENV,
    `CONVEX_DEPLOYMENT=local:${config.deploymentName}\nCONVEX_URL=http://127.0.0.1:${CLOUD_PORT}\nCONVEX_SITE_URL=http://127.0.0.1:${SITE_PORT}\n`,
    { mode: 0o600, flag: "wx" },
  );
}

const agentEnv = readEnvFile(AGENT_ENV);
const deployment = agentEnv.CONVEX_DEPLOYMENT;
const convexUrl = agentEnv.CONVEX_URL;
const convexSiteUrl = agentEnv.CONVEX_SITE_URL;
if (!deployment || !convexUrl || !convexSiteUrl) {
  throw new Error(`${AGENT_ENV} is missing CONVEX_DEPLOYMENT / CONVEX_URL / CONVEX_SITE_URL.`);
}
if (!deployment.startsWith("local:")) {
  // A cloud deployment here would mean the next steps set DEV_AUTH_SECRET on
  // something real and then wipe its database. Refuse outright.
  throw new Error(
    `${AGENT_ENV} points at "${deployment}", which is not a local deployment. ` +
      "Delete the file and re-run to create one.",
  );
}
if (
  !["127.0.0.1", "localhost"].includes(new URL(convexUrl).hostname) ||
  Number(new URL(convexUrl).port) !== CLOUD_PORT ||
  !["127.0.0.1", "localhost"].includes(new URL(convexSiteUrl).hostname) ||
  Number(new URL(convexSiteUrl).port) !== SITE_PORT
)
  throw new Error(
    "Selected agent env does not match the explicit local ports. Use a separate env file for a separate stack.",
  );

const ENV = ["--env-file", AGENT_ENV];
// Apply explicit port selection before env subcommands (which otherwise use
// the stored default ports). No --configure: it conflicts with --env-file.
step("Starting existing local deployment on the requested ports (without seeding)");
convex(["dev", "--once", ...ENV, ...PORT_ARGS, "--typecheck", "disable"]);

// ------------------------------------------------------------------ env vars

step(`Configuring ${deployment}`);
const existing = Object.fromEntries(
  convex(["env", ...ENV, "list"], { capture: true })
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);

// Generated once and reused, so a re-run doesn't invalidate the session in
// a browser that is already signed in.
const devSecret = existing.DEV_AUTH_SECRET || randomBytes(24).toString("base64url");
const gatewaySecret = existing.AGENT_GATEWAY_SECRET || randomBytes(32).toString("base64url");

const wanted = {
  DEV_AUTH_SECRET: devSecret,
  AGENT_GATEWAY_SECRET: gatewaySecret,
  // Both are localhost here, and that is the point: SITE_URL is what Convex
  // Auth validates redirects against, and SPA_ORIGIN is what widens the
  // public canvas CSP's frame-ancestors so the viewer's iframe renders.
  SITE_URL: WEB_ORIGIN,
  SPA_ORIGIN: WEB_ORIGIN,
  // Not a real client id. auth.config.ts reads this variable unconditionally
  // and Convex refuses to push while it is unset; there is no Google sign-in
  // on this backend for it to be the audience of.
  GOOGLE_OAUTH_CLIENT_ID: "unused.local.invalid",
  // A tiny S3-compatible server owned by this process backs reusable media.
  // It accepts signed requests but intentionally does not verify their local
  // development credentials. Production always uses the Railway bucket.
  S3_ASSET_ENDPOINT: LOCAL_ASSET_ENDPOINT,
  S3_ASSET_BUCKET: LOCAL_ASSET_BUCKET,
  S3_ASSET_ACCESS_KEY_ID: LOCAL_ASSET_ACCESS_KEY,
  S3_ASSET_SECRET_ACCESS_KEY: LOCAL_ASSET_SECRET_KEY,
  S3_ASSET_REGION: "local",
  S3_ASSET_URL_STYLE: "path",
};

for (const [name, value] of Object.entries(wanted)) {
  if (existing[name] === value) continue;
  convex(["env", ...ENV, "set", "--", name, value]);
}

if (!existing.JWT_PRIVATE_KEY || !existing.JWKS) {
  step("Generating session-signing keys");
  withLiveEnvPreserved(() =>
    execFileSync("node", [join(ROOT, "scripts/setup-auth-keys.mjs"), ...ENV], {
      cwd: ROOT,
      stdio: "inherit",
    }),
  );
}

// ------------------------------------------------------------------ SPA env

// .env.local wins over .env in Vite, so this overrides the checked-in
// pointer at the live deployment without editing it.
const webSnapshot = existsSync(WEB_ENV) ? readFileSync(WEB_ENV, "utf8") : null;
writeFileSync(
  WEB_ENV,
  [
    "# Written by scripts/dev-agent.mjs — the isolated local stack.",
    "# Delete this file to go back to the deployment in .env.",
    `VITE_CONVEX_URL=${convexUrl}`,
    `VITE_DEV_AUTH_SECRET=${devSecret}`,
    `VITE_MCP_URL=http://localhost:${MCP_PORT}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

// ------------------------------------------------------------------- serving

/*
 * A local Convex deployment is a child of `convex dev` — it exits when that
 * command does, so `--once` pushes the functions and then leaves you with a
 * backend that is not listening. The stack is therefore a long-running
 * process, and this is it: watch mode pushes, seeds via --run, and starts
 * Vite via --start, all under one Ctrl-C.
 */
/*
 * The backend binary outlives the CLI call that started it — every
 * `convex env set` above leaves one listening — and watch mode refuses to
 * start while the port is taken ("A local backend is still running on port
 * 3210"). Clear it, but only a process that is actually the Convex backend:
 * `lsof` on a port also lists whatever browser tab happens to be connected
 * to it.
 */
function stopStrayBackend(url) {
  const port = new URL(url).port;
  if (!port) return;
  let pids;
  try {
    pids = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" }).split("\n");
  } catch {
    return; // nothing listening
  }
  for (const pid of pids.filter(Boolean)) {
    try {
      const command = execFileSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" });
      if (
        command.includes("convex-local-backend") &&
        command.includes(deployment.slice("local:".length))
      )
        process.kill(Number(pid), "SIGTERM");
      // Never stop a different deployment or another kind of listener.
    } catch {
      /* gone already, or not ours to read */
    }
  }
}
stopStrayBackend(convexUrl);

// ---------------------------------------------------------- local asset S3

const assetRoot = join(TEMP_ROOT, "local-assets");
mkdirSync(assetRoot, { recursive: true });
const assetServer = createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", LOCAL_ASSET_ENDPOINT);
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.shift() !== LOCAL_ASSET_BUCKET || parts.length === 0 || parts.includes("..")) {
      response.writeHead(404).end();
      return;
    }
    const filePath = resolve(assetRoot, ...parts);
    if (!filePath.startsWith(`${resolve(assetRoot)}/`)) {
      response.writeHead(400).end();
      return;
    }
    const metadataPath = `${filePath}.meta.json`;
    response.setHeader("access-control-allow-origin", WEB_ORIGIN);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-methods", "GET, HEAD, PUT, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("access-control-expose-headers", "etag, content-length");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "PUT") {
      const expected = Number(request.headers["content-length"]);
      if (!Number.isSafeInteger(expected) || expected < 1 || expected > 2_000_000_000) {
        response.writeHead(413).end();
        return;
      }
      mkdirSync(dirname(filePath), { recursive: true });
      const partialPath = `${filePath}.partial-${randomBytes(8).toString("hex")}`;
      let received = 0;
      const bound = new Transform({
        transform(chunk, _encoding, done) {
          received += chunk.length;
          done(received > expected ? new Error("Upload size exceeded") : null, chunk);
        },
      });
      void pipeline(request, bound, createWriteStream(partialPath, { flags: "wx" }))
        .then(() => {
          if (received !== expected) throw new Error("Incomplete bytes");
          renameSync(partialPath, filePath);
          writeFileSync(
            metadataPath,
            JSON.stringify({
              contentType: request.headers["content-type"] || "application/octet-stream",
            }),
          );
          response.writeHead(200, { etag: `"local-${received}"` }).end();
        })
        .catch(() => {
          rmSync(partialPath, { force: true });
          if (!response.headersSent) response.writeHead(400).end("Incomplete upload");
        });
      return;
    }
    if (request.method === "DELETE") {
      rmSync(filePath, { force: true });
      rmSync(metadataPath, { force: true });
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (!existsSync(filePath)) {
        response.writeHead(404).end();
        return;
      }
      const metadata = existsSync(metadataPath)
        ? JSON.parse(readFileSync(metadataPath, "utf8"))
        : { contentType: "application/octet-stream" };
      response.writeHead(200, {
        "content-type": metadata.contentType,
        "content-length": statSync(filePath).size,
        "cache-control": "public, max-age=31536000, immutable",
      });
      if (request.method === "HEAD") response.end();
      else void pipeline(createReadStream(filePath), response).catch(() => response.destroy());
      return;
    }
    response.writeHead(405).end();
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" }).end(String(error));
  }
});
await new Promise((resolveListening, reject) => {
  assetServer.once("error", reject);
  assetServer.listen(LOCAL_ASSET_PORT, "127.0.0.1", resolveListening);
});

// `--run` seeds once the push lands. Vite is spawned separately rather than
// through `--start`: the two flags share one slot in `convex dev`'s step 3,
// and seeding is the one that has to happen before the browser arrives.
const devArgs = [
  "convex",
  "dev",
  ...ENV,
  ...PORT_ARGS,
  ...(freshDeployment ? ["--run", "seed:reset"] : []),
];

const banner = `
  Stack is up.

  Sign in     ${WEB_ORIGIN}/dev/sign-in?auto=1     (one navigation, no clicks)
  Primitives  ${WEB_ORIGIN}/dev/kitchen-sink
  Fixtures    ${WEB_ORIGIN}/?fixture=empty|loading|error   (needs VITE_FIXTURES=1)

  Signed in as   ${SEED_EMAIL}
  Backend        ${convexUrl}
  MCP endpoint   http://localhost:${MCP_PORT}/mcp
  Existing local data is preserved; only a fresh deployment is seeded.

  canvas_save writes and shows up in the UI. Renders do not run here (no
  apps/worker, so WORKER_URL is unset) — asking for one returns
  status: "partial" with a render_failed warning; the content is still saved.

  The live deployment was not touched. Re-run this any time; it is idempotent.
  Leave this running — the local backend is a child of it.
`;
console.log(banner);

step(serve ? "Running (backend + seed + dev server)" : "Running (backend + seed)");

/*
 * `convex dev` rewrites .env.local when it starts, and here it is not a
 * command that returns — so the snapshot-and-restore that wraps every other
 * call has nothing to hang off. Watch the file instead for as long as the
 * stack is up. It only gets written at startup in practice; the interval is
 * what makes that an observation rather than an assumption.
 */
const liveSnapshot = existsSync(LIVE_ENV) ? readFileSync(LIVE_ENV, "utf8") : null;
function restoreLiveEnv() {
  if (liveSnapshot === null) {
    if (existsSync(LIVE_ENV)) rmSync(LIVE_ENV);
  } else if (!existsSync(LIVE_ENV) || readFileSync(LIVE_ENV, "utf8") !== liveSnapshot) {
    writeFileSync(LIVE_ENV, liveSnapshot);
  }
}
const guard = setInterval(restoreLiveEnv, 500);
guard.unref?.();

const children = [spawn("npx", devArgs, { cwd: ROOT, stdio: "inherit" })];
const localAssetEnv = {
  S3_ASSET_ENDPOINT: LOCAL_ASSET_ENDPOINT,
  S3_ASSET_BUCKET: LOCAL_ASSET_BUCKET,
  S3_ASSET_ACCESS_KEY_ID: LOCAL_ASSET_ACCESS_KEY,
  S3_ASSET_SECRET_ACCESS_KEY: LOCAL_ASSET_SECRET_KEY,
  S3_ASSET_REGION: "local",
  S3_ASSET_URL_STYLE: "path",
};
children.push(
  spawn("npm", ["run", "dev", "-w", "apps/mcp"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(MCP_PORT),
      CONVEX_SITE_URL: convexSiteUrl,
      SPA_ORIGIN: WEB_ORIGIN,
      AGENT_GATEWAY_SECRET: gatewaySecret,
      ...localAssetEnv,
    },
  }),
);
if (serve)
  children.push(
    spawn(
      "npm",
      ["run", "dev", "-w", "apps/web", "--", "--port", String(WEB_PORT), "--strictPort"],
      {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          VITE_CONVEX_URL: convexUrl,
          VITE_DEV_AUTH_SECRET: devSecret,
          VITE_MCP_URL: `http://localhost:${MCP_PORT}`,
        },
      },
    ),
  );

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
    assetServer.close();
    if (webSnapshot === null) {
      if (existsSync(WEB_ENV)) rmSync(WEB_ENV);
    } else writeFileSync(WEB_ENV, webSnapshot, { mode: 0o600 });
  });
}
for (const child of children) {
  child.on("exit", (code) => {
    clearInterval(guard);
    restoreLiveEnv();
    assetServer.close();
    if (webSnapshot === null) {
      if (existsSync(WEB_ENV)) rmSync(WEB_ENV);
    } else writeFileSync(WEB_ENV, webSnapshot, { mode: 0o600 });
    for (const other of children) {
      if (other !== child) other.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
}
