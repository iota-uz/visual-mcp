# Source notes: Visual Canvas MCP agent-usage audit

Generated: 2026-08-20T13:00:08Z  
Repository snapshot: `3366652` plus the pre-existing uncommitted working tree.

## Scope and counting rules

- The inventory covered 897 JSONL transcripts (760 Claude Code, 137 Codex) inside 2,468 session-related local files.
- A product-scenario call is an actual Visual Canvas MCP invocation reconstructed from native tool calls and loop-expanded bridge calls. Static call sites inside loops were expanded where the transcript exposed the loop cardinality.
- `bridge` means a Claude Python REPL `mcp.call("visual-canvas", ...)` workflow. Normal Codex nested-tool execution is classified as native client use, not as a bridge.
- The three product scenarios contain 450 reconstructed calls: EAI polish 170, farq gallery 149, Codex OSAGO 131. The MCP-development session adds 22 direct live calls and raw JSON-RPC E2E scripts that were not added to the product total.
- Counts are a point-in-time snapshot. The EAI transcript was still active during the audit; its final scan contained 120 native calls plus 50 reconstructed bridge calls.

## Product session corpus

### Claude Code — EAI mobile product polish

Transcript: `/Users/diyorkhaydarov/.claude/projects/-Users-diyorkhaydarov-Projects-eai-mobile/1127f29f-0441-405f-99a3-25c38159924d.jsonl`

- Request at line 7: polish the shared canvas and remove generic AI-looking design.
- Native call snapshot: 30 `canvas_edit`, 24 `canvas_upload_url`, 19 `canvas_snapshot`, 13 `canvas_get`, 13 `canvas_doc_patch`, 12 `canvas_save`, 9 `canvas_find`.
- Bridge calls reconstructed from Python REPL: 10 edit, 9 get, 4 save, 4 doc patch, 23 upload URL.
- Files-only save did not create a version or update the share: lines 706, 2545, 3449, 4131, 4865. The agent recorded the workaround as durable memory at lines 5113–5122.
- Public slug supplied as a ref failed at line 33; `canvas_find` recovered the canonical ref at lines 35–46.
- Optimistic version conflicts occurred at lines 342 and 1497; the agent recovered by re-reading.
- The agent guessed unsupported doc-patch operations repeatedly at lines 362–369 before learning `nodes.update` from a validation message.
- A hash route embedded in the render entrypoint failed at line 2717 because the fragment was treated as part of the file path. A later targeted snapshot succeeded.
- The agent only discovered `canvas_snapshot`, incremental editing, asset tools, and `canvas_run` late in the workflow (line 4742); after discovery, snapshot replaced a local curl/headless harness.
- An `include_doc` argument was silently stripped around line 893; the successful response omitted the requested document.
- Video failed because MP4 was served as `application/octet-stream` under `nosniff`; the agent converted it to GIF.

### Claude Code — farq.uz insurance gallery

Parent transcript: `/Users/diyorkhaydarov/.claude/projects/-Users-diyorkhaydarov-Projects-toys-birbozor/9f204310-7804-4d1c-a183-13eb8be088e2.jsonl`  
Subagent transcript: `/Users/diyorkhaydarov/.claude/projects/-Users-diyorkhaydarov-Projects-toys-birbozor/9f204310-7804-4d1c-a183-13eb8be088e2/subagents/agent-a12659248c1e42652.jsonl`

- Request at parent line 7: redraw all farq insurance pages in Visual Canvas.
- Parent bridge calls, loop-expanded: 58 `canvas_upload_url`, 37 `asset_upload_url`, 35 `asset_finalize`, 4 `canvas_find`, 3 `canvas_get`, 2 `canvas_save`, 1 `asset_list`, and 1 attempted pseudo-tool `tools`.
- Five native calls came from the parent and subagent; three subagent bridge save attempts bring the scenario total to 149.
- The subagent received a 55,462-character document that exceeded the client token cap and spilled to a tool-result file.
- CanvasDoc validation required `lanes`, `stages`, and `edges` even for a screenshot gallery. The save only succeeded after all three were explicitly set to empty arrays.
- The agent used iframe wrappers around screenshots because no native image/gallery node exists.
- Canvas Files and Workspace Asset Library were perceived as one storage surface. After upload, the UI still showed Assets=0; the distinction was only discovered later.
- `canvas_upload_url` and `asset_upload_url` use different HTTP methods and response identifiers. The agent posted twice to a PUT URL, receiving 405/JSON decode failures before correcting the protocol.
- Sequential asset-library upload exceeded the 120-second execution window and had to be resumed in batches.
- There is no asset move/delete workflow. A requested workspace-to-global move became a duplicate personal copy plus a workspace copy left for manual deletion.
- A whole-canvas snapshot was partial and downscaled; a node snapshot worked better but still carried `iframe_not_ready`.

### Codex — OSAGO canvas refinement

Transcript: `/Users/diyorkhaydarov/.codex/sessions/2026/08/18/rollout-2026-08-18T15-37-35-01a01472-b0ba-75d0-bcbd-b5e2e6d18524.jsonl`

- 131 actual Visual Canvas calls were reconstructed after expanding loops. Static call sites included 33 `canvas_run`, 26 `canvas_get`, 25 `canvas_save`, 18 `canvas_edit`, 9 `canvas_apply_patch`, 8 `canvas_find`, 2 `canvas_upload_url`, and one each of `canvas_doc_patch`, `asset_import`, and `asset_attach`.
- `canvas_run` was repeatedly used as a file reader because `canvas_get(include:["files"])` exposes metadata but not file contents.
- Attempts to use top-level await, `require("fs")`, and `new Function` failed under the runner contract. The agent had to infer the injected global API.
- Public slugs used as refs failed, as in the EAI session.
- Global optimistic version conflicts occurred even when the intended target was a particular file.
- Before snapshot existed, visual QA required URL extraction, curl, a temporary file, and a separate image viewer. Snapshot later removed this loop.

