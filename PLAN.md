# Visual Canvas — architecture & roadmap

`visual-canvas` (formerly `visual-runtime`) is a hosted service for @iota.uz: Claude authors
canvases and artifacts through a remote MCP endpoint, and humans browse, view, and share them by
URL. This document is the canonical architecture reference for the repo — Part 1 describes the
hosted product as it exists today plus what's left to ship; Part 2 preserves the original
single-user local-runtime spec, since most of `packages/runtime`'s rendering internals (Tailwind
policy, D2/ApexCharts authoring modes, sandbox policy, template/theme systems, artifact manifest
shape) still work exactly as first specified and code comments throughout that package cite it
by section number.

Status legend: ✅ shipped · 🚧 in progress · ⏳ not started.

## Decisions (do not re-litigate)

| # | Decision |
|---|---|
| 1 | **Gallery, not a mouse editor.** Claude authors; humans view. No tldraw/Excalidraw/React Flow. |
| 2 | **Dual format.** Canvas documents (declarative JSON) are first-class, rendered by a first-party engine ported from the osago reference file. Raw HTML/PNG/PDF/SVG artifacts are also hosted, as opaque blobs. |
| 3 | **Google Sign-In, @iota.uz only**, enforced server-side on the ID token (`hd` + `email_verified`) — never the client-supplied OAuth `hd` hint alone. |
| 4 | **Two visibility states.** `private` → any signed-in @iota.uz user may view. `public` → unguessable slug, no login. No ACLs, no invites, no roles. |
| 5 | **Remote MCP is the differentiator**, built on the official SDK, not hand-rolled transport code. |
| 6 | **Local stdio server fully replaced.** Hosted only. The old `npx github:iota-uz/visual-mcp` path and `.claude-plugin/` are removed, not kept as a compatibility shim. |
| 7 | **`run_code` ships as-is**, network access included. Risk accepted — see §10. |
| 8 | **Backend is Convex** (data, file storage, auth, functions). Chromium cannot run there, so a Railway render worker stays. Single-org internal tool: no billing, admin panel, or audit log. |
| 9 | **Writes are org-wide**, not creator-scoped — any signed-in @iota.uz user (and any valid MCP token) may write to any workspace, attributed via `createdBy`. Consistent with "no ACLs, no roles." |
| 10 | **MCP tokens expire after 90 days**, non-configurable in v1 — the mechanism that makes a departed employee's access actually die, independent of their Google account's state. |
| 11 | **UI is English-only.** No i18n in v1. |
| 12 | **Embeds are explicitly deferred.** No `/embed/:slug` route in v1 — a shared link is enough. |
| 13 | **No custom domain requirement for v1.** Netlify's auto-generated subdomain is acceptable for the SPA; `*.convex.site` is used as-is for `/mcp` and artifacts. |

---

## 1. Product surface

**Entities:** `Workspace` → `Canvas` → `CanvasVersion` (+ artifact files). A workspace is a
folder ("OSAGO", "Billing"). A canvas is one shareable thing with a stable URL, a kind
(`canvas` | `html` | `image` | `pdf`), and version history — Claude re-rendering creates a new
version, never destroys the old one.

| Route | Host | Auth | Purpose | Status |
|---|---|---|---|---|
| `/` · `/w/:wsSlug` · `/c/:canvasId` | SPA | Convex session | workspaces · canvas grid · viewer | ✅ |
| `/settings/tokens` | SPA | Convex session | mint/revoke MCP tokens | ✅ |
| `/mcp` | `*.convex.site` | bearer | remote MCP endpoint | ✅ |
| `/s/:slug[/*]` | `*.convex.site` | slug or signed | artifact bytes, separate cookieless origin | ✅ |

Deep-linking: `#node=<nodeId>` selects and frames a node. Addressable inspector state is what
makes these diagrams useful pasted into Slack or Notion.

---

## 2. Canvas document format — the core deliverable

Positions and edges are lifted out of imperative JS into a document. Types live in
`packages/canvas/src/types.ts`, zod-validated on every write (✅ shipped, backs `put_canvas_doc`).

```ts
export interface CanvasDoc {
  version: 1
  title: string; subtitle?: string
  theme?: ThemeId
  grid?: { stageWidth?: number; startX?: number }    // defaults 1160 / 120
  lanes: Lane[]; stages: Stage[]
  nodes: CanvasNode[]; edges: CanvasEdge[]
  legend?: LegendGroup[]
  lod?: LodCard[]                                    // derived from stages when absent
}

export interface Lane {
  id: string; label: string
  role: 'actors'|'primary'|'secondary'|'automation'
      | 'exception'|'support'|'system'|'external'    // drives the palette
  height: number; slots?: number
}
export interface Stage { id: string; index: number; label: string; summary?: string }

export interface CanvasNode {
  id: string; lane: string; stage: string; slot?: number
  shape: 'screen'|'window'|'actor'|'automation'|'service'|'registry'|'decision'|'note'
  size?: { w: number; h: number }
  caption: { title: string; subtitle?: string; tag?: string }
  badge?: { text: string; tone: 'live'|'partial'|'planned' }
  content?: NodeContent
  inspector?: { eyebrow: string; title: string; copy: string; points?: string[] }
}
export type NodeContent =
  | { type: 'html'; html: string; frame?: 'phone'|'browser'|'window'|'none'; scale?: number }
  | { type: 'image'; assetPath: string }
  | { type: 'text'; body: string }

export interface CanvasEdge {
  id?: string; from: string; to: string
  kind: 'main'|'secondary'|'sync'|'actor'|'exception'|'external'
  label?: string
  route?: 'auto'|'horizontal'|'vertical'|'orthogonal'|'gutter'
  bidirectional?: boolean
}
```

