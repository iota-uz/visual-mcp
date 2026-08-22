import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const value = (name) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const mode = process.argv.includes("--score") ? "score" : "prepare";
const output = value("output") ?? join(root, "pairwise-review");

if (mode === "prepare") {
  const baseline = value("baseline");
  const candidate = value("candidate");
  if (!baseline || !candidate)
    throw new Error("Pass --baseline=<snapshot-dir> and --candidate=<snapshot-dir>");
  const candidateFiles = (await readdir(candidate, { recursive: true }))
    .filter((path) => path.endsWith(".png"))
    .sort();
  const pairs = [];
  const key = [];
  await mkdir(join(output, "pairs"), { recursive: true });
  for (const [index, relPath] of candidateFiles.entries()) {
    const baselinePath = join(baseline, relPath);
    const candidatePath = join(candidate, relPath);
    const pairId = `${String(index + 1).padStart(3, "0")}-${basename(relPath, ".png")}`;
    const candidateLabel =
      Number.parseInt(createHash("sha256").update(relPath).digest("hex")[0], 16) % 2 === 0
        ? "A"
        : "B";
    const aSource = candidateLabel === "A" ? candidatePath : baselinePath;
    const bSource = candidateLabel === "B" ? candidatePath : baselinePath;
    await copyFile(aSource, join(output, "pairs", `${pairId}-A.png`));
    await copyFile(bSource, join(output, "pairs", `${pairId}-B.png`));
    pairs.push({
      id: pairId,
      source: relPath,
      A: `pairs/${pairId}-A.png`,
      B: `pairs/${pairId}-B.png`,
      choice: null,
      notes: "",
    });
    key.push({
      id: pairId,
      candidate: candidateLabel,
      baseline: candidateLabel === "A" ? "B" : "A",
    });
  }
  await writeFile(
    join(output, "review.json"),
    JSON.stringify(
      {
        blind: true,
        dimensions: ["hierarchy", "legibility", "task_fit", "visual_polish", "trustworthiness"],
        choices: ["A", "B", "tie"],
        pairs,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(output, "key.json"),
    JSON.stringify(
      { baseline: relative(output, baseline), candidate: relative(output, candidate), pairs: key },
      null,
      2,
    ),
  );
  console.log(`Prepared ${pairs.length} blinded pairs in ${output}`);
} else {
  const review = JSON.parse(await readFile(join(output, "review.json"), "utf8"));
  const key = JSON.parse(await readFile(join(output, "key.json"), "utf8"));
  const keyById = new Map(key.pairs.map((item) => [item.id, item]));
  const incomplete = review.pairs.filter((item) => !["A", "B", "tie"].includes(item.choice));
  if (incomplete.length > 0)
    throw new Error(`${incomplete.length} pairwise choices are incomplete`);
  const candidateWins = review.pairs.filter(
    (item) => item.choice === keyById.get(item.id)?.candidate,
  ).length;
  const baselineWins = review.pairs.filter(
    (item) => item.choice === keyById.get(item.id)?.baseline,
  ).length;
  const ties = review.pairs.filter((item) => item.choice === "tie").length;
  const preferenceRate = candidateWins / review.pairs.length;
  const result = {
    reviewed: review.pairs.length,
    candidate_wins: candidateWins,
    baseline_wins: baselineWins,
    ties,
    candidate_preference_rate: preferenceRate,
    passed: preferenceRate >= 0.8,
  };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