## Evolution and development session

Transcript: `/Users/diyorkhaydarov/.claude/projects/-Users-diyorkhaydarov-Projects-toys-visual-mcp/996861c4-ddd7-4fc8-8713-1ef1de84d962.jsonl`

- v1 required separate workspace/template/canvas discovery, create, render, publish, and get calls. One write carried about 3.49 MB of HTML through raw JSON-RPC.
- The same development session records the v2 consolidation: six core tools, direct URLs, resources for templates, and server instructions.
- Historical asset-relative-path and upload-id retry bugs were fixed the same day and verified in-session; they are not classified as current limitations.
- Subsequent commits added CanvasDoc iframe support, incremental edit/apply-patch, asset library workflows, canonical phone frames, previews, and `canvas_snapshot`.

Historical precursor, excluded from Visual Canvas metrics: `/Users/diyorkhaydarov/.claude/projects/-Users-diyorkhaydarov-Projects-toys-birbozor/a05ee22a-b7e8-4ac8-a81c-7d1f3177d3a0.jsonl`. It used the older ephemeral `visual-runtime` plugin for four successful calls. The agent wrote a placeholder via MCP and then bypassed the tool by writing directly into the runtime session filesystem.

## Current implementation evidence

### Tool surface and coverage

- `convex/mcp/tools.ts:961–2290`: 16 registered tools.
- `convex/mcp/tools.ts:2310–2353` and `packages/runtime/src/templates/index.ts:27–38`: 10 template resources.
- Only `canvas_save`, `canvas_snapshot`, and `canvas_upload_url` declare output schemas, despite the registry-level claim that every tool does.
- Current focused test suites passed during the audit: 146 Convex tests, 30 canvas-engine tests, 28 worker tests (204 total). MCP HTTP integration coverage is still absent for incremental edits, doc patch, runner, and asset tools.

### `canvas_save`

- `convex/mcp/tools.ts:966–1160` describes a one-call save/publish operation and marks it safe to retry.
- File writes are performed sequentially before doc/render/visibility work. A failure can therefore leave a partial commit.
- A files-only write updates mutable content but does not create an immutable version; the response can still be `status: ok` with the previous version.
- Retrying a call with a document or render is not idempotent because it creates a new immutable version.
- `files[].url` is fetched directly and materialized into an `arrayBuffer` before enforcing the size cap. It should be removed or routed through the hardened importer to avoid private-network fetch and memory exposure.

### Targeted snapshots

- `convex/mcp/tools.ts:811–816` builds the full CanvasDoc with eager iframe loading even for a node target.
- `packages/runtime/src/render/playwright-renderer/index.ts:450–512` warms and waits for all iframes.
- `packages/runtime/src/render/playwright-renderer/routing.ts:149–166` collects unresolved requests globally for the page.
- A local reproduction deleted an asset used only by a non-target iframe. Snapshotting a different node still returned that unrelated unresolved asset and readiness warnings from 15 other nodes.
- The worker returns detailed unresolved paths and readiness state, but `convex/mcp/tools.ts:1892–1906` collapses them into generic warning codes. Both `ok` and `partial` snapshots can be cached for 24 hours, freezing transient readiness failures.

### Patch schema and read model

- `convex/mcp/tools.ts:1299–1348`: doc-patch `op` is exposed as a plain string; 16 legal names are hidden in `superRefine`. The tool description has no exact operation names or examples.
- `packages/canvas/src/patch.ts:30–50`: entity updates shallow-merge at the root; nested values such as `rect` must be supplied in full.
- `canvas_get` returns file path/hash/size metadata, not raw content. It also has hidden hard caps without cursors: 500 files, 500 artifacts, 50 versions, 20 renders. Find/list paths cap result sets at 200.

### Other current constraints

- Refs accept canonical workspace/canvas and opaque IDs, but not public slugs, share URLs, canvas URLs, or `canvas://` URIs returned elsewhere by the product.
- Schemas strip unknown fields, allowing semantically incomplete successful responses.
- Snapshot output is capped at 4096 pixels and 4 MiB; large canvases are downscaled instead of tiled.
- CanvasDoc supports native diagram and iframe nodes, but not a native image/artboard node.
- MP4/WebM/Ogg are not classified with usable MIME types in `convex/canvases.ts`.
- Render entrypoints do not model URL fragments/routes separately from file paths.
- `canvas_save` accepts at most four renders; canvas quota is 250 MB. `canvas_run` is capped at 60 seconds, 1024 MB, and 10 outputs.

## Interpretation boundaries

- Transcript character volume is a context-pressure proxy, not an exact token measurement.
- The corpus is purposive, not statistically representative: it contains the known dense Visual Canvas workflows available locally, not a random sample of all users.
- Some calls were reconstructed from loops and wrapper code. Counts were cross-checked against transcript outputs, but are not server-side telemetry.
- The working tree already contained uncommitted changes. Current-code findings describe the audited snapshot and do not imply those changes were authored by this audit.
- Agent mistakes such as `mode:create` on an existing canvas, serial edits instead of an available batch patch, or interpreting “redraw” as screenshot embedding are separated from product defects unless the API made the error likely or silent.