**Invariant: `NodeContent.html` is static HTML/CSS/SVG.** No `<script>`, `on*`, `javascript:`,
`<iframe>`, `<object>`. Validated on write and rejected loudly, not silently stripped, so Claude
gets a fixable error (✅ enforced in `put_canvas_doc`, covered by `convex/http.test.ts`). This is
what makes it safe to render canvas nodes on the app origin with working keyboard and pan/zoom,
instead of trapping them in a sandboxed iframe.

**Node HTML needs compiled Tailwind.** `put_canvas_doc` doesn't call a separate `/compile-css`
endpoint — the worker's existing `renderFile` already runs the Tailwind v4 build over the
canvas's node HTML as part of rendering (see `apps/worker/src/app.ts`), so no CDN script runs on
the app origin. ✅

**Engine modules** (`packages/canvas/src/`, isomorphic — same code in Node and browser), all ✅
shipped:

| Module | Responsibility |
|---|---|
| `types.ts` | schema above + zod |
| `layout.ts` | `CanvasDoc → PositionedCanvas`; lane/stage/slot → world x/y/w/h |
| `router.ts` | `CanvasEdge[] + PositionedCanvas → EdgePath[]`; bezier/S/orthogonal/gutter by relative position |
| `render.ts` | `PositionedCanvas → DOM or HTML string`; lanes, stage frames, node cards, SVG edge layer, LOD cards |
| `viewport.ts` | browser-only: pan/zoom/pinch/minimap/LOD/keyboard/selection/inspector |
| `theme.css` | the ported design system (tokens, shadow ladder, role palettes, caption bar, arrow markers) |

`render.ts` in Node with `viewport.ts` omitted emits a static HTML page, so it feeds the existing
Playwright renderer and thumbnails/PNG/PDF export come for free — **thumbnail capture itself is
not yet wired** (⏳, tracked in §9's C1/C2 rows; `canvases.thumbnailId` exists in the schema but
nothing populates it yet).

---

## 3. Architecture

```
Convex deployment                          Railway project
├── schema + queries/mutations             └── render-worker  (public domain, WORKER_TOKEN)
├── file storage (docs, artifacts, thumbs)     Playwright/Chromium · D2 wasm · Tailwind CLI
├── Convex Auth (Google, hd-restricted)        sharp · run_code
├── httpAction  /mcp                           creds: NONE — per-request Convex storage URLs
├── httpAction  /s/:slug  (artifact proxy)
└── crons (cache TTL, quota sweep)

Netlify  ← Vite + React SPA (static)
```

**Why the worker still exists:** Convex functions run in a V8/Node sandbox with a 10–30 min
ceiling and no browser binaries. Chromium, the D2 WASM worker thread, the Tailwind CLI
subprocess, and `run_code` all need a real container. That container is also the only place
untrusted code runs — and it holds no Convex deploy key, only short-lived upload/download URLs
scoped to the canvas being rendered. That credential isolation is the §10.1 mitigation.

**Cost of choosing Convex, recorded honestly:** the API and the worker don't share a private
network, so `render-worker` needs a public domain guarded by a shared `WORKER_TOKEN` over HTTPS
with no other routes exposed. Weaker than private networking; acceptable because the worker
stores nothing and holds no credentials.

**Stack, current state:**

```
packages/runtime/   ✅ render pipeline, templates, themes, path normalizer — see Part 2
packages/canvas/    ✅ §2 engine, isomorphic
convex/             ✅ schema, queries, mutations, actions, http.ts, mcp/tools.ts,
                     auth.config.ts + lib/auth.ts (native Google OIDC, see §7)
apps/worker/        ✅ Hono + Playwright + D2 + Tailwind + run_code, POST /render, /exec
apps/web/           ✅ Vite + React SPA — routes, Google sign-in, canvas viewer, publish
                     toggle, token UI (see §1/§6/§7 status notes for what's stubbed)
```

React was the right call once the SPA existed — Convex's client is React-first and reactive
queries are the win. The canvas viewer stays framework-free in `packages/canvas` and is mounted
by a thin React wrapper (`apps/web/src/routes/Canvas.tsx`'s `CanvasViewport`, which fetches the
stored `CanvasDoc` client-side via a signed `ctx.storage.getUrl()` and calls `layoutCanvas` +
`mountViewport` directly — no server round-trip through the worker for the interactive view;
the worker is still what produces PNG/PDF/thumbnail exports). Worker Dockerfile targets
`mcr.microsoft.com/playwright:v1.62.1-noble` (Node 24 — see the CI Node-version note in Part 2's
sandbox section).

---

## 4. Data model (Convex) ✅ shipped

```ts
users          { googleSub, email, name, pictureUrl, lastSeenAt }        idx: by_googleSub
mcpTokens      { userId, name, prefix, tokenHash, expiresAt,
                 lastUsedAt, revokedAt }                idx: by_tokenHash, by_userId
workspaces     { slug, name, description, createdBy, archivedAt }        idx: by_slug
canvases       { workspaceId, slug, title, description,
                 kind: 'canvas'|'html'|'image'|'pdf',
                 visibility: 'private'|'public', publicSlug?,
                 theme?, currentVersionId?, thumbnailId?, createdBy }
                                        idx: by_workspace_updated, by_publicSlug
canvasVersions { canvasId, version, note, createdBy,
                 docStorageId?,     // kind='canvas' — full CanvasDoc JSON in file storage
                 cssStorageId?,     // compiled Tailwind for node HTML
                 entryStorageId? }  // other kinds
canvasNodes    { canvasId, versionId, nodeId, title, eyebrow, searchText }
                                        idx: by_version;  searchIndex: searchText
canvasFiles    { canvasId, relPath, storageId, size, contentHash }       idx: by_canvas_relPath
artifacts      { canvasId, versionId, relPath, type, role, mimeType,
                 size, storageId }                                        idx: by_canvas_relPath
renders        { canvasId, entrypoint, format, status, durationMs,
                 errorText, createdBy }
```

