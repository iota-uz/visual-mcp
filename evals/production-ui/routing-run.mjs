import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(await readFile(join(root, "routing-cases.json"), "utf8"));
const args = new Set(process.argv.slice(2));
const providerArg = process.argv.find((value) => value.startsWith("--provider="));
const providers = providerArg ? [providerArg.split("=")[1]] : ["codex", "claude"];
const live = args.has("--live");
const siteUrl = process.env.VISUAL_CANVAS_EVAL_URL ?? "http://127.0.0.1:3213";
const token = process.env.VISUAL_CANVAS_EVAL_TOKEN ?? "vct_localdevagenttoken0000000000000000";
const runId =
  process.env.VISUAL_CANVAS_EVAL_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, "routing-runs", runId);

function execute(command, commandArgs, prompt) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(prompt);
  });
}

async function listToolMetadata() {
  const response = await fetch(`${siteUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  if (!response.ok) throw new Error(`tools/list failed with HTTP ${response.status}`);
  const body = await response.text();
  const payload = body.startsWith("event:")
    ? JSON.parse(
        body
          .split(/\r?\n/)
          .find((line) => line.startsWith("data: "))
          ?.slice(6) ?? "null",
      )
    : JSON.parse(body);
  return payload.result.tools.map(({ name, description }) => ({ name, description }));
}

function routingPrompt(toolMetadata) {
  return `Evaluate the following exact Visual Canvas tool names and descriptions. Do not invent aliases and do not call a tool. For each case choose exactly one name from this catalog, or null when Visual Canvas should not be used. Return only a JSON array of objects with id and predicted.\nTOOLS:\n${JSON.stringify(toolMetadata)}\nCASES:\n${JSON.stringify(cases.map((item, id) => ({ id, query: item.query })))}`;
}

async function runProvider(provider, toolMetadata) {
  if (provider === "codex") {
    return execute(
      "codex",
      [
        "exec",
        "-",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c",
        `mcp_servers.visual-canvas-local.url="${siteUrl}/mcp"`,
        "-c",
        `mcp_servers.visual-canvas-local.http_headers={Authorization="Bearer ${token}"}`,
      ],
      routingPrompt(toolMetadata),
    );
  }
  const config = JSON.stringify({
    mcpServers: {
      "visual-canvas-local": {
        type: "http",
        url: `${siteUrl}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  });
  return execute(
    "claude",
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--mcp-config",
      config,
      "--strict-mcp-config",
      "-",
    ],
    routingPrompt(toolMetadata),
  );
}

function extractAnswer(provider, text) {
  const events = text.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const candidates =
    provider === "codex"
      ? events
          .filter(
            (event) => event.type === "item.completed" && event.item?.type === "agent_message",
          )
          .map((event) => event.item.text)
      : events
          .flatMap((event) => [
            event.result,
            event.message?.content
              ?.map?.((block) => block.text)
              .filter(Boolean)
              .join("\n"),
          ])
          .filter(Boolean);
  const raw = candidates.at(-1) ?? "";
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Provider ${provider} did not return a JSON array`);
  return JSON.parse(match[0]);
}

await mkdir(runDir, { recursive: true });
const toolMetadata = await listToolMetadata();
const results = [];
for (const provider of providers) {
  const tracePath = join(runDir, `${provider}.jsonl`);
  let trace;
  if (live) {
    trace = await runProvider(provider, toolMetadata);
    await writeFile(
      tracePath,
      trace.stdout +
        (trace.stderr ? `\n${JSON.stringify({ type: "stderr", text: trace.stderr })}\n` : ""),
    );
  } else {
    try {
      trace = { code: 0, stdout: await readFile(tracePath, "utf8") };
    } catch {
      trace = { code: 1, stdout: "" };
    }
  }
  let predictions = [];
  let parseError = null;
  try {
    predictions = extractAnswer(provider, trace.stdout);
  } catch (error) {
    parseError = String(error);
  }
  const byId = new Map(predictions.map((item) => [item.id, item.predicted ?? null]));
  const decisions = cases.map((item, id) => ({
    id,
    query: item.query,
    expected: item.expected,
    predicted: byId.get(id) ?? null,
    correct: (byId.get(id) ?? null) === item.expected,
  }));
  const positives = decisions.filter((item) => item.expected !== null);
  const negatives = decisions.filter((item) => item.expected === null);
  const recall = positives.filter((item) => item.correct).length / positives.length;
  const negativePrecision = negatives.filter((item) => item.correct).length / negatives.length;
  results.push({
    provider,
    exit_code: trace.code,
    parse_error: parseError,
    recall,
    negative_precision: negativePrecision,
    passed: trace.code === 0 && !parseError && recall >= 0.9 && negativePrecision >= 0.95,
    decisions,
  });
}
const report = {
  schema_version: 1,
  run_id: runId,
  generated_at: new Date().toISOString(),
  thresholds: { recall: 0.9, negative_precision: 0.95 },
  results,
  passed: results.every((item) => item.passed),
};
await writeFile(join(runDir, "report.json"), JSON.stringify(report, null, 2));
await writeFile(join(root, "latest-routing-report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    results.map(({ provider, recall, negative_precision, passed }) => ({
      provider,
      recall,
      negative_precision,
      passed,
    })),
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
