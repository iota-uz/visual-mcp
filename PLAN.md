# Visual Canvas — architecture & roadmap

`visual-canvas` (formerly `visual-runtime`) is a hosted service for @iota.uz: Claude authors
canvases and artifacts through a remote MCP endpoint, and humans browse, view, and share them by
URL. This document is the canonical architecture reference for the repo — Part 1 describes the
hosted product as it exists today plus what's left to ship; Part 2 keeps the still-accurate half
of the original single-user local-runtime spec, since `packages/runtime`'s rendering internals
(Tailwind policy, D2/ApexCharts authoring modes, sandbox policy, template/theme systems, artifact
manifest shape) still work exactly as first specified and code comments throughout that package
cite them by section number. The parts of that spec describing the removed local stdio server are
gone — see the note at the head of Part 2.

Status legend: ✅ shipped · 🚧 in progress · ⏳ not started.

## Decisions (do not re-litigate)

| # | Decision |
|---|---|
| 1 | **Agent-authored, with a focused layout editor.** MCP authors content and graph structure; signed-in humans may move/resize nodes. No general-purpose tldraw/Excalidraw layer. |
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
| 12 | **Static public preview cards are supported; embedded viewers remain deferred.** GitHub/Markdown receives a script-free image linked to the existing share view or artifact. No website iframe snippet and no separate `/embed/:slug` viewer. |
| 13 | **No custom domain *requirement* for v1** — a platform-generated subdomain would have been acceptable; `*.convex.site` is used as-is for `/mcp` and artifacts. In practice the SPA got one anyway: `canvas.iota.uz`, CNAME'd to Railway (DNS-only, not proxied, so Railway's own Let's Encrypt cert issuance can validate directly). (Originally scoped as Netlify; shipped on Railway instead. See §12.2.) |

---

## 1. Product surface

**Entities:** `Workspace` → `Canvas` → `CanvasVersion` (+ artifact files). A workspace is a
folder ("OSAGO", "Billing"). A canvas is one shareable thing with a stable URL, a kind
(`canvas` | `html` | `image` | `pdf`), and version history — Claude re-rendering creates a new
version, never destroys the old one.

| Route | Host | Auth | Purpose | Status |
|---|---|---|---|---|
| `/` · `/w/:wsSlug` · `/c/:canvasId` | SPA | Convex session | workspaces · canvas grid · viewer | ✅ |
| `/assets` · `/w/:wsSlug` | SPA | Convex session | personal/workspace reusable media | ✅ |
| `/settings/tokens` | SPA | Convex session | mint/revoke MCP tokens | ✅ |
| `/mcp` | `*.convex.site` | bearer | remote MCP endpoint | ✅ |
| `/s/:slug[/*]` | `*.convex.site` | slug or signed | artifact bytes, separate cookieless origin | ✅ |

Deep-linking: `?node=<nodeId>` selects and frames a node (a query param, not a `#` fragment —
`apps/web/src/routes/Canvas.tsx` drives it through react-router's `useSearchParams`, which is
the natural fit for an SPA route already keyed on `useParams`). Addressable inspector state is
what makes these diagrams useful pasted into Slack or Notion.

---

## 2. Canvas document format — the core deliverable

CanvasDoc v2 is the only supported canvas schema. Geometry and routing are explicit; v1 is rejected
without conversion. Types live in `packages/canvas/src/types.ts` and are zod-validated on every
`canvas_save` and semantic patch.

```ts
export interface CanvasDoc {
  version: 2
  title: string; subtitle?: string
  theme?: ThemeId
  world: { width: number; height: number }
  lanes: Array<{ id: string; label: string; role: LaneRole; rect: Rect }>
  stages: Array<{ id: string; index: number; label: string; rect: Rect }>
  labels: Array<{ id: string; text: string; rect: Rect }>
  nodes: CanvasNode[]; edges: CanvasEdge[]
  legend?: LegendGroup[]
}

interface BaseNode {
  id: string; laneId?: string; stageId?: string; rect: Rect
  caption: { title: string; subtitle?: string; tag?: string }
  maturity?: 'live'|'partial'|'to-be'
  anchors: Array<{ id: string; side: 'top'|'right'|'bottom'|'left'; offset: number }>
  inspector?: { eyebrow: string; title: string; copy: string; points?: string[] }
}
type CanvasNode =
  | (BaseNode & { kind: 'native'; shape: NodeShape; body?: { text?: string; points?: string[]; code?: string } })
  | (BaseNode & {
      kind: 'iframe'
      source: { entrypoint: `/src/screens/${string}.html`; route?: `#/${string}` }
      viewport: { width: number; height: number }
      frame:
        | { kind: 'phone'; time: string } // canonical canvas chrome; viewport is exactly 284×642
        | { kind: 'browser'|'desktop'|'none'; radius?: number; fit?: 'contain'|'cover'|'stretch' }
      sandbox: Array<'allow-scripts'|'allow-forms'>
      permissions: Array<'camera'|'microphone'|'geolocation'|'clipboard-write'>
      activation: 'double-click'
    })

