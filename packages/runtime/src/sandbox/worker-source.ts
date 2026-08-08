/**
 * Source of the sandbox worker, run inside a `node:worker_threads` Worker
 * via `{ eval: true }` (see run-code.ts).
 *
 * WHY A STRING INSTEAD OF A SIBLING .ts/.js FILE ON DISK
 * --------------------------------------------------------------------
 * This project runs from TypeScript source in dev/test via `tsx`
 * (`node --import tsx --test ...`, per package.json). `tsx` registers its
 * loader hooks (via `node:module`'s `register()`) in the *main* thread
 * only; empirically, on Node v22.14.0, those hooks do **not** propagate
 * to a `Worker`'s own entry-point resolution even when the same
 * `--import tsx` flag is forwarded via `execArgv` — a `new Worker(new
 * URL("./x.ts", ...))`, and even `require()`/`import()` of a `.ts` file
 * from *inside* an already-running worker, both fail with
 * `ERR_UNKNOWN_FILE_EXTENSION`. (Verified directly against this Node
 * version; not merely assumed.) Shipping the worker as a real `.js` file
 * on disk would also require teaching `tsc` to copy a non-`.ts` asset
 * into `dist/`, which means touching `tsconfig.json`'s `include`/
 * `allowJs` for a single file.
 *
 * The simplest option that works identically in dev (`tsx`) and after
 * `tsc` build, with zero build-config changes, is to keep the worker body
 * as an ordinary JS **string constant** inside a normal `.ts` module and
 * hand it to `new Worker(WORKER_SOURCE, { eval: true, ... })`. Eval-mode
 * workers run as plain CommonJS scripts (`require`/`module`/`exports`
 * available), which is exactly what we want — see run-code.ts, which
 * `require.resolve()`s the three allowlisted packages in the *parent*
 * thread (where normal TS/tsx module resolution works fine) and passes
 * their absolute paths in via `workerData`, so the worker body itself
 * never needs module resolution beyond `require(<absolute path>)`.
 *
 * Trade-off, stated honestly: the code below is unchecked by `tsc` (it's
 * just a string) and has no syntax highlighting. Keep it small and
 * boring. It intentionally duplicates a slimmed-down copy of
 * path-guard.ts's confinement rule (see resolveInWorkspace below) instead
 * of importing that module, for the same reason described above — it
 * would need to be loaded as a `.ts` module from inside the worker.
 *
 * SANDBOX SURFACE PROVIDED TO USER CODE (see also run-code.ts doc comment):
 *   - console.{log,info,warn,error}   -> captured into stdout/stderr strings
 *   - require(name)                   -> the allowlisted packages
 *                                        (apexcharts, @terrastruct/d2,
 *                                        tailwindcss), safe Node builtins
 *                                        (path, buffer, util, assert), and
 *                                        network builtins (http, https,
 *                                        net, dns, tls) — see "NETWORK
 *                                        SANDBOXING REMOVED" below
 *   - fetch, WebSocket                -> the worker thread's real globals,
 *                                        i.e. genuine outbound network
 *                                        access (see below)
 *   - fs.{readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync}
 *                                      -> confined to the session
 *                                         workspace; writes further
 *                                         confined to /src and /output
 *   - module, exports                 -> plain inert objects (CommonJS
 *                                         convention), not linked to the
 *                                         real module system
 *   - Buffer, TextEncoder/Decoder, URL, URLSearchParams, timers, Promise
 *
 * NETWORK SANDBOXING REMOVED: `fetch`/`WebSocket` globals and
 * `require("http"|"https"|"net"|"dns"|"tls")` are deliberately exposed —
 * user code can make arbitrary outbound network calls. PLAN.md section 9's
 * "no external network" default has been dropped by explicit request; see
 * project history. `XMLHttpRequest` has no Node built-in equivalent and
 * remains absent (use `fetch`).
 *
 * Everything else — `process`, `global`/`globalThis` escape hatches,
 * `require("child_process")` (shell access), `require("worker_threads")`,
 * `require("vm")`, dynamic `eval`/`new Function` (blocked at the
 * vm.Context level via `codeGeneration: { strings: false }`) — is still
 * absent from the vm context and/or rejected by the allowlist `require`.
 * These are unrelated to network access (no-shell-access /
 * no-sandbox-escape guarantees, per PLAN.md section 9) and were not part
 * of this request.
 */

