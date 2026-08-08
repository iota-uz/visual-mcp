/**
 * `run_code` MCP tool implementation (PLAN.md sections 6.2, 9).
 *
 * SANDBOXING APPROACH (documented honestly)
 * --------------------------------------------------------------------
 * `vm2` is deprecated/known-broken-out-of-sandbox and is not used.
 * `isolated-vm` (a native addon giving true V8-isolate-level isolation)
 * was considered but rejected for v0.1: it requires a native build
 * toolchain (node-gyp + a C++ compiler) at `npm install` time, which is a
 * heavier and more fragile dependency footprint than this project wants
 * for an MVP, and PLAN.md's dependency list does not include it. Instead
 * this uses a **two-layer** defense built entirely from Node core APIs:
 *
 *   1. `node:worker_threads` — each `run_code` call executes in a fresh
 *      Worker, which is a genuinely separate V8 isolate with its own
 *      heap. This is what makes the memory limit (`resourceLimits.
 *      maxOldGenerationSizeMb`) a real, enforced ceiling (V8 crashes the
 *      isolate on breach — verified empirically), and it's what lets the
 *      parent unconditionally kill a hung execution via
 *      `worker.terminate()` without taking down the MCP server process.
 *   2. `node:vm` inside that worker — user code runs via
 *      `vm.Script#runInContext` against a purpose-built context object,
 *      not the worker's real globals. `require`, `fs`, and everything
 *      else the sandbox exposes are our own wrapper functions (see
 *      worker-source.ts); the vm context is created with
 *      `codeGeneration: { strings: false }` to additionally block
 *      `eval`/`new Function` string-to-code escapes.
 *
 * HONEST LIMITATIONS
 * --------------------------------------------------------------------
 * - `node:vm` is explicitly documented by Node as **not a security
 *   boundary** on its own (known sandbox-escape techniques exist via
 *   constructor-chain / prototype tricks reaching back to the host
 *   realm). We rely on the worker_threads isolate as the real boundary;
 *   `vm` here is an API-surface allowlist layer on top, not the sole
 *   defense. For untrusted-multi-tenant-at-scale use, `isolated-vm` or an
 *   OS-level sandbox (gVisor/Firecracker) would be the stronger choice —
 *   left as a future upgrade if v0.1's trust model changes.
 * - CPU-time limiting is approximated with a **wall-clock** timeout
 *   (both `vm.Script`'s own `timeout` option, which only bounds
 *   *synchronous* execution, and an outer per-run `setTimeout` in the
 *   parent that force-terminates the worker for hangs in async code).
 *   Node gives no portable per-thread CPU-time quota without OS-specific
 *   APIs, so a busy-looping *async* chain (e.g. recursive
 *   `setImmediate`) is bounded by the outer wall-clock kill, not by CPU
 *   time directly — acceptable for v0.1's trust model (LLM-authored code,
 *   not adversarial red-team input).
 * - On hard timeout or memory-limit kill, any `stdout`/`stderr` the
 *   worker had buffered but not yet posted back is lost — the worker is
 *   terminated before it can flush. `RunCodeOutput.error` still reports
 *   what happened.
 * - Symlink-based escapes are not separately defended against, but the
 *   sandboxed `fs` never exposes a symlink-creation primitive, so user
 *   code cannot manufacture one; a pre-existing symlink placed in the
 *   workspace by something else could still be followed. No such thing
 *   is created by this module.
 *
 * ALLOWLISTED PACKAGES (PLAN.md section 9): `apexcharts`,
 * `@terrastruct/d2`, `tailwindcss`. Note `apexcharts` is a browser-only
 * library (it references `window`/`document` at load time) — it will
 * throw `ReferenceError: window is not defined` if `require()`d in this
 * Node sandbox. It's kept in the allowlist for PLAN.md-section-9
 * compliance and forward compatibility, but its real usage path is
 * inline `<script>` execution inside Playwright-rendered HTML (PLAN.md
 * 3.3), not direct `require()` from `run_code`.
 */

import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import type { RunCodeOutput, Session } from "../types.js";
import { WORKER_SOURCE } from "./worker-source.js";

export interface RunCodeOptions {
  /** Wall-clock execution budget in milliseconds. Default 5000. */
  timeoutMs?: number;
  /** V8 old-generation heap ceiling in MB for the worker isolate. Default 128. */
  memoryLimitMb?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MEMORY_LIMIT_MB = 128;
/** Grace period added on top of `timeoutMs` before the parent force-kills the worker. */
const TIMEOUT_KILL_GRACE_MS = 250;

const ALLOWLISTED_PACKAGES = ["apexcharts", "@terrastruct/d2", "tailwindcss"] as const;

const packageRequire = createRequire(import.meta.url);

function resolveAllowlistPaths(): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const name of ALLOWLISTED_PACKAGES) {
    resolved[name] = packageRequire.resolve(name);
  }
  return resolved;
}

/** Resolved once per process — the allowlisted packages are fixed at install time. */
const ALLOWLIST_PATHS = resolveAllowlistPaths();

interface WorkerResultMessage {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Transpiles `code` (JS or TS) to plain CommonJS JS the worker's `vm`
 * context can execute. Type errors are *not* checked (transpileModule is
 * a syntax-only, per-file transform — matching `run_code`'s "execute
 * quickly" contract rather than a full project type-check).
 */
function transpileToCommonJs(code: string): string {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });

  const errors = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    const message = errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    throw new SyntaxError(`TypeScript/JavaScript compile error:\n${message}`);
  }

  return result.outputText;
}

/**
 * Executes `code` inside an isolated worker against `session`'s
 * workspace. See this module's header comment for the sandboxing model
 * and its limitations.
 */
export function runCode(
  session: Session,
  code: string,
  options: RunCodeOptions = {},
): Promise<RunCodeOutput> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryLimitMb = options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;

  let transpiled: string;
  try {
    transpiled = transpileToCommonJs(code);
  } catch (err) {
    return Promise.resolve({
      success: false,
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return new Promise<RunCodeOutput>((resolvePromise) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        code: transpiled,
        workspaceRoot: session.workspace,
        allowlistPaths: ALLOWLIST_PATHS,
        timeoutMs,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: memoryLimitMb,
        maxYoungGenerationSizeMb: Math.max(16, Math.floor(memoryLimitMb / 4)),
        stackSizeMb: 4,
      },
      // Sandbox worker must not itself gain a wider execArgv surface; use none.
      execArgv: [],
    });

    let settled = false;
    const finish = (result: RunCodeOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      worker.removeAllListeners();
      worker.terminate().catch(() => {
        /* already exiting / exited — nothing to do */
      });
      resolvePromise(result);
    };

    const killTimer = setTimeout(() => {
      finish({
        success: false,
        stdout: "",
        stderr: "",
        error: `Execution timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs + TIMEOUT_KILL_GRACE_MS);

    worker.once("message", (msg: WorkerResultMessage) => {
      finish({
        success: msg.success,
        stdout: msg.stdout ?? "",
        stderr: msg.stderr ?? "",
        ...(msg.error !== undefined ? { error: msg.error } : {}),
      });
    });

    worker.once("error", (err: Error) => {
      finish({
        success: false,
        stdout: "",
        stderr: "",
        error: err.message,
      });
    });

    worker.once("exit", (exitCode: number) => {
      if (exitCode !== 0) {
        finish({
          success: false,
          stdout: "",
          stderr: "",
          error: `Sandbox worker exited with code ${exitCode}`,
        });
      }
    });
  });
}
