import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type RunCodeOptions, runCode } from "../src/sandbox/run-code.js";

async function run(
  code: string,
  broker: Partial<NonNullable<RunCodeOptions["broker"]>> = {},
  options: RunCodeOptions = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), "vc-execute-"));
  mkdirSync(join(workspace, "src"));
  mkdirSync(join(workspace, "output"));
  try {
    return await runCode(
      { session_id: "fixture", workspace, created_at: new Date().toISOString() },
      code,
      {
        ...options,
        broker: {
          toolNames: ["read"],
          context: { workspace_id: "workspace1", run_id: "run1" },
          call: async () => ({
            structuredContent: { ok: true, data: { items: [1] } },
            content: [{ type: "text", text: "fixture" }],
            isError: false,
          }),
          ...broker,
        },
      },
    );
  } finally {
    rmSync(workspace, { recursive: true });
  }
}
test("execute supports actual TS/top-level await, separate inputs and compact emit", async () => {
  const result = await run(
    "const value: string = inputs.query; const page = await tools.read({query:value}); emit({items:page.items, workspace:context.workspace_id, media:page.__mcpContent});",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Deliberate injection fixture; data must never become source.
    { inputs: { query: "untrusted ${neverEvaluated}" } },
  );
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.emitted, [
    { items: [1], workspace: "workspace1", media: [{ type: "text", text: "fixture" }] },
  ]);
  assert.equal(result.stdout, "");
});
test("broker errors retain code/effect/recovery/content for code recovery", async () => {
  const result = await run(
    "try { await tools.read({}); } catch(e) { emit({code:e.code,effect:e.effect,recovery:e.recovery,content:e.content}); }",
    {
      call: async () => ({
        isError: true,
        content: [{ type: "text", text: "Failure" }],
        structuredContent: {
          ok: false,
          error: {
            code: "REVISION_CONFLICT",
            message: "Read again",
            effect: "not_applied",
            recovery: { kind: "refresh_then_recompute" },
          },
        },
      }),
    },
  );
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.emitted, [
    {
      code: "REVISION_CONFLICT",
      effect: "not_applied",
      recovery: { kind: "refresh_then_recompute" },
      content: [{ type: "text", text: "Failure" }],
    },
  ]);
});
test("parent rejects recursive tools even if mistakenly included in names", async () => {
  let called = false;
  const result = await run("await tools.execute({});", {
    toolNames: ["execute"],
    call: async () => {
      called = true;
      return {};
    },
  });
  assert.equal(result.success, false);
  assert.equal(called, false);
});
test("parent bounds tool count and drains unawaited accepted calls", async () => {
  let count = 0;
  const result = await run("await tools.read({}); await tools.read({});", {
    maxToolCalls: 1,
    call: async () => {
      count++;
      return {};
    },
  });
  assert.equal(result.success, false);
  assert.equal(count, 1);
  let complete = false;
  const drained = await run("tools.read({});", {
    call: async () => {
      await new Promise((r) => setTimeout(r, 30));
      complete = true;
      return {};
    },
  });
  assert.equal(drained.success, true);
  assert.equal(complete, true);
});
test("parent bounds concurrency without dispatching rejected call", async () => {
  let count = 0;
  const result = await run("await Promise.all([tools.read({}),tools.read({})]);", {
    maxConcurrency: 1,
    call: async () => {
      count++;
      await new Promise((r) => setTimeout(r, 30));
      return {};
    },
  });
  assert.equal(result.success, false);
  assert.equal(count, 1);
});
test("output flood is bounded and never silently complete", async () => {
  const result = await run("console.log('x'.repeat(500)); emit({small:1});", {
    maxOutputBytes: 100,
  });
  assert.equal(result.success, true);
  assert.equal(result.stdout, "");
  assert.equal(result.outputTruncated, true);
  const emitted = await run("emit('x'.repeat(500));", { maxOutputBytes: 100 });
  assert.equal(emitted.success, false);
});
test("code timeout and cancellation stop the isolate", async () => {
  const timed = await run("await new Promise(()=>{});", {}, { timeoutMs: 40 });
  assert.equal(timed.success, false);
  assert.match(timed.error ?? "", /timed out/);
  const abort = new AbortController();
  abort.abort();
  const cancelled = await run("await tools.read({});", {}, { signal: abort.signal });
  assert.equal(cancelled.success, false);
  assert.match(cancelled.error ?? "", /cancelled/);
});
test("sandbox has no env/process globals and retains explicit network capability", async () => {
  const result = await run(
    "emit({process:typeof process, fetch:typeof fetch, ws:typeof WebSocket, frozen:Object.isFrozen(context)});",
  );
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.emitted, [
    { process: "undefined", fetch: "function", ws: "function", frozen: true },
  ]);
});
