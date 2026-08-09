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

You need a bearer token first. Once the SPA is deployed and you can sign in
with a Google account on `iota.uz`, `/settings/tokens` mints and revokes
tokens for you — it needs a real Google OAuth client ID configured on both
the Convex deployment and the SPA build (see PLAN.md §7), which isn't wired
up yet. Until then, mint one from a checkout of this repo:

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
plus a Railway-hosted render worker (Playwright/Chromium, D2, Tailwind CLI,
`run_code` — everything Convex's own sandbox can't run) plus a Vite+React SPA
on Netlify for the human-facing gallery/viewer. Full design, current
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
                     MCP token settings) — builds static, deploys to Netlify
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

## Deploying the SPA (needs credentials this repo's automation doesn't have)

`apps/web/` builds clean and is deploy-ready, but two pieces need a human
with the right access — an unattended session can't create either:

1. **Google OAuth client ID** (5 min, needs Google Cloud Console access on
   the `iota.uz` org): console.cloud.google.com → APIs & Services →
   Credentials → Create OAuth client ID → Web application. Add the deployed
   SPA origin (see step 3) to Authorized JavaScript origins. Then:
   ```
   npx convex env set GOOGLE_OAUTH_CLIENT_ID <client-id>.apps.googleusercontent.com
   ```
   and set the same value as `VITE_GOOGLE_CLIENT_ID` in `apps/web/.env` (or
   your Netlify build env — see `apps/web/.env.example`).
2. **Build**, pointing at the real Convex deployment:
   ```
   cd apps/web && VITE_CONVEX_URL=<your-deployment>.convex.cloud npm run build
   ```
3. **Deploy `apps/web/dist` to Netlify** — either `netlify login && netlify deploy --prod --dir=dist`
   (needs a Netlify account with access to this org/site), or drag-and-drop
   `dist` at app.netlify.com/drop for a one-off. Netlify's auto-generated
   subdomain is fine for v1; a custom domain (e.g. `canvas.iota.uz`) needs
   separate DNS access.

Once both are done, `/settings/tokens`, the live-updating gallery, the
canvas viewer's pan/zoom/inspector/`#node=` deep links, and public/private
`/s/:slug` sign-in-gated flows all become browser-testable end to end —
today they're covered by scripted tests only (`convex/users.test.ts`'s
forged-claim `hd`/`email_verified` cases) plus live MCP-driven checks
against the dev deployment, documented in PLAN.md §9/§11.
