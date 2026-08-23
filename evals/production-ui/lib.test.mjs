import assert from "node:assert/strict";
import { test } from "node:test";
import { certificationGates, inspectTrace, parseTrace, validateProductionRubric } from "./lib.mjs";

const event = (tool, args, value, content = []) =>
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      tool,
      arguments: args,
      status: "completed",
      result: { structured_content: value, content },
    },
  });

test("parseTrace counts completed calls once and retains refs, warnings, usage, and PNG bytes", () => {
  const trace = [
    JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call", tool: "canvas_save" } }),
    event("canvas_save", { files: [] }, { status: "ok", ref: "eval/example", warnings: [] }),
    event("canvas_snapshot", { ref: "eval/example" }, { status: "ok", ref: "eval/example" }, [
      { type: "image", mimeType: "image/png", data: "iVBORw==" },
    ]),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 4 } }),
  ].join("\n");
  const parsed = parseTrace("codex", trace);
  assert.equal(parsed.calls.length, 2);
  assert.deepEqual(parsed.refs, ["eval/example"]);
  assert.equal(parsed.pngs.length, 1);
  assert.equal(parsed.usage.input_tokens, 20);
});

test("parseTrace joins Claude tool results, normalizes MCP names, and sums model usage", () => {
  const trace = [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "mcp__visual-canvas-local__canvas_save",
            input: { files: [{ text: "loading empty error --color-primary" }] },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      tool_use_result: {
        content: JSON.stringify({ status: "ok", ref: "eval/claude", warnings: [] }),
      },
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: JSON.stringify({ status: "ok", ref: "eval/claude", warnings: [] }),
          },
        ],
      },
    }),
    JSON.stringify({
      type: "result",
      modelUsage: {
        first: { inputTokens: 20, cacheReadInputTokens: 5, outputTokens: 4 },
        second: { inputTokens: 10, cacheReadInputTokens: 2, outputTokens: 3 },
      },
    }),
  ].join("\n");
  const parsed = parseTrace("claude", trace);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].name, "canvas_save");
  assert.deepEqual(parsed.refs, ["eval/claude"]);
  assert.deepEqual(parsed.usage, {
    input_tokens: 30,
    cached_input_tokens: 7,
    output_tokens: 7,
    reasoning_output_tokens: null,
  });
});

test("parseTrace converts Claude base64 image results into snapshot PNGs", () => {
  const trace = [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "snapshot-1",
            name: "mcp__visual-canvas-local__canvas_snapshot",
            input: { ref: "eval/claude" },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      tool_use_result: {
        structuredContent: { status: "ok", ref: "eval/claude" },
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
          },
        ],
      },
      message: {
        content: [{ type: "tool_result", tool_use_id: "snapshot-1", content: [] }],
      },
    }),
  ].join("\n");
  const parsed = parseTrace("claude", trace);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].structured.status, "ok");
  assert.equal(parsed.pngs.length, 1);
});

test("inspectTrace requires a successful snapshot after a write and a correction between snapshots", () => {
  const scenario = { id: "quality", category: "dashboard", detail: "detailed" };
  const rubric = { automated: { snapshot_after_write: 50, snapshot_driven_correction: 50 } };
  const trace = [
    event("read_mcp_resource", { uri: "canvas://templates/dashboard-overview" }, {}),
    event("read_mcp_resource", { uri: "canvas://themes/clean-saas" }, {}),
    event(
      "canvas_save",
      { theme_id: "clean-saas", files: [{ text: "loading empty error --color-primary" }] },
      { status: "ok", ref: "eval/quality" },
    ),
    event("canvas_snapshot", { ref: "eval/quality" }, { status: "ok", ref: "eval/quality" }),
    event(
      "canvas_edit",
      { ref: "eval/quality", replacement: "--color-surface" },
      { status: "ok", ref: "eval/quality" },
    ),
    event("canvas_snapshot", { ref: "eval/quality" }, { status: "ok", ref: "eval/quality" }),
  ].join("\n");
  const inspected = inspectTrace(
    "codex",
    scenario,
    { code: 0, stdout: trace, duration_ms: 5 },
    rubric,
  );
  assert.equal(inspected.tool_calls, 4);
  assert.equal(inspected.iterations, 2);
  assert.equal(inspected.snapshots, 2);
  assert.equal(inspected.metrics.snapshot_after_write, true);
  assert.equal(inspected.metrics.snapshot_driven_correction, true);
  assert.equal(inspected.score, 1);
});

test("inspectTrace recognizes semantic loading, empty, and error state copy", () => {
  const trace = event(
    "canvas_save",
    {
      files: [
        { text: "Scoring open claims... No open recovery cases. Couldn't load feed. Retry." },
      ],
    },
    { status: "ok", ref: "eval/states" },
  );
  const inspected = inspectTrace(
    "codex",
    { id: "states", category: "dashboard", detail: "detailed" },
    { code: 0, stdout: trace, duration_ms: 1 },
    { automated: { required_states: 100 } },
  );
  assert.equal(inspected.metrics.required_states, true);
  assert.equal(inspected.score, 1);
});

test("failed snapshot calls do not satisfy adherence", () => {
  const trace = [
    event("canvas_save", { files: [{ text: "x" }] }, { status: "ok", ref: "eval/fail" }),
    event("canvas_snapshot", { ref: "eval/fail" }, null, [{ type: "text", text: "unsupported" }]),
  ].join("\n");
  const inspected = inspectTrace(
    "codex",
    { id: "fail", category: "repair", detail: "short" },
    { code: 0, stdout: trace, duration_ms: 1 },
    { automated: { snapshot_after_write: 100 } },
  );
  assert.equal(inspected.snapshots, 0);
  assert.equal(inspected.metrics.snapshot_after_write, false);
  assert.equal(inspected.score, 0);
});

test("certification rejects an automated score below the rubric threshold", () => {
  const metricKeys = [
    "schema_valid",
    "correct_template_and_theme",
    "semantic_tokens",
    "required_states",
    "no_unresolved_references",
    "no_unintended_overlap_or_clipping",
    "snapshot_after_write",
    "snapshot_driven_correction",
    "no_internal_marker_leakage",
    "bounded_iterations",
  ];
  const rubric = {
    automated: Object.fromEntries(metricKeys.map((key) => [key, 10])),
    release_thresholds: {
      automated_score: 0.9,
      routing_recall: 0.9,
      negative_precision: 0.95,
      snapshot_adherence: 0.9,
      human_preference: 0.8,
    },
  };
  validateProductionRubric(rubric);
  const golden = {
    providers: ["codex", "claude"],
    scenario_count: 12,
    results: ["codex", "claude"].flatMap((provider) =>
      Array.from({ length: 12 }, () => ({ provider })),
    ),
    aggregate: {
      automated_score: 0.89,
      snapshot_adherence: 1,
      unresolved_scenarios: 0,
      clipping_scenarios: 0,
      internal_leakage_scenarios: 0,
    },
  };
  const routing = {
    results: ["codex", "claude"].map((provider) => ({
      provider,
      recall: 1,
      negative_precision: 1,
    })),
  };
  const gates = certificationGates(golden, routing, { candidate_preference_rate: 1 }, rubric);
  assert.equal(gates.automated_score, false);
  assert.equal(Object.values(gates).filter((passed) => !passed).length, 1);
});

test("rubric metric keys must exactly match implemented metrics", () => {
  assert.throws(
    () => validateProductionRubric({ automated: { schema_valid: 100 } }),
    /exactly match metrics/,
  );
});
