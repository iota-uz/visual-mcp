# Build context is the repo root (see apps/web/Dockerfile.dockerignore and
# `docker build -f apps/web/Dockerfile .`) — same monorepo-workspace pattern
# as apps/worker/Dockerfile, but this image ships a static build, not a
# long-running Node process.
FROM node:22-slim AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/canvas/package.json packages/canvas/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY convex/package.json convex/package.json
# apps/web's tsconfig pulls in convex/_generated/*.d.ts, which type-imports
# the real convex/*.ts sources (e.g. "../mcp/tools.ts") for the shape of
# `typeof http`/`typeof mcp_tools` etc. — not just their own file, but
# everything THEY import too. That chain reaches @visual-canvas/runtime and
# convex's own dependencies: zod and @modelcontextprotocol/server, both
# declared on ROOT package.json, not per-workspace.
#
# This must be a bare `npm ci` — no `--workspace=` flags. Passing even one
# `--workspace` flag silently flips npm's `--include-workspace-root`
# default to false, which skips installing root's own "dependencies"
# entirely (verified by hand: a `--workspace`-scoped install, with or
# without an explicit `--include-workspace-root=false`, left
# node_modules/zod and node_modules/@modelcontextprotocol/server missing
# outright — not hoisted elsewhere, just never installed — which
# skipLibCheck then silently degrades to unrelated-looking TS7006 "implicit
# any" errors deep in apps/web's own route components, not a clear
# module-not-found error at the actual missing import). All five workspace
# package.json files must be present for the install to match
# package-lock.json's full topology.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: @visual-canvas/runtime's own
# `postinstall: playwright install chromium` would otherwise download a
# ~300MB browser this static-site image has no use for (only its *types*
# are needed here, never executed).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

FROM deps AS build
COPY packages/canvas packages/canvas
COPY packages/runtime packages/runtime
COPY convex convex
COPY apps/web apps/web
# packages/canvas and packages/runtime must build first: apps/web's
# typecheck reaches both via the chain above, and apps/web imports
# packages/canvas's dist/* subpaths directly at runtime too
# ("exports": { ".": "./dist/index.js", "./*": "./dist/*" }).
RUN npm run build --workspace=@visual-canvas/canvas
RUN npm run build --workspace=@visual-canvas/runtime
# Vite bakes VITE_* vars into the built JS at build time, not runtime — the
# Railway service must supply these as build-time variables (Railway
# auto-injects service variables as matching ARGs for Dockerfile builds).
ARG VITE_CONVEX_URL
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build --workspace=@visual-canvas/web

FROM node:22-slim AS run
ENV NODE_ENV=production
WORKDIR /app
RUN npm install --global serve@14
COPY --from=build /repo/apps/web/dist ./dist
EXPOSE 3000
# `serve -s` rewrites every unmatched path to index.html — the SPA-fallback
# behavior apps/web/public/_redirects gave for free on Netlify.
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