export interface CanvasEdge {
  id: string
  source: { nodeId: string; anchorId: string }
  target: { nodeId: string; anchorId: string }
  kind: 'main'|'secondary'|'sync'|'actor'|'exception'|'external'
  route: { type: 'straight'|'bezier'|'orthogonal'; waypoints?: Point[] }
  label?: { text: string; position?: number; offset?: Point }
  bidirectional?: boolean
}
```

Native nodes contain only structured text/points/code. Product UI lives in local iframe entrypoints
under `/src/screens/`; external iframe URLs, traversal and `allow-same-origin` are rejected. The
outer node owns rect, selection, resize and connector anchors, so graph geometry never enters the
iframe. Public and private viewers use version-scoped file snapshots, a restrictive iframe CSP and
an explicit double-click/Enter interaction mode with Escape/Exit deactivation.

**Engine modules** (`packages/canvas/src/`, isomorphic — same code in Node and browser), all ✅
shipped:

| Module | Responsibility |
|---|---|
| `types.ts` | schema above + zod |
| `layout.ts` | explicit rects and anchor coordinates |
| `router.ts` | straight/bezier/orthogonal paths with optional stable waypoints |
| `render.ts` | lanes, stages, labels, native cards, iframe shells and SVG edge layer |
| `viewport.ts` | pan/zoom/grid, selection, move/resize and iframe activation/focus |
| `theme.css` | the ported design system (tokens, shadow ladder, role palettes, caption bar, arrow markers) |

`render.ts` also emits the export page. The worker waits for parent fonts plus a readiness bridge
from every iframe before PNG/PDF capture; never-ready screens return explicit partial/failed
readiness instead of silently publishing blank rectangles.

---

## 3. Architecture

```
Convex deployment                          Railway project
├── schema + queries/mutations             ├── render-worker  (public domain, WORKER_TOKEN)
├── file storage (docs, artifacts, thumbs) │   Playwright/Chromium · D2 wasm · Tailwind CLI
├── asset metadata + immutable bindings    │   DNS-pinned HTTPS asset import
├── Convex Auth + /mcp + /s/:slug          ├── Vite + React SPA
└── crons + capability tokens              └── private S3 source/delivery buckets
├── Convex Auth (Google, hd-restricted)        sharp · run_code
├── httpAction  /mcp                           creds: NONE — per-request Convex storage URLs
├── httpAction  /s/:slug  (artifact proxy)
└── crons (cache TTL, quota sweep)

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
apps/worker/        ✅ Hono + Playwright + D2 + Tailwind + run_code + safe asset import
apps/web/           ✅ Vite + React SPA — routes, viewer/layout editing, publish, tokens,
                     personal/workspace Asset Library
```

React was the right call once the SPA existed — Convex's client is React-first and reactive
queries are the win. The canvas viewer stays framework-free in `packages/canvas` and is mounted
by a thin React wrapper (`apps/web/src/routes/Canvas.tsx`'s `CanvasViewport`, which fetches the
stored `CanvasDoc` client-side via a signed `ctx.storage.getUrl()` and calls `layoutCanvas` +
`mountViewport` directly — no server round-trip through the worker for the interactive view;
the worker is still what produces PNG/PDF/thumbnail exports). Worker Dockerfile targets
`mcr.microsoft.com/playwright:v1.62.1-noble` (Node 24, which CI also pins so the sandbox's
Node-22+ globals are exercised on the same major the image ships).

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
than a single jsonb blob: `?node=` resolution and "find the canvas that mentions Europrotocol"
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
  what makes revocation real. ✅ shipped end-to-end: `canvases.rotateMySlug` mints a fresh slug
  in a single atomic patch (no unpublish→publish round trip, so there's no window where the
  canvas briefly resolves as private), and `PublishControl` in `apps/web/src/routes/Canvas.tsx`
  exposes a "Rotate link" button next to the share toggle when the canvas is public.

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
the system (the *old* stdio server's `session-store.ts` was a separate, unrelated thing, removed
with the rest of the local path per decision #6).

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

Convex file storage URLs live on `*.convex.cloud` — already a different origin from the SPA's
own host, but headers can't be set on them. So HTML artifacts stream through an httpAction on
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
  nosniff`. `frame-ancestors` widens beyond `'self'` only once the `SPA_ORIGIN` env var is set —
  unset, it's "no embedding at all," the safe default rather than a broken one.
  `SPA_ORIGIN` is now set to the real deployed SPA's origin. `'unsafe-inline'` for scripts is
  unavoidable (ApexCharts init is inline);
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
  and `sharp`-downscaled to ~600px. ✅ wired for both kinds (see §2).

