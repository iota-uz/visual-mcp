<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Local stack

Every authenticated surface sits behind Google OAuth restricted to `@iota.uz`,
and this project's **live deployment is the dev one** (`giddy-retriever-468`).
So do not point the app at it and do not ask a human to sign in for you — run
your own stack:

```
npm run dev:agent
```

One command, idempotent, and it keeps running (a local Convex deployment is a
child process of `convex dev`, not a service). It creates a local backend on
first use, sets its environment, pushes the functions, seeds, and starts Vite
on :5173. `-- --no-serve` skips the dev server.

Then sign in with **one navigation, no clicks and no typing**:

```
http://localhost:5173/dev/sign-in?auto=1
```

The seed gives you `agent@iota.uz`, a populated workspace (`osago`) and an
empty one (`sandbox`), canvases of all four kinds including `kind=canvas`, a
published canvas at `/s/seedpublicshare000000000000`, a slug that was never
minted at `/s/seeddeadshare0000000000000` for the dead-link state, and a live
plus a revoked MCP token. `npm run dev:agent` prints the MCP token and the
`claude mcp add` line for the local endpoint.

### Authoring against the local stack

`canvas_save` works with the seeded token: content is written, the canvas
appears in the UI, and `canvas_url` comes back pointing at
`http://localhost:5173`. What does **not** work locally is rendering — the
render worker (`apps/worker`) is not part of this stack, so `WORKER_URL` /
`WORKER_TOKEN` are unset. A save that asks for a `renders` entry still stores
everything and returns `status: "partial"` with a `render_failed` warning; a
save without one returns `status: "ok"`. So `kind: "canvas"` (declarative
`doc`) is fully exercisable here, and thumbnails/PNG artifacts are not.

### UI states the seed cannot produce

```
VITE_FIXTURES=1 npm run dev -w apps/web
http://localhost:5173/?fixture=full|empty|loading|error
```

Swaps `convex/react` for in-memory fakes (`apps/web/src/dev/fixtures/`) — no
backend at all, starts in a second. `loading` holds every skeleton on screen,
`error` throws in route queries so the per-route boundaries render, `empty` is
an account with nothing in it. `/dev/kitchen-sink` remains the primitive matrix
and needs neither.

### Rules

- **Never change `SITE_URL` or `SPA_ORIGIN` on the live deployment.** They are
  what sign-in redirects and the public-canvas CSP are built from, and
  `SPA_ORIGIN` also constructs the `canvas_url` / `share_url` values handed to
  MCP clients. The local stack sets its own copies; that is the whole point.
- `.env.local` at the repo root points at the live deployment. `convex dev`
  rewrites it on startup, so `scripts/dev-agent.mjs` snapshots and restores it
  continuously. If you invoke `convex` by hand, pass `--env-file .env.agent`
  and put it back afterwards.
- Sign-in without Google exists only where `DEV_AUTH_SECRET` is set on the
  deployment (`convex/lib/devAuth.ts`), and `/dev/sign-in` only where
  `import.meta.env.DEV` is true. Both gates are pinned by tests and by CI.
