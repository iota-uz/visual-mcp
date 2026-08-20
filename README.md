# Visual Canvas

A hosted service for **@iota.uz**: Claude authors canvases and artifacts —
diagrams, dashboards, reports, mobile/browser mockups, multipage PDFs — over
a **remote MCP endpoint**, using HTML+Tailwind v4, [D2](https://d2lang.com)
diagrams, and ApexCharts. Humans browse, view, and share the results by URL.

## Connect Claude to it

```
claude mcp add --transport http visual-canvas https://<your-deployment>.convex.site/mcp \
  --header "Authorization: Bearer vct_..."
```

You need a bearer token first. Sign in with an `@iota.uz` Google account at
https://canvas.iota.uz and mint or revoke tokens at `/settings/tokens`.
Tokens expire after 90 days.

Canvas tools use one `ref`: a canvas id, public slug, returned canvas/share
URL, `canvas://` URI, or `workspace-slug/canvas-slug`. Asset tools use
immutable `asset://` refs.

| Tool | Purpose |
| --- | --- |
| `canvas_save` | Creates or updates the durable working draft atomically. The first save creates v1; later edits advance `draft_revision` without filling checkpoint history. |
| `canvas_checkpoint` | Snapshots the complete draft—Pages, prototype, files, and bindings—as one named immutable version. Publish checkpoints first. |
| `canvas_get` | Reads one canvas: metadata and URLs always, plus cursor-paginated `files` / `artifacts` / `versions` / `renders`, `doc`, or `storage`. Cursor continuation is pinned with `pagination.expected_version`, so concurrent saves cannot mix pages. Bytes come back as links, never inlined. |
| `canvas_file_get` | Reads one canvas file with version/hash metadata and bounded ranges. Full/line reads are UTF-8; exact byte ranges are base64 and declare their `encoding`. |
| `canvas_snapshot` | Captures a whole native canvas, one `ref_id` node, or an exact world-coordinate region. It isolates targeted iframes, retries transient readiness once, never caches partials, reports resource failure details, and suggests readable tiles when an overview was downscaled. PNGs above 5 MB return a short-lived `download_url` instead of overflowing MCP inline transport. |
| `canvas_edit` | Exact `old_string` → `new_string` edit of one UTF-8 file with version/hash conflict protection. |
| `canvas_apply_patch` | Atomic Codex-style Add/Update/Move/Delete patch across multiple files. |
| `canvas_doc_patch` | Typed semantic add/update/replace/remove operations for CanvasDoc world, lanes, stages, labels, nodes and edges. |
| `canvas_page_list` / `canvas_page_create` / `canvas_page_rename` / `canvas_page_duplicate` / `canvas_page_move` / `canvas_page_delete` | Manage independent Pages inside one canvas file with draft concurrency. |
| `canvas_prototype_get` / `canvas_prototype_set_start` / `canvas_prototype_patch` | Author cross-Page Present flows with validated accessible hotspots and transitions. |
| `canvas_find` | Cursor-paginates and searches workspaces, canvases, and CanvasDoc node text. |
| `canvas_delete` | Archives a workspace/canvas by default or purges it explicitly. Individual files/artifacts have no archive state and require `path` plus `purge:true`. |
| `canvas_run` | Executes resource-limited JS/TS against canvas files; `/output` becomes artifacts. |
| `canvas_upload_url` | Batch (up to 50) per-canvas out-of-band upload manifest; finalize all returned storage IDs in one `canvas_save`. |
| `asset_list` / `asset_get` | Cursor-paginates reusable personal/workspace media; `asset_get` can return image content directly to the model. |
| `asset_upload_url` / `asset_finalize` | Batch (up to 50) direct-to-S3 upload and per-item resumable finalize results. |
| `asset_import` | Copies an HTTPS media source into private object storage with SSRF and MIME checks. |
| `asset_attach` | Pins one immutable asset revision at an `/assets/…` canvas path. |
| `asset_move` | Moves an asset between personal and workspace libraries without re-uploading bytes; old refs stop resolving for new work. |
| `asset_delete` | Archives an asset while preserving immutable versions and existing canvas bindings; it never hard-purges shared bytes. |
| `asset_restore` | Restores an archived asset to its original library without uploading bytes or changing immutable versions and bindings. |

Canvas-private `/assets` files and the reusable Asset Library are distinct on purpose: `canvas_upload_url` only stages files for one canvas, while `asset_upload_url` creates reusable Library items. Both return an `uploads` manifest with an explicit HTTP method; follow that method instead of assuming the protocols are interchangeable.

### CanvasFile v3 Pages, prototype, and CanvasDoc v2 worlds

Native canvases write `CanvasFile` version 3. It contains one or more ordered Pages, each with a stable id and its own CanvasDoc v2 world, plus one canvas-level prototype whose interactions may cross Pages. Checkpoints and restore always cover the whole file. Signed and public links focus a Page with `?page=<id>`; Present uses `/c/:canvasId/present` or `/s/:slug/present` and stable `page`/`node` parameters.

CanvasDoc v2 uses explicit `world` and `rect` geometry and anchor-to-anchor edges. A node is structured `native` content, a local interactive `iframe`, or a static `image`. Image nodes point to a canvas file or Asset Library binding, support `contain|cover|fill|none`, focal position, and required alt text—so screenshot galleries do not need wrapper HTML or iframe readiness. Iframe entrypoints are restricted to `/src/screens/*.html`, use hash routes, fixed viewports, typed sandbox/Permissions Policy values, and are uploaded atomically with the file via `canvas_save({ kind: "canvas", doc: canvasFile, files })`. External iframe URLs and `allow-same-origin` are rejected.

Draft writes are durable and concurrency-safe through `draft_revision`; they do not become visible Versions. Use `canvas_checkpoint` or the UI’s **Create checkpoint** action for meaningful milestones. Publishing always checkpoints first, and public readers remain pinned to that published checkpoint while newer draft work continues.

For a phone screen, use `viewport: { width: 284, height: 642 }` and `frame: { kind: "phone", time: "09:42" }`. The shared canvas renderer supplies the canonical 310×708 OSAGO device shell, notch and status bar in viewer, public share, thumbnail, PNG and PDF. The iframe entrypoint contains only the app screen; adding another bezel or status bar is invalid product output.

In the viewer, an iframe is inert while the canvas is being panned, selected, moved or resized. Double-click or Enter enters interaction mode; Escape or the visible Exit control returns focus to the canvas. Screens load lazily with two concurrent initializations; once mounted, their browsing contexts remain resident for the viewer session instead of being evicted as the camera moves. Distant screens receive `visual-canvas:suspend` / `visual-canvas:resume` lifecycle events and have CSS animations paused while retaining routes, forms and JavaScript state. Export uses `renders: [{ target: { type: "canvas" }, format: "png" | "pdf" }]` and waits for deterministic DOM/font/image/runtime readiness. See the `canvas://templates/iframe-service-flow` MCP resource and [`examples/osago-24/canvas.json`](./examples/osago-24/canvas.json).

In the signed-in viewer, selecting a native or iframe node also reveals a copyable element ref such as `canvas://osago/fast-settlement?node=phone-checkout`. Give that value to an agent as `canvas_get({ ref_id })` to resolve the exact current node together with its lane, stage and connected edges, or as `canvas_snapshot({ ref_id })` to put a tightly cropped PNG of that rendered node directly into the agent's visual context. `canvas_snapshot({ ref, target: { type: "canvas" } })` captures the complete world; a `region` target uses exact world coordinates. Element refs follow the node's semantic `id` across content and geometry edits; deleting or replacing that id makes the ref stale. Anonymous public-share viewers do not expose internal element refs.

### GitHub and Markdown previews

Publishing a canvas now exposes a static public preview card for the whole canvas, any CanvasDoc node/screen, and every output artifact. In the signed-in viewer, open **Details → Share & Embed**, choose the target and either the current pinned version or **Always latest**, then copy the ready `[![preview](image)](link)` Markdown into a GitHub issue, pull request, README, or any Markdown surface.

`canvas_save` and `canvas_get` return the same ready-to-paste values as `embed.github_markdown`; requested or newly-rendered artifacts also carry `github_markdown`. The image endpoint is script-free and GitHub-proxy-friendly. Clicking a canvas or node card opens the existing public share view (focused with `?node=` for nodes); clicking an artifact card opens that public file. There is deliberately no website iframe snippet and no separate interactive embed viewer. Making the canvas private or replacing its public link revokes the associated card URLs too.

The built-in starter templates are MCP **resources**, not a tool —
`canvas://templates/{id}` — so their source only enters context when read.

## Architecture

Convex is the control plane (metadata, auth, versions, bindings, `/mcp` and
`/s/:slug`). Private Railway S3-compatible buckets store Asset Library source
and delivery objects. Two Railway services provide a render worker (Playwright/Chromium, D2,
Tailwind CLI, `run_code` — everything Convex's own sandbox can't run) and a
Vite+React SPA plus a minimal Node static server for the human-facing
gallery/viewer. The server injects canvas-specific OG/Twitter metadata into
the initial `/s/:slug` HTML and proxies a revocable raster social preview. It is live at
https://canvas.iota.uz. Full design, current
milestone status, and accepted risks: [PLAN.md](./PLAN.md).

## Repo layout

```
packages/runtime/   render pipeline (Playwright, D2, ApexCharts, Tailwind
                     build, the JS/TS sandbox), templates, themes — the
                     part of the original local runtime that survived
packages/canvas/    the canvas-document engine (types, layout, edge
                     routing, render, browser viewport) — isomorphic
convex/             schema, queries/mutations/actions, /mcp and /s/:slug
apps/worker/        Hono worker: render/exec plus DNS-pinned HTTPS asset import (Railway)
apps/web/           Vite + React SPA and crawler-aware static server
                     (workspaces, gallery, viewer, MCP tokens, social cards)
scripts/            local development and maintenance commands
```

## Development

```
npm install
npm run build --workspaces --if-present
npm run typecheck --workspaces --if-present
npm run test --workspaces --if-present
npm run lint      # biome
```

Requires Node.js >= 22 (the render worker's sandbox uses globals only
available from Node 22 on, and the production worker image ships Node 24).

Convex functions live under `convex/`; **read
`convex/_generated/ai/guidelines.md` first** before touching anything there
— see this repo's `CLAUDE.md`. Run `npx convex dev` (or `npm run convex:dev`)
to push schema/function changes to your dev deployment while iterating.

## Deploying the SPA

Live at https://canvas.iota.uz (Railway project
`visual-canvas-worker`, service `web`). `apps/web/Dockerfile` builds the
Vite app in a monorepo-aware multi-stage build (see the Dockerfile's own
comments for why it needs a *bare* `npm ci` — no `--workspace=` flags —
plus the full `convex/`, `packages/canvas/`, and `packages/runtime/`
sources, not just `apps/web/`). `server.mjs` preserves SPA-route fallback and
serves dynamic, safely escaped social metadata for public share links.