---

## 9. Milestones

### Track A — platform

| M | Ships | Status |
|---|---|---|
| **A0** Foundations | npm workspaces; `src/` → `packages/runtime` with the local-runtime tests green; `normalizeCanvasPath` extracted, other guards folded in or deleted; `CanvasStorage` + disk impl; CI (typecheck + test) and Biome; worker Dockerfile; Convex project + Railway worker service provisioned | ✅ done |
| **A1.0** MCP spike | Prove `createMcpHandler` runs in the Convex runtime before building real tools against it | ✅ done — ran cleanly, no Hono/Railway fallback needed |
| **A1** Hosted MCP end-to-end | Convex schema + mutations/queries; Convex file storage wired; worker with hydrate/render/persist, credential-free env; `/mcp` httpAction on SDK v2 with bearer auth; all 13 tools; `export_artifact` size cap | ✅ done — `claude mcp add --transport http …` → create canvas → write HTML → render PNG → get a URL that loads, works end-to-end |
| **A2** Web product | Native Google OIDC auth with `hd` + `email_verified` enforcement; public query/mutation layer for workspaces/canvases/tokens; SPA (workspaces, canvas grid, viewer, share toggle, token UI); `/s/:slug` httpAction with CSP; deploy | ✅ done — SPA live at `canvas.iota.uz`, built as a static Dockerfile image (`apps/web/Dockerfile`, served by `serve -s`) on Railway rather than the originally-scoped Netlify (§12.2); OAuth client ID and `SPA_ORIGIN` set on the real deployment. Live-updating thumbnails verified end-to-end against the deployed worker. Browser verification: §11 |

### Track B — canvas engine

| M | Ships | Status |
|---|---|---|
| **B1** Engine | `packages/canvas/{types,layout,router,render,viewport,theme.css}`; zod schema; Vite viewer bundle; the osago design system ported | ✅ done |

### Convergence

| M | Ships | Status |
|---|---|---|
| **C1** Canvas kind live | `put_canvas_doc`/`get_canvas`; doc JSON in file storage + `canvasNodes` search index; viewer page on the app origin; server-side render → thumbnail + PNG/PDF export | ✅ done — MCP-side wiring (`put_canvas_doc`/`get_canvas`, `canvasNodes`, inline Tailwind compile in `renderFile`) plus an SPA viewer that mounts `packages/canvas`'s viewport client-side against the stored doc, with no worker round-trip. Thumbnails cover both paths: `render_file(format="png")` for html/image/pdf canvases, and for kind="canvas", `put_canvas_doc` assembles a full static page at `/src/__canvas.html` and renders it through the worker, attaching the PNG as a forced-`"supporting"` artifact so the doc itself stays primary. A worker failure surfaces as `render_error` on the tool response rather than failing the call. Because the assembled page is a real `canvasFiles` row, `render_file(entrypoint: "/src/__canvas.html", format: "pdf")` gives PDF export with zero new worker code. Regression-tested (`convex/http.test.ts`) and live-verified end-to-end against the dev deployment |
| **C2** Polish | public slug rotation UI, `?node=` deep links, search UI over `canvasNodes`, version history UI, template gallery, theme integration, Convex crons for `/cache` TTL (24h) and per-canvas storage quota (250MB soft), CDN-inlining on upload | 🚧 partial — shipped: the `/cache` TTL cron (`canvases.sweepCacheTtl`, 24h, `convex/crons.ts`); the 250MB per-canvas soft quota (`reserveCanvasStorage`) tracked as a running counter rather than a scan, since version history keeps superseded blobs alive — rejections surface as a clear MCP error and the just-stored blob is cleaned up; public-slug rotation (`rotateMySlug` + a "Rotate link" button); `?node=` deep links; cross-workspace node search (`searchNodes` + a Home-page search box), which also fixed `putDoc` leaking the previous version's `canvasNodes` rows; and read-only version history (`listVersionsMine`, no restore/rollback). All regression-tested in `convex/canvases.test.ts` and live-verified against the dev deployment. Still ⏳: template gallery, theme integration, CDN-inlining on upload. `apps/web` has no test suite yet, so the SPA halves are code-reviewed and browser-checked, not automated |

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
  `convex/canvases.test.ts` — quota rejection, same-relPath re-render *accumulating* against the
  quota (the running-counter fix — a same-relPath re-render keeps the superseded blob alive for
  version history, so it must add to the total, not cancel out; the original test asserted the
  opposite and was itself proof the first cut of this quota didn't measure real usage), quota
  scoped per canvas not per workspace, TTL sweep deletes stale `/cache/` rows and blobs while
  leaving fresh `/cache/` and any-age `/output/` alone and releases exactly the deleted bytes from
  the running counter); thumbnail capture and replacement (✅, `convex/canvases.test.ts` — a
  primary render's thumbnail is wired to the canvas, a superseded thumbnail is actually deleted
  (`ctx.storage.get` returns null afterward) rather than orphaned, a thumbnail from a
  supporting/non-primary render is discarded rather than wired, thumbnails don't count against
  the storage quota) plus `apps/worker/test/render.test.ts` (a png render with a
  `thumbnailUpload` produces and uploads a smaller, downscaled PNG; no thumbnail is produced
  without one, or for non-png formats even if one is provided); public-slug rotation (✅,
  `convex/canvases.test.ts` — mints a new slug in one atomic patch, the old slug stops resolving
  via `resolvePublicArtifact`, rejects rotating a private canvas, rejects an unauthenticated
  caller); cross-workspace node search (✅, `convex/canvases.test.ts` — `putDoc` deletes the
  previous version's `canvasNodes` rows instead of leaving them behind (the bug found while
  building this), `searchNodes` finds a node by `searchText` and resolves its parent canvas,
  blank query returns `[]`, unauthenticated caller rejected); version history (✅,
  `convex/canvases.test.ts` — lists newest-first, flags the current version, resolves the
  author's email, empty list for a deleted/unknown canvas rather than throwing, unauthenticated
  caller rejected).
