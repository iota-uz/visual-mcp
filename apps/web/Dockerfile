# Build context is the repo root (see apps/web/Dockerfile.dockerignore and
# `docker build -f apps/web/Dockerfile .`) — same monorepo-workspace pattern
# as apps/worker/Dockerfile, but this image ships a static build, not a
# long-running Node process.
FROM node:22-slim AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/canvas/package.json packages/canvas/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/video/package.json packages/video/package.json
COPY convex/package.json convex/package.json
# apps/web's tsconfig pulls in convex/_generated/*.d.ts, whose API types reach
# the real Convex modules and their workspace dependencies.
#
# This must be a bare `npm ci` — no `--workspace=` flags. Passing even one
# `--workspace` flag silently flips npm's `--include-workspace-root`
# default to false, which skips installing root's own "dependencies"
# entirely (verified by hand: a `--workspace`-scoped install, with or
# without an explicit `--include-workspace-root=false`, left
# node_modules/zod and node_modules/@modelcontextprotocol/server missing
# outright — not hoisted elsewhere, just never installed. All workspace
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
COPY packages/video packages/video
COPY convex convex
COPY apps/worker apps/worker
COPY apps/web apps/web
# packages/canvas, packages/runtime and packages/video must build first: apps/web's
# typecheck reaches both via the chain above, and apps/web imports
# packages/canvas's dist/* subpaths directly at runtime too
# ("exports": { ".": "./dist/index.js", "./*": "./dist/*" }).
RUN npm run build --workspace=@visual-canvas/canvas
RUN npm run build --workspace=@visual-canvas/runtime
RUN npm run build --workspace=@visual-canvas/video
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
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
COPY --from=build /repo/apps/web/dist ./dist
COPY apps/web/server.mjs ./server.mjs
EXPOSE 3000
CMD ["node", "server.mjs"]
