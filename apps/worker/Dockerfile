# Build context is the repo root (see .dockerignore next to this file and
# the `docker build -f apps/worker/Dockerfile .` invocation) — the worker
# lives in an npm workspaces monorepo, so `npm ci` needs the root
# package.json/package-lock.json even though this image only ships one
# workspace.
#
# Base image's bundled Chromium build must match the `playwright` npm
# version bit-for-bit — a mismatch fails at runtime (wrong browser
# revision), not at build time. packages/runtime/package.json pins an
# EXACT (non-caret) playwright version for this reason; when this worker
# starts depending on @visual-canvas/runtime (A1) and that pin moves, bump
# this tag in the same commit, not separately.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
# No packages/* dependency yet — A0.4 is an infra scaffold, not the real
# worker logic (PLAN.md section 3). Add `COPY packages/*/package.json
# packages/<name>/` lines here once apps/worker depends on
# @visual-canvas/runtime, alongside a `--workspace` flag for it below.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD guards that same future point: once a
# dependency in this install triggers @visual-canvas/runtime's own
# `postinstall: playwright install chromium`, this base image already
# bundles the matching browser — re-downloading it would be redundant at
# best and a version mismatch at worst.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --workspace=@visual-canvas/worker --include-workspace-root=false

FROM deps AS build
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
COPY apps/worker/src apps/worker/src
RUN npm run build --workspace=@visual-canvas/worker

FROM base AS run
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules node_modules
COPY --from=build /repo/apps/worker/dist apps/worker/dist
COPY apps/worker/package.json apps/worker/package.json

EXPOSE 8080
CMD ["node", "apps/worker/dist/index.js"]