- **Golden render**: PNG of the fixture canvas against a committed baseline. ⏳
- **Convex**: `convex-test` + vitest against an in-memory backend (✅, `convex/*.test.ts`, 62
  tests; 199 tests total across the whole workspace as of the last local `npm test` run); the
  1 MiB document ceiling on `canvasVersions`/`canvasNodes` is enforced structurally by storing
  the doc in file storage, not inline.
- **Manual end-to-end**: ✅ run live against the dev deployment (`giddy-retriever-468`) —
  `create_workspace` → `create_canvas` → `write_file` → `render_file` (real Railway worker
  round-trip) → `publish_canvas` → anonymous `GET /s/:slug` returned the correct bytes, CSP, and
  `nosniff` header; unpublish 404'd the same URL; re-publish minted a fresh slug, confirming the
  old one is really dead. `put_canvas_doc`/`get_canvas` round-tripped a `CanvasDoc` and a node
  `on*=` handler was rejected loudly, not stripped. `packages/canvas`'s own dev viewer (pan/zoom
  not auth-gated) confirmed selection, inspector, and the `ViewportController` API live in
  Chrome. Thumbnail capture verified live end-to-end after redeploying the Railway worker: a
  `render_file(format="png")` call produced and uploaded a correctly-downscaled thumbnail
  (600px-capped, aspect preserved), `get_canvas`/`list_canvases` both resolved a working
  `thumbnail_url`, and re-rendering the primary path confirmed the superseded thumbnail blob was
  actually deleted (404 on refetch), not leaked. The `canvasNodes` dedup fix was verified the same
  way: two real `put_canvas_doc` calls to the same `canvas_id` left exactly one `canvasNodes` row
  (checked via `npx convex data canvasNodes`), holding the newer content, and
  `npx convex run --inline-query` confirmed the search index resolves it; the same inline-query
  technique confirmed `canvasVersions`/`currentVersionId` back the version-history query
  correctly on real multi-version data. The SPA is now deployed (Railway, see §12.2) with a real
  Google OAuth client ID configured, unblocking the signed-in browser flows (gallery live-update
  across tabs, viewer pan/zoom/inspector/`?node=`, `/settings/tokens` mint/revoke, public/private
  `/s/:slug` toggling from the UI) — see the PR description for the manual-pass checklist and
  results.

---

## 12. Resolved decisions (formerly open questions)

1. **Write scoping** — resolved as decision #9: org-wide writes, `createdBy` attribution, no
   per-workspace ACL.