`canvasNodes` search index and `canvasFiles`/`renders` bookkeeping are ✅ shipped at the schema
and mutation layer; the SPA-side search UI that queries them is ⏳ (tracked under C2 in §9).

**Adapting to Convex's 1 MiB document limit** — the one place the document model bites. A
`CanvasDoc` carrying node HTML mockups can exceed it, so the full doc lives in file storage and
`canvasVersions` holds only the `storageId`. Search and deep-links are served by `canvasNodes` —
one small document per node, with a Convex search index over title/eyebrow/copy. This is better
than a single jsonb blob: `#node=` resolution and "find the canvas that mentions Europrotocol"
become index lookups instead of full-document scans.

**Mapping from the old local runtime:**

- `sessions/<id>/` directory → a `canvases` document. No persistent per-canvas directory anywhere.
- `output/manifest.json` → the `artifacts` table. The `withLock` promise-chain that existed
  purely to serialize read-modify-write on that JSON file is gone — a Convex mutation is
  serializable, so demoting the incumbent primary artifact and inserting the new one is atomic
  by construction (see `convex/canvases.ts`'s `upsertArtifact`, covered by the regression test in
  `convex/canvases.test.ts` for the "re-render must keep exactly one primary artifact" invariant).
- `/src`, `/output`, `/cache`, `/assets` become prefixes on `relPath`, not directories. `/cache`
  renders stay out of `artifacts`, as before. `/assets` stops being per-canvas: the ApexCharts
  bundle is baked into the worker image.
- `publicSlug`: 128-bit base62, minted on publish, rotatable; unpublishing clears it, which is
  what makes revocation real. ✅ mint/rotate logic shipped; the SPA control for it is ⏳.

---

## 5. Storage abstraction & what survives ✅ shipped

Playwright and the Tailwind CLI need real files on a real disk; D2 does not. The worker hydrates
a throwaway directory per job and persists results back — no volume anywhere.

```ts
export interface CanvasStorage {          // Convex-backed in prod, disk-backed in tests
  putFile(canvasId, relPath, body, mime): Promise<StoredObject>
  getFile(canvasId, relPath): Promise<Readable>
  deleteCanvas(canvasId): Promise<void>
  downloadUrl(storageId, ttlSec): Promise<string>   // ctx.storage.getUrl
  uploadUrl(ttlSec): Promise<string>                // ctx.storage.generateUploadUrl
}

export interface HydratedWorkspace { root: string; dispose(): Promise<void> }
hydrate(files: SignedFile[]): Promise<HydratedWorkspace>   // mkdtemp /tmp/vc-<uuid>/
collectOutputs(ws, since): Promise<LocalArtifact[]>
```

`hydrate` creates `src/ output/ cache/ assets/`, symlinks the baked ApexCharts bundle, and
downloads sources. Everything downstream sees a directory byte-identical in shape to the old
`sessions/<id>/`.

**Survives unchanged from the local runtime** — the most important structural fact in this
migration, and why `packages/runtime` (Part 2 of this document) is still authoritative for these
modules:

- `packages/runtime/src/render/playwright-renderer/*` — `renderFile({entrypoint, outputPath,
  workspaceRoot, …})` already took absolute paths and an explicit `workspaceRoot`; the worker
  points it at the temp dir.
- `tailwind.ts` — writes `.tw-input-<uuid>.css` next to the entrypoint with `--cwd scanDir`;
  works identically, and is cleaner here because the scan dir holds only this canvas's files.
- `render/diagrams` (D2, pure string→string), `render/charts`, `sharp`, all 9 `templates/*`,
  `render/themes/*`, and the zod schemas in `types.ts`.

**The four hand-rolled path-confinement implementations collapsed to one** (✅ done): the old
`sandbox/path-guard.ts` was promoted to a filesystem-free `normalizeCanvasPath(relPath, mode)`
now used by both Convex and the worker (`packages/runtime/src/paths/index.ts`), with
`resolveWorkspacePath` as a thin join on top. The old `server/render-output-path.ts` folded in as
a `mode`. The artifact-store's independent `resolveOutputAbsolutePath` was deleted outright —
`export_artifact` is now an index lookup by `(canvasId, relPath)` → `downloadUrl`, zero path
arithmetic, zero traversal surface.

---

## 6. Remote MCP — the official SDK v2 ✅ shipped

