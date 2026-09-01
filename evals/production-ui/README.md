# Production UI evaluation

This provider-agnostic harness runs the same golden scenarios through Codex and Claude against a local authenticated MCP server. The set covers dashboards, operational/admin UI, mobile flows, forms/checkout, reports/data views, and repair of low-quality UI, with detailed, short, and ambiguous prompts. Each run uses a unique canvas ref and stores raw JSONL traces, actual PNG snapshot blocks, duration/token events, canvas refs, tool calls, iterations, warnings, and failure references. `report.json` maps every failed metric back to its scenario and trace.

Run the local stack and worker, then execute `npm run eval:production-ui -- --live`. Restrict a run with `--provider=codex`, `--provider=claude`, or `--scenario=<id>`. Set `VISUAL_CANVAS_EVAL_URL`, `VISUAL_CANVAS_EVAL_TOKEN`, and `VISUAL_CANVAS_EVAL_RUN_ID` to override defaults. Without `--live`, the runner re-scores retained traces and fails closed when evidence is missing.

Run `npm run eval:routing -- --live` to classify the direct, indirect, and negative cases against the exact names and descriptions returned by MCP `tools/list`. The routing report gates each provider at 90% positive recall and 95% negative precision.

The repeated `Use / Do not use / Prefer / Side effects / Retry / Errors` contract is the default `current` baseline because it reinforces routing in long-lived contexts. Measure changes instead of deleting it mechanically:

```sh
npm run eval:routing -- --live --description-variant=current --context-chars=100000
npm run eval:routing -- --live --description-variant=compact-routing --context-chars=100000
npm run eval:routing -- --live --description-variant=base-only --context-chars=100000
```

Compare `catalog.estimated_tokens`, positive recall, and negative precision. A smaller catalog is acceptable only when both providers still meet the existing 90% / 95% gates at short and long context lengths.

For blinded review, run `npm run eval:pairwise -- --baseline=<baseline-snapshot-dir> --candidate=<candidate-snapshot-dir> --output=<review-dir>`. Give reviewers only `review.json` and the shuffled `pairs/` images; keep `key.json` concealed. After every `choice` is A, B, or tie, run `npm run eval:pairwise -- --score --output=<review-dir>`.

Create the versioned release decision with `npm run eval:certify -- --golden=<report.json> --routing=<routing-report.json> --review=<pairwise-result.json> --id=<version>`. Certification fails unless both clients completed all scenarios, routing and snapshot thresholds pass, unresolved/clipping/leakage counts are zero, and blinded candidate preference is at least 80%.

Automated scores are necessary but not sufficient. Reviewers compare blinded baseline/candidate snapshot pairs using `rubric.json`; certification requires at least 80% candidate preference. Missing traces, one-client runs, partial scenario sets, or pending human review cannot be represented as a passing release.
