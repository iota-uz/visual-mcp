FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/canvas/package.json packages/canvas/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/video/package.json packages/video/package.json
COPY convex/package.json convex/package.json
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
RUN mkdir -p packages/video/node_modules

FROM deps AS build
COPY packages/canvas packages/canvas
COPY packages/runtime packages/runtime
COPY packages/video packages/video
COPY convex convex
COPY apps/mcp apps/mcp
RUN npm run build --workspace=@visual-canvas/canvas
RUN npm run build --workspace=@visual-canvas/runtime
RUN npm run build --workspace=@visual-canvas/video
RUN npm run build --workspace=@visual-canvas/mcp

FROM node:22-slim AS run
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/apps/mcp/node_modules apps/mcp/node_modules
COPY --from=deps /repo/packages/canvas/node_modules packages/canvas/node_modules
COPY --from=deps /repo/packages/runtime/node_modules packages/runtime/node_modules
COPY --from=deps /repo/packages/video/node_modules packages/video/node_modules
COPY --from=build /repo/apps/mcp/dist apps/mcp/dist
COPY apps/mcp/package.json apps/mcp/package.json
COPY --from=build /repo/packages/canvas/dist packages/canvas/dist
COPY packages/canvas/package.json packages/canvas/package.json
COPY --from=build /repo/packages/runtime/dist packages/runtime/dist
COPY packages/runtime/package.json packages/runtime/package.json
COPY --from=build /repo/packages/video/dist packages/video/dist
COPY packages/video/package.json packages/video/package.json
EXPOSE 8080
CMD ["node", "apps/mcp/dist/index.js"]
