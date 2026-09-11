# Canvas and Video MCP

The single `/mcp` route advertises Canvas authoring, video projects/documents/
checkpoints, media producers, inspection, context/profile/loops, feedback,
learning and publication analytics. Assets, comments, uploads, jobs and resources
are registered once. The former `/mcp/video` route is removed. Execute is exposed
when configured and uses the same complete published catalog.
Paid calls require explicit allowPaid and available server configuration. No
approval, automatic publication or redundant tool-search endpoint is exposed.

Legacy Canvas `asset_upload_url`/`asset_finalize` stay compatible. The exact-byte,
idempotent lifecycle is explicitly named `asset_upload_reserve`,
`asset_upload_status`, `asset_upload_finalize`, with a decimal 2,000,000,000-byte
ceiling. `video_inspect` reads registered metadata only and never creates work.

`registry.ts` is the input/output schema and dispatch source. `callVideoTool` is
the shared validated call boundary for direct MCP and broker composition.
Schemas for brief, script, timeline and
patch operations come from `@visual-canvas/video`, not a parallel business model.
Top-level tool arguments/results are snake_case; nested document keys remain the
canonical camelCase model shared with UI. Patch the exact keys returned by reads.

`gateway.ts` sends a server-selected token ID, allowlisted operation and camelCase
arguments to the existing trusted gateway. Convex revalidates that token before
the internal operation, derives identity itself, and executes the same handler
used by the authenticated UI. No principal ID is accepted in public tool inputs.

The public schema is strict. Standard Schema delegates validation into the common
handler so SDK prevalidation cannot discard the structured recovery envelope.
Both success and error are declared in outputSchema; text and structuredContent
are serialized from one payload, with external isError for failures. Unknown
tools still produce protocol errors. Unexpected write failures retain unknown
effect and do not automatically repeat a write.

`video_project_create` derives a stable operation receipt from the workspace and
original idempotency key before dispatch. Success and unknown-outcome errors both
return that identity. `video_operation_get` performs an exact authenticated lookup
with the receipt fields (or the unchanged original key): an applied operation
returns the original project, while an absent record remains truthfully `unknown`
because a concurrent request may still commit. Only an exact same-input, same-key
create replay is safe; a new key can duplicate the project.

Project create/list/reconciliation accept either the canonical workspace document
ID or its exact slug. Convex resolves the reference before its validated operation;
an unknown workspace is a domain error rather than a transport availability error.

New Video domain lists capture one atomic Convex query capped at 100 records and 4 MiB,
then page immutable server-side rows. Oversized collections fail explicitly and
require narrower filters; no live partial fallback. Provider voice lists similarly
capture one bounded response, without claiming provider-side database isolation.
Cursors bind token/principal, parsed filters/page size/tool and one-hour expiry.
Untouched legacy Canvas pagination retains its existing contracts and does not
gain snapshot guarantees. Cache is bounded to 128 snapshots/32 MiB; restart/eviction requires restarting the
list, not combining snapshots. Every request remains authenticated. Resource and
individual effect chunks bind exact immutable content hashes.

Full critique findings/criteria are readable using
`resource_get(video://reports/{job_id}/{reportSha256})`. The job authorizes the
registered report, signed bytes are size/SHA-256 checked, and UTF-8 chunks are
bounded and hash-pinned. Concatenate chunks before parsing JSON; job_get remains
a compact summary. Reports support the producer's 16 MiB bound; a two-entry,
five-minute verified-byte cache avoids downloading a full report for every chunk,
while job/asset authorization is checked on every read. Execute enforces the
report job's workspace scope. Byte-page cursors are signed and expire on restart.

