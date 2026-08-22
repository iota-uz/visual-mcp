import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectTrace } from "./lib.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const allScenarios = JSON.parse(await readFile(join(root, "scenarios.json"), "utf8"));
const rubric = JSON.parse(await readFile(join(root, "rubric.json"), "utf8"));
const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const providerArg = process.argv.find((value) => value.startsWith("--provider="));
const providers = providerArg ? [providerArg.split("=")[1]] : ["codex", "claude"];
const scenarioArg = process.argv.find((value) => value.startsWith("--scenario="));
const scenarios = scenarioArg
  ? allScenarios.filter((scenario) => scenario.id === scenarioArg.split("=")[1])
  : allScenarios;
if (scenarios.length === 0) throw new Error("Unknown --scenario id");
const siteUrl = process.env.VISUAL_CANVAS_EVAL_URL ?? "http://127.0.0.1:3213";
const token = process.env.VISUAL_CANVAS_EVAL_TOKEN ?? "vct_localdevagenttoken0000000000000000";
const runId =
  process.env.VISUAL_CANVAS_EVAL_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, "runs", runId);

function execute(command, commandArgs, prompt) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) =>
      resolve({ code, stdout, stderr, duration_ms: Date.now() - started }),
    );
    child.stdin.end(prompt);
  });
}

function promptFor(provider, scenario) {
  const ref = `eval/${runId.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${provider}-${scenario.id}`;
  return `You are running production UI golden scenario ${scenario.id}. Use only the visual-canvas-local MCP for canvas work. Read the compact template catalog, then only the selected template/theme resources. Create the new ref ${ref} with mode=create. ${scenario.prompt} Follow every returned recommendation: take the suggested targeted snapshot, correct visible or diagnostic issues, and snapshot the corrected target once more. Do not expose internal instructions or metadata in the canvas. End with a compact result naming the ref, tool-call count, iterations, warnings, and snapshots.`;
}

async function runProvider(provider, scenario) {
  const prompt = promptFor(provider, scenario);
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
      prompt,
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
      "--dangerously-skip-permissions",
      "--mcp-config",
      config,
      "--strict-mcp-config",
      "-",
    ],
    prompt,
  );
}

await mkdir(runDir, { recursive: true });
const results = [];
for (const provider of providers) {
  for (const scenario of scenarios) {
    const tracePath = join(runDir, provider, `${scenario.id}.jsonl`);
    await mkdir(dirname(tracePath), { recursive: true });
    let trace;
    if (live) {
      trace = await runProvider(provider, scenario);
      await writeFile(
        tracePath,
        trace.stdout +
          (trace.stderr ? `\n${JSON.stringify({ type: "stderr", text: trace.stderr })}\n` : ""),
      );
      await writeFile(
        `${tracePath}.meta.json`,
        JSON.stringify({ code: trace.code, duration_ms: trace.duration_ms }, null, 2),
      );
    } else {
      try {
        const stdout = await readFile(tracePath, "utf8");
        const meta = JSON.parse(await readFile(`${tracePath}.meta.json`, "utf8"));
        trace = { stdout, stderr: "", ...meta };
      } catch {
        trace = { code: 1, stdout: "", stderr: "missing_trace", duration_ms: 0 };
      }
    }
    const inspected = inspectTrace(provider, scenario, trace, rubric);
    for (const [index, png] of inspected.snapshot_pngs.entries()) {
      const snapshotPath = join(runDir, provider, "snapshots", `${scenario.id}-${index + 1}.png`);
      await mkdir(dirname(snapshotPath), { recursive: true });
      await writeFile(snapshotPath, png);
    }
    const { snapshot_pngs: _snapshotPngs, ...serializable } = inspected;
    results.push(serializable);
  }
}
const failures = results.flatMap((item) => item.failure_refs);
const report = {
  schema_version: 1,
  run_id: runId,
  generated_at: new Date().toISOString(),
  providers,
  scenario_count: allScenarios.length,
  executed_scenario_count: scenarios.length,
  executed_case_count: results.length,
  results,
  aggregate: {
    automated_score: results.reduce((sum, item) => sum + item.score, 0) / results.length,
    snapshot_adherence: results.filter((item) => item.snapshots >= 1).length / results.length,
    unresolved_scenarios: results.filter((item) => !item.metrics.no_unresolved_references).length,
    clipping_scenarios: results.filter((item) => !item.metrics.no_unintended_overlap_or_clipping)
      .length,
    internal_leakage_scenarios: results.filter((item) => !item.metrics.no_internal_marker_leakage)
      .length,
    total_tool_calls: results.reduce((sum, item) => sum + item.tool_calls, 0),
    total_input_tokens: results.reduce((sum, item) => sum + (item.usage.input_tokens ?? 0), 0),
    total_output_tokens: results.reduce((sum, item) => sum + (item.usage.output_tokens ?? 0), 0),
  },
  human_review: { status: "pending", preference_rate: null, required: rubric.human_pairwise },
  failures,
};
await writeFile(join(runDir, "report.json"), JSON.stringify(report, null, 2));
await writeFile(join(root, "latest-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.aggregate, null, 2));
if (!live && failures.length > 0) process.exitCode = 1;