**The protocol is stateless.** MCP revision 2026-07-28 removed the `initialize` handshake and
`Mcp-Session-Id`; every request is self-contained. This is a natural fit for a Convex
`httpAction`, which is a pure request/response function — the old stateful SSE model would have
fought that. It also means there's no in-memory session-store problem to solve on this side of
the system (the *old* stdio server's `session-store.ts` is a separate, unrelated thing — see §3
of Part 2 and the removal tracked in §9's "deprecate stdio" row).

**Library:** the official TypeScript SDK v2 (`@modelcontextprotocol/server`), mounted via
`createMcpHandler` inside a Convex `httpAction` (`convex/http.ts`). Auth uses the SDK's own
`requireBearerAuth` middleware. `createMcpHandler` runs cleanly in the Convex runtime — the
Railway/Hono fallback considered during planning was never needed.

```ts
export interface McpPrincipal { userId: Id<'users'>; tokenId: Id<'mcpTokens'>; email: string }
export interface ToolContext { principal: McpPrincipal; db: ConvexClient; storage: CanvasStorage; render: RenderClient }
export interface RenderClient { render(req): Promise<RenderResult>; exec(req): Promise<ExecResult> }
// requests carry sources[{relPath,getUrl}] + uploads[{relPath,putUrl}] — no creds
```

`run_code` and `render_file` share the worker's hydrate/persist shape — `POST /exec` takes the
same signed payload plus a code string and returns `{success, stdout, stderr, error?}`.

**Tools** — all 13 registered in `convex/mcp/tools.ts` (✅), `session_id` replaced by `canvas_id`
throughout with no compatibility alias, since decision #6 retires the stdio server entirely:

| Tool | Status | Notes |
|---|---|---|
| `create_workspace` | ✅ | |
| `list_workspaces` | ✅ | |
| `create_canvas` | ✅ | `{workspace_id?, title, kind, template?, theme?}` → `{canvas_id, url}` |
| `list_canvases` | ✅ | |
| `get_canvas` | ✅ | doc or metadata |
| `put_canvas_doc` | ✅ | zod-validated against `CanvasDocSchema`, §2 invariant enforced, new version per call |
| `publish_canvas` | ✅ | `{canvas_id, visibility}` → share URL |
| `write_file` | ✅ | `canvas_id`-scoped |
| `run_code` | ✅ | delegates to worker `/exec` |
| `render_file` | ✅ | delegates to worker `/render` |
| `list_artifacts` | ✅ | reads the `artifacts` table |
| `export_artifact` | ✅ | `{artifact, url, mime_type, size_bytes}`; inlines only below ~1 MB (Convex's HTTP response cap is 20 MiB) |
| `list_templates` | ✅ | still sits behind the bearer gate — exempting it would require inspecting the JSON-RPC body pre-auth |

`create_canvas` takes a template **id** rather than only reachable-by-kind, which fixes a real
bug from the old `create_visual_session`: only the first template of each kind was ever
reachable, so `phone-frame-screen`, `browser-app-screen`, `dashboard-overview` were dead code and
`kind:"chart"` was unreachable entirely.

**On OAuth for MCP:** the 2026-07-28 spec deprecates Dynamic Client Registration in favour of
Client ID Metadata Documents (CIMD), and hardens issuer validation (RFC 9207). Static bearer
tokens are the right v1 regardless; any future move to org-federated MCP auth should target CIMD,
not DCR.

`format:"svg"` stays D2-only (Playwright cannot export SVG) — unchanged from the local runtime,
but hosted users will hit it more often, so the tool description and error text call it out
explicitly.

---

## 7. Auth ✅ (backend) / ⏳ (SPA client)

**Web — native Convex JWT verification against Google directly, not `@convex-dev/auth`.**
Superseded from the original plan (which specified the `@convex-dev/auth` library with a custom
`getUserInfo`/`profile` callback) once implementation started: Convex's own guidelines document a
simpler, first-party "bring your own OIDC provider" path via `convex/auth.config.ts`
(`{domain: "https://accounts.google.com", applicationID: <client id>}`), and it fits this
product better — zero extra schema tables (no collision with the existing hand-rolled `users`
table), no client secret to hold anywhere (only a public OAuth client ID), and it keeps auth off
a labs-stage dependency entirely rather than treating that as an accepted risk to fall back from.

The SPA obtains a Google ID token client-side (Google Identity Services, likely via
`@react-oauth/google` per this project's preference for managed libraries over hand-rolled
protocol glue) and hands it to `ConvexProviderWithAuth`'s `fetchAccessToken`. Convex verifies the
token's signature against Google's own JWKS and its `aud` against `applicationID` — that's
`auth.config.ts`'s whole job. The org restriction is enforced entirely in application code, not
by that verification step: `convex/lib/auth.ts`'s `requireIotaIdentity(ctx)` checks
`identity.emailVerified === true` and `identity.hd === 'iota.uz'` on the already-verified
identity, and is the single choke point every public query/mutation must call — there is no
second gate behind it, unlike the MCP bearer-token path (gated once in `http.ts`). ✅ shipped and
covered by `convex/users.test.ts`'s forged-claim tests (missing `hd`, wrong `hd`,
`email_verified: false`, happy path) using `convex-test`'s `t.withIdentity()`. Users are keyed on
`identity.subject` (Google's `sub`), not email — Workspace reassigns emails.

`GOOGLE_OAUTH_CLIENT_ID` (Convex env var) and `VITE_GOOGLE_CLIENT_ID` (SPA build env, same value)
are the only missing pieces to make sign-in actually work end-to-end — creating the OAuth client
itself requires the Google Cloud Console (gcloud has no API for web-app OAuth clients), which is
an org-visible account change outside this session's scope. The dev deployment currently has a
placeholder value set so `npx convex codegen`/typecheck don't hard-fail on a missing env var.

**Bootstrap reconciliation** ✅ shipped (`convex/lib/auth.ts`'s `getOrCreateUserId`, tested in
`convex/users.test.ts`): MCP tokens can exist before a user's first real sign-in (minted via the
CLI script against a `bootstrap:<email>` placeholder row, `googleSub = "bootstrap:<email>"`). On
first real sign-in, `getOrCreateUserId` looks up that placeholder by the synthetic `googleSub`
and patches it to the real `sub`, so existing tokens keep resolving to the same user row instead
of orphaning them under a duplicate.

**Known deferral for §8:** `ctx.auth.getUserIdentity()` throws (not returns `null`) inside
httpActions, which affects the private branch of `/s/:slug` — decide there whether to catch it
and require an `Authorization: Bearer <google-id-token>` header on that fetch, or sidestep
entirely with short-TTL signed URLs minted from an authenticated query instead.

**MCP — static bearer tokens.** ✅ shipped. Format `vct_<base62(160 bits)>`; sha256 + an 8-char
display prefix stored, never the plaintext; lookup by the `by_tokenHash` index; constant-time
compare; 90-day `expiresAt`. `revoke` and `listForUser` (`convex/tokens.ts`) are ✅, covered by
`convex/tokens.test.ts`. The UI that renders the copy-paste `claude mcp add` command and the mint
button is ⏳ (part of the `/settings/tokens` SPA route).

---

## 8. Serving artifacts and sharing safely ✅

Convex file storage URLs live on `*.convex.cloud` — already a different origin from the SPA on
Netlify, but headers can't be set on them. So HTML artifacts stream through an httpAction on
`*.convex.site` (`GET /s/:slug` and `/s/:slug/*` — Convex's `httpRouter` has no named-param
syntax, only exact `path`/`pathPrefix`, so `http.ts` splits the slug and relPath off
`url.pathname` by hand), which is both a distinct cookieless origin and a place headers are
controllable. ✅ shipped (`convex/http.ts`, `convex/canvases.ts`'s `resolvePublicArtifact`,
covered by `convex/http.test.ts`: 200 with CSP/nosniff headers, 404 on unknown slug, 404 on a
*private* canvas's slug — `visibility` is the only gate this route enforces, everything else in
the app is org-wide reads per decision #4 — explicit-relPath lookups, and SVG's forced
`Content-Disposition: attachment`).

`resolvePublicArtifact` serves the canvas's current **primary artifact** (from the `artifacts`
table), not a server-rendered version of the `CanvasDoc` itself — a `kind: "canvas"` canvas with
no render yet 404s here with a clear "ask Claude to render this canvas" message from the SPA
side; there's no separate public-facing canvas-engine renderer. The SPA's own `/c/:canvasId`
route (Part 1 §1/§2) is where the interactive `packages/canvas` viewport actually lives, gated by
Convex session, not by this route.

