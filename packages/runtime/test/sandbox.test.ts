/**
 * Tests for src/sandbox: write_file confinement and run_code's
 * resource-limited execution, against an ad-hoc workspace directory (the
 * same shape apps/worker/src/exec.ts builds around a hydrated temp dir —
 * the local stdio server's session-directory lifecycle that used to back
 * this is gone, see workspace.ts).
 *
 * Test runner: node:test / node:assert, run via
 * `node --import tsx --test test/*.test.ts` (see package.json "test").
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCode, SandboxPathError, writeFile } from "../src/sandbox/index.js";
import { WORKSPACE_SUBDIRS } from "../src/sandbox/workspace.js";
import type { Session } from "../src/types.js";

/** Creates a fresh throwaway workspace directory for a test and returns it + a cleanup fn. */
function freshSession(): { session: Session; cleanup: () => void } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vc-sandbox-test-"));
  for (const sub of WORKSPACE_SUBDIRS) {
    fs.mkdirSync(path.join(workspace, sub), { recursive: true });
  }
  const session: Session = {
    session_id: `sess_${randomUUID()}`,
    workspace,
    created_at: new Date().toISOString(),
  };
  return { session, cleanup: () => fs.rmSync(workspace, { recursive: true, force: true }) };
}

test("write_file allows writes under /src and /output", () => {
  const { session, cleanup } = freshSession();
  try {
    const srcResult = writeFile(session, "/src/main.ts", "console.log(1);");
    assert.equal(srcResult.path, "/src/main.ts");
    assert.equal(srcResult.bytes_written, Buffer.byteLength("console.log(1);"));
    assert.equal(
      fs.readFileSync(path.join(session.workspace, "src/main.ts"), "utf8"),
      "console.log(1);",
    );

    const outResult = writeFile(session, "output/report.html", "<html></html>");
    assert.equal(outResult.path, "/output/report.html");
    assert.ok(fs.existsSync(path.join(session.workspace, "output/report.html")));
  } finally {
    cleanup();
  }
});

test("write_file rejects writes outside /src and /output (templates, assets, cache)", () => {
  const { session, cleanup } = freshSession();
  try {
    for (const target of ["/templates/x.html", "/assets/logo.png", "/cache/build.css"]) {
      assert.throws(() => writeFile(session, target, "nope"), SandboxPathError);
    }
  } finally {
    cleanup();
  }
});

test("write_file rejects path traversal escaping the workspace", () => {
  const { session, cleanup } = freshSession();
  try {
    assert.throws(() => writeFile(session, "/src/../../../etc/passwd", "pwned"), SandboxPathError);
    assert.throws(() => writeFile(session, "../outside.txt", "pwned"), SandboxPathError);
  } finally {
    cleanup();
  }
});

test("run_code executes plain JS and captures console.log as stdout", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(session, 'console.log("hello", 42);');
    assert.equal(result.success, true);
    assert.match(result.stdout, /hello 42/);
    assert.equal(result.stderr, "");
  } finally {
    cleanup();
  }
});

test("run_code transpiles and executes TypeScript", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(
      session,
      "const x: number = 40; const y: number = 2; console.log(x + y);",
    );
    assert.equal(result.success, true);
    assert.match(result.stdout, /42/);
  } finally {
    cleanup();
  }
});

test("run_code can write files via the scoped fs into /src and /output", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(
      session,
      'fs.writeFileSync("/output/generated.txt", "from sandbox"); console.log("wrote");',
    );
    assert.equal(result.success, true, result.error);
    assert.equal(
      fs.readFileSync(path.join(session.workspace, "output/generated.txt"), "utf8"),
      "from sandbox",
    );
  } finally {
    cleanup();
  }
});

test("run_code's scoped fs blocks path-traversal writes outside the workspace", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(session, 'fs.writeFileSync("/../../escaped.txt", "pwned");');
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /escapes session workspace/);
    assert.equal(fs.existsSync(path.join(session.workspace, "..", "escaped.txt")), false);
  } finally {
    cleanup();
  }
});