export const WORKER_SOURCE = `
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const fsSync = require("node:fs");
const nodePath = require("node:path");
const nodeUtil = require("node:util");

const workspaceRoot = nodePath.resolve(workerData.workspaceRoot);
const allowlistPaths = workerData.allowlistPaths || {};
const timeoutMs = workerData.timeoutMs;

let stdout = "";
let stderr = "";
let resultSent = false;

function formatArgs(args) {
  return args
    .map(function (a) {
      return typeof a === "string" ? a : nodeUtil.inspect(a, { depth: 4 });
    })
    .join(" ");
}

function sendResult(result) {
  if (resultSent) return;
  resultSent = true;
  parentPort.postMessage(result);
}

// Slimmed-down duplicate of path-guard.ts's resolveWorkspacePath — see
// this file's header comment for why it is duplicated rather than
// imported. Keep the two in sync when either changes.
function resolveInWorkspace(requestedPath, mode) {
  if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
    throw new Error("Path must be a non-empty string");
  }
  const relative = requestedPath.replace(/^[\\/\\\\]+/, "");
  if (relative.length === 0) {
    throw new Error("Path must not be the workspace root itself: " + requestedPath);
  }
  const resolved = nodePath.resolve(workspaceRoot, relative);
  const rootWithSep = workspaceRoot + nodePath.sep;
  if (resolved !== workspaceRoot && resolved.indexOf(rootWithSep) !== 0) {
    throw new Error("Path escapes session workspace: " + requestedPath);
  }
  if (mode === "write") {
    const relFromRoot = nodePath.relative(workspaceRoot, resolved);
    const topDir = relFromRoot.split(nodePath.sep)[0];
    if (topDir !== "src" && topDir !== "output") {
      throw new Error("Writes are only allowed under /src or /output (got: " + requestedPath + ")");
    }
  }
  return resolved;
}

const scopedFs = {
  readFileSync: function (p, opts) {
    return fsSync.readFileSync(resolveInWorkspace(p, "read"), opts || "utf8");
  },
  writeFileSync: function (p, data) {
    const abs = resolveInWorkspace(p, "write");
    fsSync.mkdirSync(nodePath.dirname(abs), { recursive: true });
    fsSync.writeFileSync(abs, data);
  },
  mkdirSync: function (p, opts) {
    return fsSync.mkdirSync(resolveInWorkspace(p, "write"), opts || { recursive: true });
  },
  readdirSync: function (p) {
    return fsSync.readdirSync(resolveInWorkspace(p, "read"));
  },
  existsSync: function (p) {
    try {
      return fsSync.existsSync(resolveInWorkspace(p, "read"));
    } catch (err) {
      return false;
    }
  },
};

const SAFE_BUILTINS = {
  path: nodePath,
  "node:path": nodePath,
  buffer: require("node:buffer"),
  "node:buffer": require("node:buffer"),
  assert: require("node:assert"),
  "node:assert": require("node:assert"),
  util: { inspect: nodeUtil.inspect, format: nodeUtil.format },
  "node:util": { inspect: nodeUtil.inspect, format: nodeUtil.format },
  // Network sandboxing removed by explicit request — see this file's header.
  http: require("node:http"),
  "node:http": require("node:http"),
  https: require("node:https"),
  "node:https": require("node:https"),
  net: require("node:net"),
  "node:net": require("node:net"),
  dns: require("node:dns"),
  "node:dns": require("node:dns"),
  tls: require("node:tls"),
  "node:tls": require("node:tls"),
};

function sandboxedRequire(name) {
  if (Object.prototype.hasOwnProperty.call(allowlistPaths, name)) {
    return require(allowlistPaths[name]);
  }
  if (Object.prototype.hasOwnProperty.call(SAFE_BUILTINS, name)) {
    return SAFE_BUILTINS[name];
  }
  throw new Error("Module not allowed in sandbox: " + name);
}

const sandboxConsole = {
  log: function () { stdout += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  info: function () { stdout += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  debug: function () { stdout += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  warn: function () { stderr += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  error: function () { stderr += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
};

const sandboxModule = { exports: {} };
const sandboxGlobal = {
  console: sandboxConsole,
  require: sandboxedRequire,
  fs: scopedFs,
  module: sandboxModule,
  exports: sandboxModule.exports,
  __dirname: workspaceRoot,
  __filename: nodePath.join(workspaceRoot, "src", "sandbox-entry.js"),
  Buffer: Buffer,
  TextEncoder: TextEncoder,
  TextDecoder: TextDecoder,
  URL: URL,
  URLSearchParams: URLSearchParams,
  Promise: Promise,
  // Network sandboxing removed by explicit request — see this file's header.
  fetch: fetch,
  WebSocket: WebSocket,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  queueMicrotask: queueMicrotask,
};

const context = vm.createContext(sandboxGlobal, {
  codeGeneration: { strings: false, wasm: false },
});

process.on("uncaughtException", function (err) {
  sendResult({
    success: false,
    stdout: stdout,
    stderr: stderr,
    error: "Uncaught exception: " + (err && err.stack ? err.stack : String(err)),
  });
});
process.on("unhandledRejection", function (reason) {
  sendResult({
    success: false,
    stdout: stdout,
    stderr: stderr,
    error: "Unhandled rejection: " + (reason && reason.stack ? reason.stack : String(reason)),
  });
});

try {
  const script = new vm.Script(workerData.code, { filename: "sandbox.js" });
  const completionValue = script.runInContext(context, {
    timeout: timeoutMs,
    breakOnSigint: false,
  });
  Promise.resolve(completionValue)
    .then(function () {
      sendResult({ success: true, stdout: stdout, stderr: stderr });
    })
    .catch(function (err) {
      sendResult({
        success: false,
        stdout: stdout,
        stderr: stderr,
        error: err && err.stack ? err.stack : String(err),
      });
    });
} catch (err) {
  sendResult({
    success: false,
    stdout: stdout,
    stderr: stderr,
    error: err && err.stack ? err.stack : String(err),
  });
}
`;
