# Build context is the repo root (see .dockerignore next to this file and
# the `docker build -f apps/worker/Dockerfile .` invocation) — the worker
# lives in an npm workspaces monorepo, so `npm ci` needs the root
# package.json/package-lock.json even though this image only ships one
# workspace.
#
# Base image's bundled Chromium build must match the `playwright` npm
# version bit-for-bit — a mismatch fails at runtime (wrong browser
# revision), not at build time. packages/runtime/package.json pins an
# EXACT (non-caret) playwright version for this reason; this tag must move
# in the same commit as that pin, not separately.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/runtime/package.json packages/runtime/package.json
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: @visual-canvas/runtime's own
# `postinstall: playwright install chromium` would otherwise re-download a
# browser this base image already bundles — redundant at best, a version
# mismatch at worst.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --workspace=@visual-canvas/worker --workspace=@visual-canvas/runtime --include-workspace-root=false

FROM deps AS build
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
COPY apps/worker/src apps/worker/src
COPY packages/runtime/tsconfig.json packages/runtime/tsconfig.json
COPY packages/runtime/src packages/runtime/src
# @visual-canvas/runtime must build first: the worker imports its dist/*
# subpaths directly (package.json "exports": { "./*": "./dist/*" }).
RUN npm run build --workspace=@visual-canvas/runtime
RUN npm run build --workspace=@visual-canvas/worker

FROM base AS run
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules node_modules
# npm nests a dependency's own node_modules/ under a workspace instead of
# hoisting it to the root when the root package.json declares a conflicting
# version of the same package — exactly what root's zod@4 (for the MCP SDK
# v2 spike, see convex/http.ts) does against @visual-canvas/runtime's
# zod@^3.24.0. Skipping these two copies produces an image that builds and
# passes typecheck/test but crashes at container startup with
# ERR_MODULE_NOT_FOUND — verified by actually booting the built image, not
# just building it.
COPY --from=deps /repo/apps/worker/node_modules apps/worker/node_modules
COPY --from=deps /repo/packages/runtime/node_modules packages/runtime/node_modules
COPY --from=build /repo/apps/worker/dist apps/worker/dist
COPY apps/worker/package.json apps/worker/package.json
COPY --from=build /repo/packages/runtime/dist packages/runtime/dist
COPY packages/runtime/package.json packages/runtime/package.json

EXPOSE 8080
CMD ["node", "apps/worker/dist/index.js"]
