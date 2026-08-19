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
 * while this is. It re-seeds on every start.
 *
 * What it does NOT do: touch the live deployment, or read its credentials.
 * Nothing here runs `convex env set` without `--env-file .env.agent`.
 */

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AGENT_ENV = join(ROOT, ".env.agent");
const LIVE_ENV = join(ROOT, ".env.local");
const WEB_ENV = join(ROOT, "apps/web/.env.local");
const SEED_EMAIL = "agent@iota.uz";
const SEED_MCP_TOKEN = "vct_localdevagenttoken0000000000000000";

const argv = process.argv.slice(2);
const serve = !argv.includes("--no-serve");

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
  return withLiveEnvPreserved(() =>
    execFileSync("npx", ["convex", ...args], {
      cwd: ROOT,
      stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
      encoding: "utf8",
    }),
  );
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
  step("Creating a local Convex backend (first run — this downloads a binary)");
  withLiveEnvPreserved(() => {
    execFileSync(
      "npx",
      [
        "convex",
        "dev",
        "--once",
        "--configure",
        "new",
        "--project",
        "visual-mcp-agent",
        "--dev-deployment",
        "local",
        "--env-file",
        AGENT_ENV,
        // The push will fail on the first pass — no env vars are set yet —
        // and that is fine: all we want from this call is the deployment.
        "--typecheck",
        "disable",
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
  });
  // The deployment landed in .env.local (see withLiveEnvPreserved); the
  // restore already undid that, so take the values from the file the CLI
  // was asked to use, falling back to reading what it wrote.
  if (!existsSync(AGENT_ENV)) {
    throw new Error(
      `Convex did not write ${AGENT_ENV}. Run it once by hand to see what it is asking for:\n` +
        "  npx convex dev --once --configure new --dev-deployment local --env-file .env.agent",
    );
  }
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

const ENV = ["--env-file", AGENT_ENV];

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

const wanted = {
  DEV_AUTH_SECRET: devSecret,
  // Both are localhost here, and that is the point: SITE_URL is what Convex
  // Auth validates redirects against, and SPA_ORIGIN is what widens the
  // public canvas CSP's frame-ancestors so the viewer's iframe renders.
  SITE_URL: "http://localhost:5173",
  SPA_ORIGIN: "http://localhost:5173",
  // Not a real client id. auth.config.ts reads this variable unconditionally
  // and Convex refuses to push while it is unset; there is no Google sign-in
  // on this backend for it to be the audience of.
  GOOGLE_OAUTH_CLIENT_ID: "unused.local.invalid",
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
writeFileSync(
  WEB_ENV,
  [
    "# Written by scripts/dev-agent.mjs — the isolated local stack.",
    "# Delete this file to go back to the deployment in .env.",
    `VITE_CONVEX_URL=${convexUrl}`,
    `VITE_DEV_AUTH_SECRET=${devSecret}`,
    "",
  ].join("\n"),
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
      if (command.includes("convex-local-backend")) process.kill(Number(pid), "SIGTERM");
    } catch {
      /* gone already, or not ours to read */
    }
  }
}
stopStrayBackend(convexUrl);

// `--run` seeds once the push lands. Vite is spawned separately rather than
// through `--start`: the two flags share one slot in `convex dev`'s step 3,
// and seeding is the one that has to happen before the browser arrives.
const devArgs = ["convex", "dev", ...ENV, "--run", "seed:reset"];

const banner = `
  Stack is up.

  Sign in     http://localhost:5173/dev/sign-in?auto=1     (one navigation, no clicks)
  Primitives  http://localhost:5173/dev/kitchen-sink
  Fixtures    http://localhost:5173/?fixture=empty|loading|error   (needs VITE_FIXTURES=1)

  Signed in as   ${SEED_EMAIL}
  Backend        ${convexUrl}
  MCP endpoint   ${convexSiteUrl}/mcp
  MCP token      ${SEED_MCP_TOKEN}

    claude mcp add --transport http visual-canvas-local ${convexSiteUrl}/mcp \\
      --header "Authorization: Bearer ${SEED_MCP_TOKEN}"

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
if (serve)
  children.push(
    spawn("npm", ["run", "dev", "-w", "apps/web", "--", "--port", "5173", "--strictPort"], {
      cwd: ROOT,
      stdio: "inherit",
    }),
  );

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
for (const child of children) {
  child.on("exit", (code) => {
    clearInterval(guard);
    restoreLiveEnv();
    for (const other of children) {
      if (other !== child) other.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
}
