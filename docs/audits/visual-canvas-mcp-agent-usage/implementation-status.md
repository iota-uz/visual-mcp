# Visual Canvas MCP audit — implementation status

This appendix maps the multi-agent session audit to the green-field implementation completed on
2026-08-20. The original report remains a point-in-time account of observed agent behavior; this
file records what changed afterward.

## Correctness and immutable versions

- `canvas_save` now commits metadata, files, asset bindings, CanvasDoc and one immutable version in
  one mutation. Files-only writes publish a version; identical retries are no-ops and report
  `previous_version`, `version` and `published` honestly.
- Rendering and `canvas_run` hydrate the exact immutable version. A render cannot attach after a
  concurrent save changes the head, and superseded supporting-render blobs are reclaimed when no
  version still references them.
- Restore synchronizes the mutable editing head from the chosen immutable version. Historical node
  rows remain available for pinned links and embeds.
- Public `/src` and `/assets` responses resolve the requested version, including Asset Library
  bindings and non-canvas HTML pages. Version query parameters are inserted before URL fragments.
- `/src/__canvas.html` is an enforced reserved path. Doc and generated-entry blobs are deduplicated
  independently.

## Agent-facing contract

- The server exposes 20 strict tools with output schemas. `canvas_doc_patch` publishes literal,
  discriminated operations and explicit replace semantics.
- Canvas refs accept canonical refs, IDs, public slugs, returned URLs and `canvas://` locators.
- `canvas_file_get` provides bounded line reads and exact base64 byte ranges; `canvas_get`,
  `canvas_find` and `asset_list` expose cursor pagination. Continued canvas facets require an
  expected version so concurrent saves cannot mix pages.
- Stale file edits can rebase safely when the supplied content hash still matches. Conflict results
  describe the current version and changed paths.
- Delete semantics are honest: workspaces/canvases archive by default; files/artifacts require an
  explicit permanent purge. Unknown nested render/snapshot fields are rejected.
- MCP instructions and README now document the recommended
  find/get → file-get/edit/patch → targeted snapshot workflow, sandbox globals, upload methods,
  pagination, delete semantics and large-response fallbacks.

## Visual reliability, assets and media

- Targeted snapshots instantiate only intersecting iframes, retry transient readiness once, do not
  cache partial captures, and return structured unresolved/readiness diagnostics plus suggested
  regions. PNGs over 5 MB use a short-lived download URL instead of overflowing MCP transport.
- Native image nodes and the `image-reference-board` template remove iframe wrappers from static
  screenshot/reference boards.
- Upload URL and finalize tools support batches of 50. Asset listing is resumable; assets can move,
  archive and restore without re-uploading immutable bytes. Post-commit staging cleanup cannot turn
  a successful finalize into a false retryable error.
- File render routes are separate from entrypoint paths. MP4/WebM have correct MIME mappings and the
  public CSP permits media.
- Signed-in capability and public-share image URLs are versioned. Local Convex development correctly
  maps the client API port (`3210`) to the HTTP-action port (`3211`).

## Verification

- 425 tests across Canvas, Runtime, Web, Worker and Convex.
- Monorepo TypeScript checks, production build, Biome on every changed source file and
  `git diff --check`.
- Local MCP smoke proves files-only version creation and idempotent retry, typed file reads and a
  native image CanvasDoc.
- In-app browser verification proves the same native image loads in authenticated and public
  viewers with versioned URLs.
- Production dependency audit reports zero runtime vulnerabilities after updating `@auth/core` and
  `sharp` to their patched releases.
