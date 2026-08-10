# Visual Canvas

A hosted service for **@iota.uz**: Claude authors canvases and artifacts —
diagrams, dashboards, reports, mobile/browser mockups, multipage PDFs — over
a **remote MCP endpoint**, using HTML+Tailwind v4, [D2](https://d2lang.com)
diagrams, and ApexCharts. Humans browse, view, and share the results by URL.

This used to be a local, single-user, stdio-only MCP server you ran with
`npx`. That path is **removed, not deprecated-but-present** — see
[PLAN.md](./PLAN.md) for the full architecture and what changed.

## Connect Claude to it

```
claude mcp add --transport http visual-canvas https://<your-deployment>.convex.site/mcp \
  --header "Authorization: Bearer vct_..."
```

You need a bearer token first. Sign in with a Google account on `iota.uz` at
the deployed SPA — https://canvas.iota.uz — and `/settings/tokens` mints and
revokes tokens for you. Or mint one from a checkout of this repo:

```
node scripts/mint-mcp-token.mjs <your-email> "<your name>" [token-name]
```

This generates the token locally, hashes it, and registers only the hash
with Convex via `npx convex run tokens:bootstrap` — the plaintext token is
printed once, to your terminal only. Tokens expire after 90 days.

Once connected, Claude has these tools:

| Tool | Purpose |
| --- | --- |
| `create_workspace` / `list_workspaces` | Create/list top-level workspaces ("OSAGO", "Billing", ...) |
| `create_canvas` / `list_canvases` | Create/list canvases inside a workspace |
| `put_canvas_doc` / `get_canvas` | Write/read a canvas's declarative document (lanes, stages, nodes, edges — see PLAN.md §2) |
| `publish_canvas` | Toggle a canvas between private (any signed-in @iota.uz user) and public (unguessable share link) |
| `write_file` | Write a source file (HTML, D2, ...) into a canvas's `/src` or `/output` |
| `run_code` | Execute JS/TS in a resource-limited sandbox (worker-thread isolated, no shell access) |
| `render_file` | Render an HTML or `.d2` entrypoint to PNG/SVG/PDF/HTML |
| `list_artifacts` / `export_artifact` | List/fetch a canvas's rendered artifacts |
| `list_templates` | List the built-in starter templates |

## Architecture

Convex (data, file storage, auth, the `/mcp` and `/s/:slug` HTTP endpoints)
plus two Railway services: a render worker (Playwright/Chromium, D2,
Tailwind CLI, `run_code` — everything Convex's own sandbox can't run) and a
Vite+React SPA (Dockerfile static build, served via `serve -s`) for the
human-facing gallery/viewer, live at
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
apps/worker/        Hono render worker: POST /render, /exec (Railway)
apps/web/           Vite + React SPA (workspaces, canvas gallery, viewer,
                     MCP token settings) — builds static, deploys to Railway
                     (Dockerfile + serve)
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
sources, not just `apps/web/`) and serves the static output with `serve -s`
for SPA-route fallback.

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
   VITE_CONVEX_URL=<your-deployment>.convex.cloud
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
pan/zoom/inspector/`#node=` deep links, and public/private `/s/:slug`
sign-in-gated flows are all browser-testable end to end at the URL above.
Scripted coverage for the parts that don't need a browser:
`convex/users.test.ts`'s forged-claim `hd`/`email_verified` cases, plus live
MCP-driven checks against the dev deployment — documented in PLAN.md §9/§11.