- Never reads or sets cookies; refuses all other routes.
- **CSP** must stay consistent with the render-time policy in §10.2, which deliberately allows
  CDN access because the reference osago artifact loads `cdn.tailwindcss.com` and Google Fonts. A
  view-time policy blocking them would render that artifact unstyled:

  ```
  default-src 'none';
  script-src  'self' 'unsafe-inline' https://cdn.tailwindcss.com;
  style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src    'self' data: https://fonts.gstatic.com;
  img-src     'self' data:;
  connect-src 'none';
  frame-ancestors 'self' <SPA_ORIGIN, if set>;
  base-uri 'none'; form-action 'none';
  ```
  ✅ shipped exactly as above (`http.ts`'s `publicArtifactCsp`), plus `X-Content-Type-Options:
  nosniff`. `frame-ancestors` widens beyond `'self'` only once the `SPA_ORIGIN` env var is set
  (post Netlify deploy) — unset, it's "no embedding at all," the safe default rather than a
  broken one. `'unsafe-inline'` for scripts is unavoidable (ApexCharts init is inline);
  `connect-src 'none'` on a cookieless origin makes it tolerable. The env-configurable allowlist
  this section and `RENDER_ALLOWED_HOSTS` (§10.2) were meant to share is still two separate
  constants in practice, not one — a real gap, not a documentation oversight; unifying them is
  cheap follow-up, not done in this pass. *Later:* an import step inlining CDN dependencies on
  upload, shrinking the allowlist to nothing.
- **Embed** as `<iframe sandbox="allow-scripts">`, deliberately without `allow-same-origin`,
  which pins the frame to an opaque origin. Not yet exercised anywhere (decision #12: embeds
  deferred) — the CSP supports it, nothing serves an embed page yet.
- **SVG is always `Content-Disposition: attachment`** — an active document, never inline on a
  shared origin. ✅. PNG and PDF serve inline; above the 18 MiB response-cap margin they redirect
  to a direct `*.convex.cloud` storage URL, which is safe for non-HTML types. ✅.
- **Private canvases do not go through this route at all** — a deliberate simplification from the
  original sketch's "same handler, keyed by canvasId behind the Convex session." `resolvePublicArtifact`
  only matches `visibility: "public"` rows via the `by_publicSlug` index, so a private canvas's
  bytes are only ever reachable through the SPA's own authenticated `canvases.getMine` query (§4),
  which mints its own short-TTL `ctx.storage.getUrl()` per request. Two paths, one for each
  visibility state, rather than one handler branching on it.
- **Canvas-kind documents render on the app origin**, safe by the §2 invariant, so pan/zoom and
  keyboard work without iframe focus games. This is what `apps/web/src/routes/Canvas.tsx` does for
  a signed-in viewer; `/s/:slug` for a `kind: "canvas"` canvas instead serves whatever artifact
  Claude last rendered for it via `render_file` (if any) — there is no separate anonymous
  canvas-engine renderer. A canvas with no render yet 404s here.
- **Thumbnails**: captured in the same browser context right after the primary render, clipped
  and `sharp`-downscaled to ~600px. ⏳ not yet wired (see §2).

---

## 9. Milestones

### Track A — platform

| M | Ships | Status |
|---|---|---|
| **A0** Foundations | npm workspaces; `src/` → `packages/runtime` with the local-runtime tests green; `normalizeCanvasPath` extracted, other guards folded in or deleted; `CanvasStorage` + disk impl; CI (typecheck + test) and Biome; worker Dockerfile; Convex project + Railway worker service provisioned | ✅ done |
| **A1.0** MCP spike | Prove `createMcpHandler` runs in the Convex runtime before building real tools against it | ✅ done — ran cleanly, no Hono/Railway fallback needed |
| **A1** Hosted MCP end-to-end | Convex schema + mutations/queries; Convex file storage wired; worker with hydrate/render/persist, credential-free env; `/mcp` httpAction on SDK v2 with bearer auth; all 13 tools; `export_artifact` size cap | ✅ done — `claude mcp add --transport http …` → create canvas → write HTML → render PNG → get a URL that loads, works end-to-end |
| **A2** Web product | Native Google OIDC auth with `hd` + `email_verified` enforcement; public query/mutation layer for workspaces/canvases/tokens; SPA (workspaces, canvas grid, viewer, share toggle, token UI); `/s/:slug` httpAction with CSP; Netlify deploy | 🚧 partial — auth backend, public function layer, `apps/web` itself, and `/s/:slug` are ✅ (`npm run build`/`typecheck`/`test` all green, verified live against the dev deployment — see §11); `apps/web` is deploy-ready (`public/_redirects` added for client-side routing, builds clean against the real `VITE_CONVEX_URL`) but the actual Netlify publish step is ⏳ — it needs either a human's Netlify login or an explicit go-ahead to drag-and-drop `apps/web/dist` at app.netlify.com/drop, neither of which an unattended session can do on its own. The real Google OAuth client ID and live-updating thumbnails (blocked on §2/§8's thumbnail capture) are also ⏳ |

### Track B — canvas engine

| M | Ships | Status |
|---|---|---|
| **B1** Engine | `packages/canvas/{types,layout,router,render,viewport,theme.css}`; zod schema; Vite viewer bundle; the osago design system ported | ✅ done |

### Convergence

| M | Ships | Status |
|---|---|---|
| **C1** Canvas kind live | `put_canvas_doc`/`get_canvas`; doc JSON in file storage + `canvasNodes` search index; viewer page on the app origin; server-side render → thumbnail + PNG/PDF export | 🚧 partial — MCP-side wiring (`put_canvas_doc`/`get_canvas`, `canvasNodes`, Tailwind compile inline in `renderFile`) is ✅; the SPA viewer is ✅ (`apps/web/src/routes/Canvas.tsx` fetches the stored doc client-side and mounts `packages/canvas`'s viewport directly — no worker round-trip needed for interactive viewing); thumbnail capture is still ⏳ |
| **C2** Polish | public slug rotation UI, `#node=` deep links, search UI over `canvasNodes`, version history UI, template gallery, theme integration, Convex crons for `/cache` TTL (24h) and per-canvas storage quota (250MB soft), CDN-inlining on upload | 🚧 partial — the backend half is ✅: `canvases.sweepCacheTtl` (a `crons.interval` job, `convex/crons.ts`) deletes `/cache/`-prefixed artifacts older than 24h including their storage blobs, and every write path (`recordRender`/`recordExecArtifacts`/`upsertFile`) now enforces the 250MB-per-canvas soft cap via `assertWithinQuota`, surfaced as a clear MCP tool error (not a silent failure) and verified live against the dev deployment. All 4 UI items (slug rotation, `#node=`, search, version history) plus template gallery/theme integration/CDN-inlining are ⏳ not started |

---

## 10. Accepted risks

Recorded because they were consciously chosen.

1. **`run_code` keeps `node:vm` isolation and full network egress.** The code's own comments
   state `node:vm` is not a security boundary. The credential-free worker is the mitigation that
   doesn't change behaviour: it holds no Convex deploy key and no storage keys, only short-lived
   URLs scoped to one canvas, so a compromise yields the files of the canvas being rendered and
   nothing else. Completed by MCP token expiry (§7) and treating token issuance as the real
   access control.
2. **Playwright still `route.continue()`s any non-`file:`/`data:` request**, so a rendered
   artifact can reach arbitrary hosts. Left open deliberately — the reference osago artifact
   itself loads `cdn.tailwindcss.com` and Google Fonts, so default-deny would break exactly the
   artifacts this product exists to host. If that changes, it's a one-function edit in
   `packages/runtime/src/render/playwright-renderer/routing.ts` plus a `RENDER_ALLOWED_HOSTS`
   allowlist; baking the 2–3 fonts actually used into the worker image is the cheaper half of
   that move.
3. **The worker is reachable over the public internet**, not a private network, because Convex
   isn't on Railway's mesh. Guarded by `WORKER_TOKEN` over HTTPS with no other routes. The worker
   stores nothing and holds no credentials, which is what makes this acceptable.
4. **Convex is a lock-in bet.** The document model, query language, and auth layer aren't
   portable. Chosen knowingly for zero DB ops and live-updating queries; `packages/runtime` and
   `packages/canvas` stay Convex-free so the valuable half of the codebase remains portable.
5. **No render queue.** Synchronous renders are correct while Claude waits; revisit when a
   "re-render everything after a theme change" feature appears.

---

## 11. Verification

- **Unit/integration**: `layout.ts`/`router.ts` determinism on a fixture `CanvasDoc`; rejection
  of `<script>`/`on*` in node HTML; forged-claim rejection for `hd` and `email_verified` (✅,
  `convex/users.test.ts` — missing `hd`, wrong `hd`, `email_verified: false`, happy path, all via
  `convex-test`'s `t.withIdentity()`); visibility enforcement on the anonymous `/s/:slug` path
  (✅, `convex/http.test.ts` — private canvas 404s, not a leaked-but-denied response; unpublish
  revokes the old slug; explicit `relPath` lookup; SVG forced `Content-Disposition: attachment`);
  token expiry and revocation (✅, `convex/tokens.test.ts`); `normalizeCanvasPath` traversal cases
  (✅, ported from the four guards it replaced); per-canvas storage quota and cache-TTL sweep (✅,
  `convex/canvases.test.ts` — quota rejection, same-relPath re-render not double-counted, quota
  scoped per canvas not per workspace, TTL sweep deletes stale `/cache/` rows and blobs while
  leaving fresh `/cache/` and any-age `/output/` alone).
- **Golden render**: PNG of the fixture canvas against a committed baseline. ⏳
- **Convex**: `convex-test` + vitest against an in-memory backend (✅, `convex/*.test.ts`, 47
  tests; 181 tests total across the whole workspace as of the last local `npm test` run); the
  1 MiB document ceiling on `canvasVersions`/`canvasNodes` is enforced structurally by storing
  the doc in file storage, not inline.
- **Manual end-to-end**: ✅ run live against the dev deployment (`giddy-retriever-468`) —
  `create_workspace` → `create_canvas` → `write_file` → `render_file` (real Railway worker
  round-trip) → `publish_canvas` → anonymous `GET /s/:slug` returned the correct bytes, CSP, and
  `nosniff` header; unpublish 404'd the same URL; re-publish minted a fresh slug, confirming the
  old one is really dead. `put_canvas_doc`/`get_canvas` round-tripped a `CanvasDoc` and a node
  `on*=` handler was rejected loudly, not stripped. `packages/canvas`'s own dev viewer (pan/zoom
  not auth-gated) confirmed selection, inspector, and the `ViewportController` API live in
  Chrome. Not yet covered: signed-in SPA flows (blocked on a real Google OAuth client ID) and the
  gallery's live-update-across-tabs behavior — both require the pending Netlify deploy.

---

## 12. Resolved decisions (formerly open questions)

1. **Write scoping** — resolved as decision #9: org-wide writes, `createdBy` attribution, no
   per-workspace ACL.
2. **Domains** — resolved as decision #13: Netlify's auto-generated subdomain is acceptable;
   `*.convex.site` is used as-is. Revisit only if a real need for `canvas.iota.uz` shows up.
3. **Embeds** — resolved as decision #12: deferred, no `/embed/:slug` route in v1.
4. **Retention & quotas** — ✅ shipped (tracked in C2/§9): a per-canvas 250MB soft storage quota
   (`convex/canvases.ts`'s `assertWithinQuota`, enforced on every render/exec/write) and a
   `/cache` TTL Convex cron (24h, `convex/crons.ts` → `canvases.sweepCacheTtl`) that deletes
   stale `/cache/` artifacts and their storage blobs. Quota rejection surfaces as a clear MCP
   tool error, not a silent drop.
5. **Token lifetime** — resolved as decision #10: 90 days, shipped.
6. **UI language** — resolved as decision #11: English only.

---

# Part 2 — Rendering runtime internals (inherited from the pre-hosting local spec)

Everything below describes `packages/runtime` as it was originally specified before the hosted
Convex/worker split existed. It is retained verbatim in structure (including its original
section numbers — `2.2`, `2.4`, `3.1`–`3.3`, the old §6 tool surface, `7`–`13`, `15`) because
`packages/runtime`'s source comments cite this content by those exact numbers, and the policies
described are still accurate: Tailwind v4 styling rules, D2/ApexCharts authoring modes, sandbox
restrictions, the template and theme systems, and the artifact manifest shape are unchanged by
the migration to a hosted product — only the transport (`stdio` → Convex `/mcp`) and the
identifier (`session_id` → `canvas_id`) changed, and those are covered by Part 1 §6.

Where a subsection's *contract* is superseded rather than merely relocated (the old §6 tool
surface itself, and old §7's session-workspace-as-filesystem framing), a note says so; the
underlying mechanics (sandbox directory layout, Tailwind build, D2 render, ApexCharts asset
vendoring) remain load-bearing.

### 2.2 One session → many artifacts

```text
Session = isolated workspace
Artifact = a concrete output file
Primary artifact = the main result
```

A session (now: a canvas render) produces a directory shape of `/src`, `/output`, `/assets`,
`/templates`, `/cache`, with a `manifest.json` tracking every output and which one is primary —
see §12 below. One canvas can produce multiple artifacts (e.g. a PNG and its source HTML).

### 2.4 Tailwind v4-only styling policy

All HTML/UI styling in the runtime uses Tailwind v4.

Allowed: Tailwind v4 utilities, `@import "tailwindcss";`, `@theme` tokens, CSS variables, minimal
scoped CSS when needed.

Forbidden by policy: Tailwind v3 config assumptions, `tailwind.config.js` as primary config,
external CSS frameworks, CDN CSS, Bootstrap/Bulma/Material UI CSS, large custom global CSS.

No separate validator — system instructions for the LLM, examples, runtime docs, the Tailwind v4
build pipeline, and failed builds as feedback are enough.

### 3.1 Raw HTML + Tailwind v4

Primary authoring mode for mockups, infographics, dashboards, report pages, and (via embedded D2
SVG, §3.2) architecture diagrams and flowcharts:

```html
<!doctype html>
<html>
  <head>
    <style>
      @import "tailwindcss";
      @theme {
        --font-sans: Inter, sans-serif;
        --color-brand: #2563eb;
      }
    </style>
  </head>
  <body class="m-0 bg-slate-100 font-sans">
    <main class="w-[1200px] h-[800px] p-16">
      <section class="rounded-3xl bg-white p-10 shadow-xl">
        <h1 class="text-5xl font-bold text-slate-950">Insurance CRM Platform</h1>
        <p class="mt-4 text-xl text-slate-600">Policies, claims, billing and reports in one system.</p>
      </section>
    </main>
  </body>
</html>
```

### 3.2 D2 for diagrams

D2 is the primary markup language for engineering diagrams: system architecture, service maps,
dependency diagrams, infrastructure diagrams.

```d2
Web App -> API Gateway: HTTPS
API Gateway -> CRM Core: REST
CRM Core -> Postgres: SQL
CRM Core -> Redis: cache
```

Pipeline: D2 source → SVG render → optional HTML wrapper → PNG/PDF embedding, or standalone SVG
export. Rendered D2 SVG is embedded directly into HTML documents for mockups/reports.

### 3.3 ApexCharts

Charts are authored directly as ApexCharts config objects inside HTML mode — no separate SDK
wrapper:

```html
<!doctype html>
<html>
  <head>
    <style>@import "tailwindcss";</style>
    <script src="/assets/js/apexcharts.min.js"></script>
  </head>
  <body class="bg-white p-10">
    <div id="chart"></div>
    <script>
      new ApexCharts(document.querySelector("#chart"), {
        chart: { type: "bar", height: 400 },
        title: { text: "Monthly policies sold" },
        xaxis: { categories: ["Jan", "Feb", "Mar", "Apr"] },
        series: [{ name: "Policies", data: [1200, 1800, 2300, 3100] }],
      }).render();
    </script>
  </body>
</html>
```

The `apexcharts.min.js` bundle is a local allowlisted asset — no CDN script tags, ever.

### 6 (superseded) — the original local-runtime tool surface

The original seven tools (`create_visual_session`, `run_code`, `write_file`, `render_file`,
`list_artifacts`, `export_artifact`, `list_templates`) are superseded by Part 1 §6's Convex/MCP
tool table — same underlying mechanics, `session_id` renamed `canvas_id`, plus workspace/canvas
CRUD and publish tools that didn't exist locally. `create_visual_session`'s template seeding bug
(only the first template per `kind` was ever reachable) is fixed in the new `create_canvas`,
which takes a template id directly.

### 7 (superseded) — filesystem model

Each session had an isolated workspace:

```text
/session
  /src
  /output
  /assets
  /templates
  /cache
```

Rules: the LLM writes to `/src` and `/output`; `/templates` is read-only; uploaded assets live in
`/assets`; final files must land in `/output`. This shape is now recreated per-render inside the
worker's throwaway temp directory (Part 1 §5's `hydrate`/`collectOutputs`) rather than persisted
per-canvas on disk.

### 8.1–8.3 Rendering pipelines

```text
8.1 HTML → image:  HTML+Tailwind → build CSS → Playwright Chromium → screenshot → Sharp → PNG
8.2 HTML → PDF:     HTML + print CSS → Playwright page.pdf() → PDF
8.3 D2 → image:     D2 source → SVG render → optional HTML wrapper → PNG/PDF embedding
```

Multi-page PDFs are plain HTML using print CSS for pagination (`break-after: page`), not a
Document builder API. `render_file` is called once against the assembled HTML with
`format: "pdf"`; Playwright/Chromium's print pagination handles page breaks and headers/footers
via `pdf` options. Supports multiple pages, page numbers, headers/footers, charts, diagrams,
tables, mockup screenshots, print background, A4/A3/Letter, portrait/landscape.

### 9 Sandbox policy

Restrictive by default: no external network from `run_code`'s own logic path (network access for
rendered pages themselves is a separate, accepted risk — Part 1 §10.2), no shell access, no
arbitrary npm install, allowlisted packages only (`apexcharts`, the D2 renderer, `tailwindcss`
v4), CPU/memory limits, a timeout per run, read/write confined to the session workspace, local
assets only.

