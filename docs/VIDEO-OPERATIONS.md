# Video Studio operations

The implementation contract is in `docs/VIDEO-PLAN.md` (current sections 13–14)
and `apps/mcp/src/video/README.md`. This document describes operating boundaries,
not proof of live model quality or human approval.

## Service boundary

- UI: `https://canvas.iota.uz`; existing authenticated IOTA workspace access.
- Canvas tools: `/mcp`; video tools: `/mcp/video`. Native harness discovery is
  sufficient; domain resource lookup is not a duplicate tool-search service.
- Existing Convex deployment: `giddy-retriever-468`. It serves the live app even
  though its deployment type is `dev`. Never select another deployment merely
  because it is called `prod`.
- Existing Railway web, MCP and worker services; existing private asset bucket.
- MCP and worker share `MCP_EXECUTE_BROKER_ORIGIN=http://mcp.railway.internal:8080`.
  This callback is internal, not the public SPA proxy.
- Provider keys belong only in Convex configuration, sourced from Notion
  Passwords & Tokens. Never copy them to browser bundles, worker children,
  repository files or run reports.

OpenAI uses the explicit `gpt-image-2.5-sunburst` family contract; Gemini uses
`gemini-3.8-flash` when configured. ElevenLabs and Higgsfield require their own
server credentials. A configured key or model listing is not a successful paid
generation test. Codex should prefer its built-in image generation and import
the result through verified upload; Claude has its separate repository wrapper.

## Human review and recovery

Project previews are under `/v/:projectId`; projectless receipts open `/jobs/:id`.
Only complete exact-version renders can receive human approval. Old approvals do
not transfer to new checkpoints. A human can pause a loop, explicitly abandon
an invalidated proposal and resume within the original limits. Agents cannot
approve on the human's behalf.

Reuse an operation's original idempotency key after an uncertain response.
Inspect its job/effect receipt before doing anything else. Reconcile known
stored bytes instead of starting generation again. Cancellation is a request,
not evidence that an upstream charge or provider operation was cancelled.

Critique summaries are bounded; the immutable full report is available through
its pinned resource. Model uncertainty, technical measurements and human approval
remain separate. Technical QA reports unmeasured text layout/artistic quality as
`not_evaluated`, not as passing checks.

New snapshot-backed video lists have explicit capture/cache limits and cursor
expiry. A service restart or cache eviction requires starting a new snapshot;
never combine its pages with an earlier snapshot. Legacy Canvas and external
provider-native paging retain their documented contracts.

## Migration

`scripts/migrate-reels.ts` defaults to a read-only dry run. Supply a WAL-consistent
backup, its independently checked SHA-256 and the exact source `assets` directory.
Unknown source tables and unsupported audio mappings fail preflight.

Apply is explicit and resumable. Production requires the exact confirmed Convex
URL. `--convex-cli --convex-env-file <selector>` uses the already authenticated
installed CLI without extracting an admin key; it never pushes code. The source
SQLite database, source repository and original files are not modified.

Original records and media remain an immutable archive accessible in Video Studio.
Editable native RU/UZ checkpoints have new manifest hashes and require new renders.
Historical jobs, observations and feedback do not become live jobs, trusted
evidence or human approvals. Private-to-public GitHub task copying requires an
explicit disclosure decision; do not delete the private originals.

## Release and rollback

Railway currently auto-deploys all three services from `main` without waiting for
GitHub checks. **Pushing main is a release.** Freeze writers and run build,
typecheck, tests, Biome, isolated MCP integration and actual worker rendering
before pushing. Record the exact source SHA and prior Railway deployment IDs.
Deploy the compatible Convex functions before exposing new web/MCP consumers.

Verify the deployed revision, authenticated tool calls, internal execute callback,
ready asset bytes, rendered output and user-facing deep links. Health checks alone
do not establish pipeline correctness. Paid provider pilots are separate from
offline fixtures and require the operator's agreed scope.

Railway applications can be rolled back to their recorded prior deployments.
Do not blindly roll back the Convex schema after new audio assets/video records
exist: the old schema cannot describe all new data. Preserve additive tables and
validators, disable the affected surface or apply a reviewed compatible fix.
Never delete migrated assets or replay paid jobs as a rollback shortcut.
