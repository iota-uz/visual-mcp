const WRITE_TOOLS = new Set([
  "canvas_save",
  "canvas_edit",
  "canvas_apply_patch",
  "canvas_doc_patch",
  "canvas_nodes_move",
  "canvas_nodes_delete",
]);

export const PRODUCTION_METRIC_KEYS = [
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

export function validateProductionRubric(rubric) {
  const actual = Object.keys(rubric.automated ?? {}).sort();
  const expected = [...PRODUCTION_METRIC_KEYS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Rubric automated keys must exactly match metrics: ${expected.join(", ")}`);
  }
  return rubric;
}

export function certificationGates(golden, routing, review, rubric) {
  return {
    both_providers: ["codex", "claude"].every((provider) => golden.providers.includes(provider)),
    complete_golden_set:
      golden.scenario_count >= 12 &&
      ["codex", "claude"].every(
        (provider) =>
          golden.results.filter((result) => result.provider === provider).length ===
          golden.scenario_count,
      ),
    routing_both_providers: ["codex", "claude"].every((provider) =>
      routing.results.some((result) => result.provider === provider),
    ),
    routing_recall: routing.results.every(
      (item) => item.recall >= rubric.release_thresholds.routing_recall,
    ),
    routing_negative_precision: routing.results.every(
      (item) => item.negative_precision >= rubric.release_thresholds.negative_precision,
    ),
    automated_score: golden.aggregate.automated_score >= rubric.release_thresholds.automated_score,
    snapshot_adherence:
      golden.aggregate.snapshot_adherence >= rubric.release_thresholds.snapshot_adherence,
    no_critical_unresolved: golden.aggregate.unresolved_scenarios === 0,
    no_clipping: golden.aggregate.clipping_scenarios === 0,
    no_internal_leakage: golden.aggregate.internal_leakage_scenarios === 0,
    blinded_human_preference:
      review?.candidate_preference_rate >= rubric.release_thresholds.human_preference,
  };
}

function hasRequiredStates(authored) {
  const loading = /loading|skeleton|animate-pulse|scoring[^<"]{0,80}(?:claims|records|items)/i.test(
    authored,
  );
  const empty = /empty|no (?:open|matching|results?|records?|data|items?|cases?)/i.test(authored);
  const error = /error|couldn['’]?t load|failed|timed out|retry/i.test(authored);
  return loading && empty && error;
}

function jsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function contentBlocks(event) {
  if (event?.type === "item.completed" && event.item?.type === "mcp_tool_call") {
    return [
      {
        id: event.item.id,
        name: event.item.tool,
        arguments: event.item.arguments ?? {},
        result: event.item.result,
        status: event.item.status,
      },
    ];
  }
  const blocks = event?.message?.content ?? event?.content ?? [];
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block?.type === "tool_use" || block?.type === "mcp_tool_call")
    .map((block) => ({
      id: block.id,
      name: (block.name ?? block.tool)?.replace(/^mcp__visual-canvas-local__/, ""),
      arguments: block.input ?? block.arguments ?? {},
      result: block.result,
      status: block.status ?? "completed",
    }));
}

function claudeToolResults(events) {
  const results = new Map();
  for (const event of events) {
    if (event?.type !== "user" || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (block?.type !== "tool_result" || !block.tool_use_id) continue;
      const toolResult = event.tool_use_result;
      let parsed = toolResult?.structuredContent ?? toolResult?.structured_content;
      const textContent =
        typeof toolResult?.content === "string"
          ? toolResult.content
          : typeof block.content === "string"
            ? block.content
            : undefined;
      if (parsed === undefined && textContent !== undefined) {
        try {
          parsed = JSON.parse(textContent);
        } catch {
          parsed = undefined;
        }
      }
      const sourceContent = Array.isArray(toolResult?.content)
        ? toolResult.content
        : Array.isArray(block.content)
          ? block.content
          : undefined;
      const content = sourceContent
        ? sourceContent.map((item) =>
            item?.type === "image" && item.source?.type === "base64"
              ? {
                  type: "image",
                  mimeType: item.source.media_type,
                  data: item.source.data,
                }
              : item,
          )
        : [{ type: "text", text: textContent ?? "" }];
      results.set(block.tool_use_id, {
        structured_content: parsed,
        content,
      });
    }
  }
  return results;
}

function structuredResult(result) {
  if (!result) return {};
  if (result.structured_content && typeof result.structured_content === "object") {
    return result.structured_content;
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = result.content?.find?.((block) => block.type === "text")?.text;
  if (typeof text !== "string") return {};
  try {
    const parsed = JSON.parse(text);
    return parsed.structuredContent ?? parsed.structured_content ?? parsed;
  } catch {
    return {};
  }
}

export function parseTrace(provider, traceText) {
  const events = jsonLines(traceText);
  const calls = events.flatMap(contentBlocks).filter((call) => call.name);
  const claudeResults = claudeToolResults(events);
  const completedCalls = (
    provider === "codex"
      ? calls.filter((call) => call.status === "completed")
      : calls
          .filter((call) => claudeResults.has(call.id))
          .map((call) => ({ ...call, result: claudeResults.get(call.id), status: "completed" }))
  ).map((call) => ({ ...call, structured: structuredResult(call.result) }));
  const usageEvent = [...events].reverse().find((event) => event?.usage);
  const modelUsage = [...events].reverse().find((event) => event?.modelUsage)?.modelUsage;
  const usage = modelUsage
    ? Object.values(modelUsage).reduce(
        (total, item) => ({
          input_tokens: total.input_tokens + (item.inputTokens ?? 0),
          cached_input_tokens: total.cached_input_tokens + (item.cacheReadInputTokens ?? 0),
          output_tokens: total.output_tokens + (item.outputTokens ?? 0),
        }),
        { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      )
    : (usageEvent?.usage ?? {});
  const refs = new Set();
  const warnings = [];
  const pngs = [];
  for (const call of completedCalls) {
    const value = call.structured;
    if (typeof value.ref === "string") refs.add(value.ref);
    if (Array.isArray(value.warnings)) warnings.push(...value.warnings);
    if (call.name === "canvas_snapshot") {
      for (const block of call.result?.content ?? []) {
        if (block.type === "image" && block.mimeType === "image/png" && block.data) {
          pngs.push(Buffer.from(block.data, "base64"));
        }
      }
    }
  }
  return {
    events,
    calls: completedCalls,
    refs: [...refs],
    warnings,
    pngs,
    usage: {
      input_tokens: usage.input_tokens ?? usage.inputTokens ?? null,
      cached_input_tokens: usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? null,
      output_tokens: usage.output_tokens ?? usage.outputTokens ?? null,
      reasoning_output_tokens: usage.reasoning_output_tokens ?? null,
    },
  };
}

export function inspectTrace(provider, scenario, trace, rubric) {
  const parsed = parseTrace(provider, trace.stdout);
  const visualCalls = parsed.calls.filter((call) =>
    /^(?:canvas|asset|comment|component)_/.test(call.name),
  );
  const snapshotIndexes = visualCalls
    .map((call, index) =>
      call.name === "canvas_snapshot" && ["ok", "partial"].includes(call.structured?.status)
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  const writeIndexes = visualCalls
    .map((call, index) => (WRITE_TOOLS.has(call.name) ? index : -1))
    .filter((index) => index >= 0);
  const authored = JSON.stringify(
    visualCalls.filter((call) => WRITE_TOOLS.has(call.name)).map((call) => call.arguments),
  );
  const resources = JSON.stringify(parsed.calls.map((call) => call.arguments));
  const warningText = JSON.stringify(parsed.warnings);
  const snapshotAfterWrite = writeIndexes.some((write) =>
    snapshotIndexes.some((shot) => shot > write),
  );
  const snapshotDrivenCorrection = snapshotIndexes.some((first) =>
    writeIndexes.some((write) => write > first && snapshotIndexes.some((second) => second > write)),
  );
  const metrics = {
    schema_valid: trace.code === 0,
    correct_template_and_theme:
      /canvas:\/\/templates\//.test(resources) && /canvas:\/\/themes\//.test(resources),
    semantic_tokens: /theme_id|--color-(?:background|foreground|primary|surface)/.test(authored),
    required_states: scenario.detail !== "detailed" || hasRequiredStates(authored),
    no_unresolved_references: !/unresolved_(?:asset|reference|refs)/i.test(warningText),
    no_unintended_overlap_or_clipping: !/node_overlap|out_of_bounds|content_overflow/i.test(
      warningText,
    ),
    snapshot_after_write: snapshotAfterWrite,
    snapshot_driven_correction: snapshotDrivenCorrection,
    no_internal_marker_leakage: !/system prompt|internal[-_ ]only|__meta|PLAN\.md/i.test(authored),
    bounded_iterations: writeIndexes.length > 0 && writeIndexes.length <= 8,
  };
  const score =
    Object.entries(rubric.automated).reduce(
      (sum, [key, weight]) => sum + (metrics[key] ? weight : 0),
      0,
    ) / 100;
  return {
    provider,
    scenario_id: scenario.id,
    category: scenario.category,
    detail: scenario.detail,
    exit_code: trace.code,
    duration_ms: trace.duration_ms,
    tool_calls: visualCalls.length,
    iterations: writeIndexes.length,
    snapshots: snapshotIndexes.length,
    canvas_refs: parsed.refs,
    warnings: parsed.warnings,
    usage: parsed.usage,
    metrics,
    score,
    snapshot_pngs: parsed.pngs,
    failure_refs: Object.entries(metrics)
      .filter(([, pass]) => !pass)
      .map(([metric]) => ({
        scenario: scenario.id,
        metric,
        trace: `${provider}/${scenario.id}.jsonl`,
      })),
  };
}