Raw HTML mode specifically: allowed — HTML, Tailwind v4, inline SVG, local assets, local fonts,
allowlisted local JS bundles. Blocked — CDN scripts, CDN CSS, external images, remote fonts,
arbitrary browser navigation.

### 10 Template system

A small number of strong templates, each exposing:

```ts
{
  id: string;
  name: string;
  kind: "diagram" | "mockup" | "report" | "chart" | "infographic";
  description: string;
  expectedInputs: Record<string, unknown>;
  exampleCode: string;
}
```

Templates: `architecture-overview`, `sequence-flow`, `mobile-app-screen`, `browser-app-screen`,
`dashboard-overview`, `one-page-infographic`, `multipage-report`, `chart-report`.

### 11 Theme system

Token-based themes, compiled to Tailwind v4 `@theme` tokens:

```ts
{
  name: string;
  colors: { background: string; foreground: string; muted: string; primary: string; secondary: string; border: string };
  typography: { fontSans: string; fontMono: string };
  radius: { sm: string; md: string; lg: string; xl: string };
  spacing: Record<string, string>;
  shadows: Record<string, string>;
  chartPalette: string[];
  diagramStyle: { nodeRadius: string; edgeStyle: string };
}
```

Initial themes: `clean-saas`, `minimal-docs`, `dark-terminal`, `startup-pitch`.

