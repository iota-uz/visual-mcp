# RMCP agent-usage audit — implementation summary

Audit window: 2026-08-18 13:44:39 through 2026-09-01 13:59:03
(Asia/Tashkent, UTC+05:00). The review covered 12 relevant Codex and Claude Code
threads, 1,457 direct RMCP calls, and later repository changes through the end
of the window. Historical problems already fixed by later commits were excluded
from the active backlog.

Raw transcript-derived call rows are intentionally not committed: they contain
local paths and user-authored canvas content. The counts below come from the
local evidence set retained by the audit author.

## Implemented findings

| Priority | Observed problem and time | Reconciliation at audit time | Change in this PR |
| --- | --- | --- | --- |
| P0 | Three `canvas_snapshot` responses failed strict client validation with `data must NOT have additional properties`, 2026-08-29 14:34:45–17:10:27. | No later commit had changed the relevant strict output boundary. | One canonical strict schema now validates the payload before return; snapshot no longer mixes the separate embed contract into its result; the published catalog shape has a transport regression test. A live Claude/Codex compatibility run remains a release check. |
| P1 | The 2026-09-01 catalog contained 188,376 description characters, including 119,928 characters of repeated routing reinforcement. | Intentional freshness behavior, not a proven defect; retained by ADR. | The current contract remains the baseline. Routing evals can now compare `current`, `compact-routing`, and `base-only` at configurable long-context lengths while recording catalog size. Existing 90% recall and 95% negative-precision gates remain mandatory. |
| P1 | Single-file read/edit loops dominated usage; unsupported source-context search appeared at 2026-08-23 22:27:35. | Still active. | `canvas_file_get` reads up to 20 bounded projections, `canvas_edit` applies up to 50 ordered exact edits atomically, and read-only `canvas_file_search` returns bounded literal matches. |
| P1 | Agents alternated `path`/`file_path` and omitted `include:["doc"]` for `doc_projection`, observed 2026-08-21 12:49:56–2026-08-31 21:53:13. | Embed input documentation had improved on 2026-09-01; the path and projection issues remained. | File operations consistently use `path`; `doc_projection` now implies the `doc` facet. |
| P2 | Snapshot payloads accounted for 36.4M result characters (88.6% of direct result characters) across the window. | Active by design; client image-token accounting varies. | `response_mode:"link"` returns metadata plus a download URL without an image block; oversized snapshots continue to fall back to links automatically. |
| P2 | Continuation required manually copying a large cursor and version; malformed use was observed at 2026-08-29 17:10:27. | Active, low frequency. | Every unfinished `canvas_get` facet now returns a ready-to-call, version-pinned `next_request`. |

## Verification

- MCP schema, edit atomicity, bounded projection/search, and transport contract
  tests pass.
- All repository typechecks and 609 workspace tests pass.
- Routing eval unit tests pass. Live provider A/B runs are deliberately separate
  because they consume model capacity and require the local authenticated stack.
- The repository-wide formatter/linter passes; it only warns that the local raw
  `calls.json` evidence file exceeds the configured formatter size limit.
