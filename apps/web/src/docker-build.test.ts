import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("web Docker build includes every workspace manifest before npm ci and builds video before web", () => {
  const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
  const install = dockerfile.indexOf("RUN npm ci");
  for (const workspace of [
    "apps/mcp",
    "apps/web",
    "apps/worker",
    "packages/canvas",
    "packages/runtime",
    "packages/video",
    "convex",
  ]) {
    const copy = dockerfile.indexOf(`COPY ${workspace}/package.json ${workspace}/package.json`);
    expect(copy, `${workspace} manifest available at install`).toBeGreaterThan(-1);
    expect(copy).toBeLessThan(install);
  }
  const source = dockerfile.indexOf("COPY packages/video packages/video");
  const build = dockerfile.indexOf("RUN npm run build --workspace=@visual-canvas/video");
  const web = dockerfile.indexOf("RUN npm run build --workspace=@visual-canvas/web");
  expect(source).toBeGreaterThan(install);
  expect(build).toBeGreaterThan(source);
  expect(web).toBeGreaterThan(build);
});