### 12 Artifact manifest

Every render produces manifest metadata (now: rows in the `artifacts` Convex table, Part 1 §4,
rather than a `manifest.json` file — same shape):

```json
{
  "session_id": "sess_123",
  "primary": "/output/report.pdf",
  "artifacts": [
    { "path": "/output/report.pdf", "type": "pdf", "role": "primary" },
    { "path": "/output/architecture.png", "type": "image", "role": "supporting" },
    { "path": "/output/source.zip", "type": "source", "role": "debug" }
  ],
  "created_at": "2026-07-02T00:00:00Z"
}
```

Exactly one artifact is `primary` per canvas at all times — enforced by the hosted layer's
role-inference logic (`convex/canvases.ts`'s `upsertArtifact`), which re-derives the correct role
on every render rather than assuming "first render is primary, everything else supporting."

### 13 Package structure (superseded — see Part 1 §3 for the current monorepo layout)

The original repo was a single package with no workspaces:

```text
visual-runtime
  /src
    /server /sandbox /render/{diagrams,charts,themes,playwright-renderer,artifact-store}
    /templates
  /test
  package.json
  tsconfig.json
```

No custom SDK abstraction (`Document`/`Diagram`/`Chart` classes) — the LLM writes HTML/D2/
ApexCharts code directly; the render layer only wraps existing renderers (D2, Playwright, Sharp).
This constraint still holds in the monorepo layout.

### 15 Worked example

Flow: write a D2 file for the diagram, write one HTML file (report body + inline ApexCharts),
then call `render_file` once for PDF.

```ts
// 1. write_file("/src/architecture.d2", "Web App -> API Gateway: HTTPS\n...")
// 2. render_file({ entrypoint: "/src/architecture.d2", output_path: "/cache/architecture.svg", format: "svg" })
// 3. write_file("/src/report.html", "...") — embeds the rendered SVG inline, plus an ApexCharts <script> block
// 4. render_file({ entrypoint: "/src/report.html", output_path: "/output/insurance-crm-overview.pdf", format: "pdf", pdf: { format: "A4", printBackground: true } })
```

In the hosted product this is unchanged except `entrypoint`/`output_path` are `relPath`s scoped
to a `canvas_id` rather than a local session directory.
