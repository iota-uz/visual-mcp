import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const arg = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const goldenPath = arg("golden") ?? join(root, "latest-report.json");
const routingPath = arg("routing") ?? join(root, "latest-routing-report.json");
const reviewPath = arg("review");
const certificationId = arg("id") ?? new Date().toISOString().slice(0, 10);
const [golden, routing, review] = await Promise.all([
  readFile(goldenPath, "utf8").then(JSON.parse),
  readFile(routingPath, "utf8").then(JSON.parse),
  reviewPath ? readFile(reviewPath, "utf8").then(JSON.parse) : Promise.resolve(null),
]);

const gates = {
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
  routing_recall: routing.results.every((item) => item.recall >= 0.9),
  routing_negative_precision: routing.results.every((item) => item.negative_precision >= 0.95),
  snapshot_adherence: golden.aggregate.snapshot_adherence >= 0.9,
  no_critical_unresolved: golden.aggregate.unresolved_scenarios === 0,
  no_clipping: golden.aggregate.clipping_scenarios === 0,
  no_internal_leakage: golden.aggregate.internal_leakage_scenarios === 0,
  blinded_human_preference: review?.candidate_preference_rate >= 0.8,
};
const failures = Object.entries(gates)
  .filter(([, passed]) => !passed)
  .map(([gate]) => ({ gate }));
const report = {
  schema_version: 1,
  certification_id: certificationId,
  generated_at: new Date().toISOString(),
  status: failures.length === 0 ? "certified" : "failed",
  inputs: { golden: goldenPath, routing: routingPath, review: reviewPath ?? null },
  gates,
  failures,
  golden_failures: golden.failures,
  routing_failures: routing.results.flatMap((result) =>
    result.decisions
      .filter((item) => !item.correct)
      .map((item) => ({ provider: result.provider, ...item })),
  ),
};
await mkdir(join(root, "certifications"), { recursive: true });
const outputPath = join(root, "certifications", `${certificationId}.json`);
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, output: outputPath, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
