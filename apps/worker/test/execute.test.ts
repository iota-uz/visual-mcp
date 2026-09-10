import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import {
  ExecuteRequest,
  handleExecute,
  registerExecuteRoute,
  validateCallback,
} from "../src/execute.js";

test("callback URL is restricted to configured origin and exact path", () => {
  assert.equal(
    validateCallback("http://mcp.local/internal/video-execute-broker", "http://mcp.local").origin,
    "http://mcp.local",
  );
  for (const url of [
    "http://evil.local/internal/video-execute-broker",
    "http://mcp.local/admin",
    "http://mcp.local/internal/video-execute-broker?key=x",
    "http://user:pass@mcp.local/internal/video-execute-broker",
  ])
    assert.throws(() => validateCallback(url, "http://mcp.local"));
});
test("worker execute keeps callback capability in parent and returns emitted output", async () => {
  const previous = process.env.MCP_EXECUTE_BROKER_ORIGIN;
  process.env.MCP_EXECUTE_BROKER_ORIGIN = "http://mcp.local";
  try {
    let calls = 0;
    const input = ExecuteRequest.parse({
      code: "const p=await tools.read({}); emit({items:p.items, callback:typeof callback, process:typeof process});",
      context: { workspace_id: "w1", run_id: "r1" },
      toolNames: ["read"],
      callback: { url: "http://mcp.local/internal/video-execute-broker", token: "x".repeat(64) },
    });
    const result = await handleExecute(input, undefined, async (url, init) => {
      calls++;
      assert.equal(String(url), input.callback.url);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${input.callback.token}`,
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        runId: "r1",
        callId: "1",
        name: "read",
        args: {},
      });
      return Response.json({
        isError: false,
        structuredContent: { ok: true, data: { items: [1] } },
        content: [],
      });
    });
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.emitted, [{ items: [1], callback: "undefined", process: "undefined" }]);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.MCP_EXECUTE_BROKER_ORIGIN;
    else process.env.MCP_EXECUTE_BROKER_ORIGIN = previous;
  }
});
test("execute route requires supplied worker auth middleware before validating code", async () => {
  const app = new Hono();
  registerExecuteRoute(app, async (c) => c.json({ error: "unauthorized" }, 401));
  const result = await app.request("/execute", { method: "POST", body: "{}" });
  assert.equal(result.status, 401);
});