test("run_code's scoped fs blocks writes outside /src and /output", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(session, 'fs.writeFileSync("/cache/x.txt", "nope");');
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /only allowed under \/src or \/output/);
  } finally {
    cleanup();
  }
});

test("run_code still blocks shell access: child_process/worker_threads/vm are not requireable", async () => {
  const { session, cleanup } = freshSession();
  try {
    for (const mod of [
      "node:child_process",
      "child_process",
      "node:worker_threads",
      "worker_threads",
      "node:vm",
      "vm",
    ]) {
      const result = await runCode(session, `require(${JSON.stringify(mod)});`);
      assert.equal(result.success, false, `expected require(${mod}) to be blocked`);
      assert.match(result.error ?? "", /not allowed in sandbox/);
    }
  } finally {
    cleanup();
  }
});

test("run_code allows network access: http/https/net/dns/tls are requireable, fetch/WebSocket globals present", async () => {
  const { session, cleanup } = freshSession();
  try {
    for (const mod of [
      "node:http",
      "http",
      "node:https",
      "https",
      "node:net",
      "net",
      "node:dns",
      "dns",
      "node:tls",
      "tls",
    ]) {
      const result = await runCode(session, `require(${JSON.stringify(mod)}); console.log("ok");`);
      assert.equal(result.success, true, `expected require(${mod}) to be allowed: ${result.error}`);
    }

    const globalsResult = await runCode(
      session,
      "console.log(typeof fetch, typeof WebSocket, typeof process);",
    );
    assert.equal(globalsResult.success, true, globalsResult.error);
    // process remains absent — network sandboxing removal is unrelated to the
    // no-shell-access / no-sandbox-escape guarantees.
    assert.match(globalsResult.stdout, /function function undefined/);
  } finally {
    cleanup();
  }
});

test("run_code allows requiring allowlisted packages (tailwindcss, @terrastruct/d2)", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(
      session,
      'const tw = require("tailwindcss"); const d2 = require("@terrastruct/d2"); console.log(typeof tw, typeof d2);',
    );
    assert.equal(result.success, true, result.error);
    assert.match(result.stdout, /function|object/);
  } finally {
    cleanup();
  }
});

test("run_code enforces a timeout on synchronous infinite loops", async () => {
  const { session, cleanup } = freshSession();
  try {
    const start = Date.now();
    const result = await runCode(session, "while (true) {}", { timeoutMs: 300 });
    const elapsed = Date.now() - start;
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /timed out|timeout/i);
    // Should not run anywhere close to a "hung forever" duration.
    assert.ok(elapsed < 5_000, `expected quick kill, took ${elapsed}ms`);
  } finally {
    cleanup();
  }
});

test("run_code enforces a timeout on hanging async code", async () => {
  const { session, cleanup } = freshSession();
  try {
    const start = Date.now();
    const result = await runCode(session, "(async () => { await new Promise(() => {}); })();", {
      timeoutMs: 300,
    });
    const elapsed = Date.now() - start;
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /timed out/i);
    assert.ok(elapsed < 5_000, `expected quick kill, took ${elapsed}ms`);
  } finally {
    cleanup();
  }
});

test("run_code enforces a memory limit", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(
      session,
      'const chunks = []; while (true) { chunks.push(new Array(1e6).fill("x")); }',
      { timeoutMs: 10_000, memoryLimitMb: 24 },
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /memory/i);
  } finally {
    cleanup();
  }
});

test("run_code reports TypeScript syntax errors without running", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(session, "const x: = ;;; this is not valid");
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /compile error/i);
  } finally {
    cleanup();
  }
});

test("run_code surfaces thrown errors as a failed result, not a rejected promise", async () => {
  const { session, cleanup } = freshSession();
  try {
    const result = await runCode(session, 'throw new Error("boom");');
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /boom/);
  } finally {
    cleanup();
  }
});