2. **Domains** — resolved as decision #13: `*.convex.site` is used as-is for `/mcp` and
   artifacts. **Host changed from the original Netlify plan to Railway**
   (`apps/web/Dockerfile`, static build served via `serve -s` with SPA fallback, deployed to the
   same Railway project as the render worker) — this session had authenticated Railway access
   but none on Netlify, and Railway was already in use for the worker, so it was the pragmatic
   choice once a human confirmed the switch. `apps/web/public/_redirects` (the Netlify-specific
   SPA-fallback config) has been deleted — `serve -s` provides the same fallback behavior
   directly via the Dockerfile's `CMD`. The SPA is live at
   **`canvas.iota.uz`** — a real custom domain, not the platform-generated fallback decision #13
   said was acceptable — CNAME'd to Railway via Cloudflare (DNS-only, not proxied). Its
   `GOOGLE_OAUTH_CLIENT_ID` reuses the existing shared IOTA-ERP OAuth client rather than a
   dedicated one, per a human's explicit choice; `https://canvas.iota.uz` has been added to that
   client's Authorized JavaScript origins (Google notes propagation can take 5 minutes to a few
   hours).
3. **Interactive embeds** — resolved as decision #12: no `/embed/:slug` viewer. Static GitHub/Markdown preview cards live under the revocable `/s/:slug/_embed/card.svg` boundary and link back to the existing share view or artifact.
4. **Retention & quotas** — ✅ shipped (tracked in C2/§9): a per-canvas 250MB soft storage quota
   (`convex/canvases.ts`'s `reserveCanvasStorage`, enforced on every render/exec/write) tracked as
   a running counter (`canvases.storageBytesUsed`) rather than a scan of current `artifacts`/
   `canvasFiles` rows — version history means a superseded blob is never freed, so a scan-based
   total undercounts and would let repeated re-renders of the same `output_path` bypass the cap
   entirely (caught in review, fixed before merge). A `/cache` TTL Convex cron (24h,
   `convex/crons.ts` → `canvases.sweepCacheTtl`) deletes stale `/cache/` artifacts, their storage
   blobs, and releases their bytes from the running counter. Quota rejection surfaces as a clear
   MCP tool error, not a silent drop, and `write_file`/`render_file`/`run_code` clean up the
   just-stored blob if the rejection happens after the upload.
5. **Token lifetime** — resolved as decision #10: 90 days, shipped.
6. **UI language** — resolved as decision #11: English only.

---

# Part 2 — Rendering runtime internals (inherited from the pre-hosting local spec)

Everything below describes `packages/runtime` as it was originally specified before the hosted
Convex/worker split existed. The policies described are still accurate: Tailwind v4 styling
rules, D2/ApexCharts authoring modes, sandbox restrictions, the template and theme systems, and
the artifact manifest shape are unchanged by the migration to a hosted product — only the
transport (`stdio` → Convex `/mcp`) and the identifier (`session_id` → `canvas_id`) changed, and
those are covered by Part 1 §6.

**Removed:** the three subsections that described the local stdio runtime rather than a policy —
old §6 (its seven-tool surface, superseded by Part 1 §6's tool table), old §7 (the persisted
per-session filesystem, which no longer exists; the same `/src`, `/output`, `/assets`,
`/templates`, `/cache` shape is now recreated per-render inside the worker's throwaway temp
directory — see §2.2 below and Part 1 §5's `hydrate`/`collectOutputs`), and old §13 (the
pre-workspaces single-package tree, superseded by Part 1 §3's monorepo layout). Every *other*
section keeps its original number — `packages/runtime`'s source comments cite them by number —
so the gaps left behind are deliberate.

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

**No custom SDK abstraction** (no `Document`/`Diagram`/`Chart` classes, no "VisualKit") — each
template is a concrete example of HTML/D2/ApexCharts code the LLM writes directly, and the render
layer only wraps existing renderers (D2, Playwright, Sharp). This constraint predates the
monorepo and still holds; `packages/runtime`'s comments cite it as "section 13's no-VisualKit
constraint."

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
# Green-field storage and editing

Visual Canvas uses strict incremental editing rather than whole-project regeneration:
`canvas_edit` mirrors exact old/new string replacement, `canvas_apply_patch` applies an
atomic multi-file patch, and `canvas_doc_patch` edits CanvasDoc entities by stable id.
Every successful operation creates an immutable canvas snapshot and uses optimistic
`expected_version`/content-hash checks.

Reusable media lives in a personal or workspace Asset Library. Convex stores metadata,
permissions, revisions and canvas bindings; private S3-compatible Railway buckets store
source and validated delivery objects. Canvas versions pin exact asset revisions. Asset
updates never propagate implicitly, and public/private viewers can only resolve objects
present in their version manifest.