To redeploy or stand up a fresh copy:

1. **Google OAuth client ID** (Google Cloud Console → APIs & Services →
   Credentials → Create OAuth client ID → Web application, or add the SPA's
   origin to an existing client's Authorized JavaScript origins — a
   `origin_mismatch` error at sign-in means this step is missing or targets
   the wrong origin). Then:
   ```
   npx convex env set GOOGLE_OAUTH_CLIENT_ID <client-id>.apps.googleusercontent.com
   npx convex env set SPA_ORIGIN https://<your-spa-domain>
   ```
2. **Create/update the Railway service**, Dockerfile builder, path
   `apps/web/Dockerfile`, root directory `.` (repo root — the Dockerfile's
   `COPY` paths assume it). Set build-time variables (Vite bakes `VITE_*`
   into the JS at build time, not runtime — Railway auto-injects service
   variables as matching `ARG`s for Dockerfile builds):
   ```
   VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
   VITE_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
   PORT=3000
   ```
   (`PORT` must be set explicitly and match the domain's target port —
   Railway's platform-default `PORT` and a service's generated-domain
   target port aren't guaranteed to agree, and a mismatch here is a silent
   502, not a build failure.)
3. Deploy from a connected GitHub branch, or directly from a local checkout
   with the Railway CLI: `railway up --service web`.
4. **Custom domain** (optional — a `*.up.railway.app` domain works without
   this): add it in Railway (`generate_domain` with a `domain` value, or
   Settings → Networking → Custom Domain in the dashboard) and it returns a
   CNAME + TXT ownership-verification record. Add both at your DNS provider
   — `canvas.iota.uz` is on Cloudflare, DNS-only (grey-clouded, not
   proxied: Railway issues its own Let's Encrypt cert, which needs a direct
   connection to validate). Takes a few minutes for the cert; Railway
   serves a generic `*.up.railway.app` cert over the new hostname in the
   meantime, so a `curl` cert-name mismatch right after adding the DNS
   records is expected, not a failure. Update `GOOGLE_OAUTH_CLIENT_ID`'s
   Authorized JavaScript origins and Convex's `SPA_ORIGIN` to the new
   domain once it's live.

`/settings/tokens`, the live-updating gallery, the canvas viewer's
pan/zoom/inspector/`?node=` deep links, and public/private `/s/:slug`
sign-in-gated flows are all browser-testable end to end at the URL above.
Scripted coverage for the parts that don't need a browser:
`convex/users.test.ts`'s forged-claim `hd`/`email_verified` cases, plus live
MCP-driven checks against the dev deployment — documented in PLAN.md §11.
