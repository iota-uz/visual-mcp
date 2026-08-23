import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { certificationGates, validateProductionRubric } from "./lib.mjs";

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
const [golden, routing, review, rubric] = await Promise.all([
  readFile(goldenPath, "utf8").then(JSON.parse),
  readFile(routingPath, "utf8").then(JSON.parse),
  reviewPath ? readFile(reviewPath, "utf8").then(JSON.parse) : Promise.resolve(null),
  readFile(join(root, "rubric.json"), "utf8").then(JSON.parse).then(validateProductionRubric),
]);

const gates = certificationGates(golden, routing, review, rubric);
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
