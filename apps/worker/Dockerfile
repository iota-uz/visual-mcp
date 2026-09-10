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
COPY packages/canvas/package.json packages/canvas/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/video/package.json packages/video/package.json
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: @visual-canvas/runtime's own
# `postinstall: playwright install chromium` would otherwise re-download a
# browser this base image already bundles — redundant at best, a version
# mismatch at worst.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --workspace=@visual-canvas/worker --workspace=@visual-canvas/canvas --workspace=@visual-canvas/runtime --workspace=@visual-canvas/video --include-workspace-root=false
RUN mkdir -p packages/video/node_modules

FROM deps AS build
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
COPY apps/worker/src apps/worker/src
COPY packages/canvas/tsconfig.json packages/canvas/tsconfig.json
COPY packages/canvas/scripts packages/canvas/scripts
COPY packages/canvas/src packages/canvas/src
COPY packages/runtime/tsconfig.json packages/runtime/tsconfig.json
COPY packages/runtime/src packages/runtime/src
COPY packages/video/tsconfig.json packages/video/tsconfig.json
COPY packages/video/src packages/video/src
# Canvas must build before runtime, and runtime before the worker: both import
# workspace dist/* subpaths through their package.json exports maps.
RUN npm run build --workspace=@visual-canvas/canvas
RUN npm run build --workspace=@visual-canvas/runtime
RUN npm run build --workspace=@visual-canvas/video
RUN npm run build --workspace=@visual-canvas/worker

FROM base AS run
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
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
COPY --from=deps /repo/packages/canvas/node_modules packages/canvas/node_modules
COPY --from=deps /repo/packages/runtime/node_modules packages/runtime/node_modules
COPY --from=deps /repo/packages/video/node_modules packages/video/node_modules
COPY --from=build /repo/apps/worker/dist apps/worker/dist
COPY apps/worker/package.json apps/worker/package.json
COPY --from=build /repo/packages/canvas/dist packages/canvas/dist
COPY packages/canvas/package.json packages/canvas/package.json
COPY --from=build /repo/packages/runtime/dist packages/runtime/dist
COPY packages/runtime/package.json packages/runtime/package.json
COPY --from=build /repo/packages/video/dist packages/video/dist
COPY packages/video/package.json packages/video/package.json

EXPOSE 8080
CMD ["node", "apps/worker/dist/index.js"]