Contract checks use the actual installed SDK 2.0.0 HTTP handler. Official sources
checked 2026-09-10: [MCP tools, stable 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
and [TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/). Historical
design wording is preserved separately in `docs/VIDEO-PLAN.md`.

Acceptance here is deterministic schema/transport/gateway testing, not a claim
of improved agent behavior, production deployment or successful media generation.

Railway `/healthz` verifies Video backend contract version 1 through the private
Convex gateway. This deliberately keeps an MCP revision unhealthy when its
allowlisted Convex functions have not been deployed yet; publish Convex first,
then let Railway promote the matching MCP revision.

## Execute transport and recovery

`execute.ts` submits a durable Convex job, then claims it once. Code runs in the
existing runtime on the worker service, not in the MCP server process. The worker
parent calls `/internal/video-execute-broker` with a short-lived run capability;
the code isolate receives no callback token and has an empty process environment.
Worker `MCP_EXECUTE_BROKER_ORIGIN` must match the MCP service origin configured on
the MCP coordinator. The worker rejects other origins/paths and redirects.

An accepted callback is workspace-checked, schema-validated by the common handler
and journaled before dispatch. Registry-schema hash fencing prevents new calls
after definitions change. Duplicate call IDs never redispatch. Job completion
and effect completion are separate: an earlier successful write is retained even
if later code throws. Claim expiry becomes outcome_unknown; it never reruns code.
A queued receipt can be claimed after replay because code has not run yet.

`tools.<published_name>(args)` resolves to the tool's structured data. Original
MCP content remains available on the non-enumerable `__mcpContent` property;
ToolCallError carries code/effect/recovery/content. Inputs are a separate global,
context is frozen, top-level await works via the existing TS async-wrapper
transpile (not full ESM/typechecking). Emit is explicit and byte-bounded. Pending
accepted calls drain before successful code completion. Console overflow sets
output_truncated; emit overflow fails rather than pretending complete output.

This is internal-IOTA worker_threads/node:vm execution, not a microVM/hostile-code
boundary. Network access remains available and untracked. `tool_access` governs
only broker calls; execute annotations are readOnlyHint:false/idempotentHint:false.
The result explicitly carries broker_only accounting and possible untracked
network effects. Cancel blocks new broker dispatch; it cannot roll back a write.

`canvas-catalog.ts` captures actual per-request Canvas registration schemas and
authenticated callbacks; direct and broker calls execute those same closures.
The unified captured catalog is hash-fenced and workspace-checked. Both Canvas
and Video domain operations can be composed in one execute run. Personal-library
or global-discovery Canvas calls require a direct tool; a workspace-scoped run
cannot silently switch libraries. Recursive execute/canvas_run is unavailable.
Typed job readers cover every registered job kind, including actual render,
critique, media processing and offline evaluation results. Unknown/partial write
effects remain unknown in the summary journal, never falsely not-applied.

An atomic 120-second queued-admission watchdog closes never-started execute
receipts as not-applied. Same-key replay may claim only before expiry; a journal
contradiction remains unknown. Already-running code is never replayed. Actual Linux
container/deployment and paid media pilots remain separate release checks.

## Context and bounded iteration

`workflow.ts` registers eight tools on the same common boundary. Convex owns
deterministic state, not reasoning. Project creation initializes one loop per
language and an empty profile; existing projects require the migration initializer.
Profiles use CAS, immutable revisions and attributed registered source bytes.
Checkpoint manifests pin profile revisions. Unknown remains null, sourced is
not independently verified, and explicit user direction outranks suggestions.

Context is exact-version/role/scene/shot scoped with neighboring scenes, source
references, a content hash and byte bound. Blind critic context omits author
script, intent, prior scores and accumulated critique; reviewer is a separate
compliance role. Role labels do not prevent a caller from contaminating context
outside these tools. Feedback and supported-memory projections are bounded and
mark omitted overflow; QA returns trusted evidence receipts only outside blind
critic context. Imported statements and caller-reported user direction are
attributed, not cryptographically proved human messages.

Proposals consume one iteration slot, pin rubric/workflow/limits, require observed
reference, and reject parallel pending decisions. Selection requires current
descendant candidate and matching exact media hashes with passing technical and
independent video receipts, not arbitrary caller pass flags. Revert preserves the
selected reference and advances no-progress. Limits cannot reset on resume.
Only trusted provider/worker actions can register evidence; that internal function
has no agent gateway or MCP entry. Source/profile attribution is not human approval.

Human comments advance a workflow input revision in the same transaction,
invalidating stale decisions. Human pause cannot be downgraded by an agent pause
then resume. Producer submit/claim/dispatch share pause admission. Cancellation
records a request for running jobs; late results may still be saved and charged.
No path creates human approval or publishes media.

Provider/worker completion and evidence receipts are committed atomically by the
trusted backend. Rubric policy is canonicalized by video_rubric_resolve; render
and critique must use the same exact policy, not merely the same rubric prose.
Universal model limitations are not blocking uncertainty; incomplete coverage,
missing criteria or explicit failures cannot become a passing selection.

Authenticated humans can explicitly abandon an invalidated pending proposal with
an actor/reason record; this pauses the loop without resetting spent bounds or
silently rebasing a proposal. Agents cannot invoke this human path. Shot context
projects planned duration/handles, explicit clip bindings, exact frame timebase,
source trims/layout and registered hashes; missing bindings are not inferred.
Source corpus migration and live independent-agent quality trials are
separate evidence; deterministic fixtures do not predict views.

## Resources, learning and harnesses

resource_find/get reuse the actual native resource callbacks: existing Canvas
guides/templates/themes, installed reviewed component/effect schemas and real
server model configuration. They do not describe tools or fetch arbitrary URLs.
Resource bytes are hash-pinned and bounded; configured is not account-verified.

workflow-contract-v1 runs five actual Convex transition fixtures inside isolated
transactions, records assertions, then rolls their writes back with a checked
internal sentinel. evidence-consistency-v1 audits registered reports, split
leakage and regressions; it is not an agent/perception benchmark. Memory starts
as a proposal and requires independent evidence plus development/heldout support;
single-reel feedback never silently becomes a supported production rule.
Publication metadata is attributed and revisioned, not proof of an external
post. Analytics preserve unknown/null, metric definitions, windows and source
identity; incompatible cohorts and causal uncertainty remain explicit.

Shared workflows live in `.agents/skills/video-production` and `video-review`.
Codex wrappers use `.agents/skills/*/SKILL.md`; Claude wrappers use
`.claude/skills/*/SKILL.md` and relative symlinks. Only Claude has video-image;
Codex prefers its built-in image generation. Critic profiles follow current
[Codex TOML schema](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agent-file-schema)
and [Claude frontmatter schema](https://code.claude.com/docs/en/sub-agents).
File-level read-only settings do not imply MCP write isolation. Subagent
capabilities must be checked in the actual harness; never claim inherited tools
or a fresh blind context when the harness does not provide them.

`scripts/video-integration-smoke.mjs` is a coordinator-invoked loopback-only
actual installed SDK client → MCP → local Convex → worker fixture driver. Its
in-memory auth/token is never saved, and its minted MCP token is revoked. It
leaves labeled local records for inspection and explicitly excludes paid calls,
media quality and approval claims. Do not run it against production.
