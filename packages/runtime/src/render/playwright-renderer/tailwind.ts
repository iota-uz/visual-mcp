/**
 * Tailwind v4 CSS build step (PLAN.md sections 2.4, 8.1, 8.2).
 *
 * Tailwind v4 dropped the old JS build API (`tailwindcss.compile()` /
 * `tailwind.config.js` + PostCSS plugin config). The supported entry point
 * for a plain (bundler-less) pipeline like ours is the `@tailwindcss/cli`
 * binary — there is also `@tailwindcss/postcss` for webpack/vite-style
 * pipelines, but we have no bundler here: we're compiling a single inline
 * `<style>@import "tailwindcss"; ...</style>` block extracted from an
 * author-written HTML file, so the CLI is the natural fit.
 *
 * We shell out to the CLI's `dist/index.mjs` entry via `node <path>`
 * (resolved through `createRequire` against this module's own
 * node_modules) rather than `npx @tailwindcss/cli`, to avoid npx's
 * registry-resolution overhead and keep the whole build fully offline.
 *
 * Content (utility-class) detection: Tailwind v4 has no `content: [...]`
 * config — it auto-detects template files by scanning outward from a
 * "base" directory (the CLI's `--cwd` flag), skipping node_modules/.git/
 * gitignored/binary files. We always write the temp input CSS file *next
 * to* the HTML entrypoint and pass that directory as `--cwd`, so the
 * entrypoint itself is guaranteed to be inside the scanned base directory
 * and its class names get picked up. Verified empirically against a real
 * fixture: `@tailwindcss/cli -i <dir>/.tw-input.css -o <dir>/.tw-output.css
 * --cwd <dir>` with an HTML file in the same `<dir>` using
 * `class="bg-slate-100 p-16 text-5xl font-bold text-brand"` (with a
 * `@theme { --color-brand: ... }` block) produces real
 * `.bg-slate-100 { ... }` / `.text-brand { color: ... }` rules in the
 * output CSS.
 *
 * Resolving `@import "tailwindcss"` itself: that bare specifier in the
 * entry CSS is resolved by the CLI relative to `scanDir` (walking up for a
 * `node_modules/tailwindcss`), NOT relative to this module's own install
 * location — so it only worked by accident wherever `scanDir` happened to
 * sit inside a directory tree with `tailwindcss` hoisted above it (true for
 * the fixture-based tests under `packages/runtime/sessions/.test-tmp`,
 * false for `apps/worker`'s real `hydrate()` workspaces, which live under
 * `os.tmpdir()` — no repo, no node_modules, ever). That made the whole
 * inline-Tailwind render path silently fail for any real Tailwind-classed
 * HTML in production while every test stayed green. `ensureTailwindResolvable`
 * below symlinks the real installed package into `scanDir/node_modules/`
 * before every build, independent of where `scanDir` lives.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedCliBinPath: string | undefined;

/** Resolves the on-disk path of @tailwindcss/cli's executable entry file. */
function resolveTailwindCliBin(): string {
  if (cachedCliBinPath) return cachedCliBinPath;
  const req = createRequire(import.meta.url);
  const pkgJsonPath = req.resolve("@tailwindcss/cli/package.json");
  // "dist/index.mjs" isn't in the package's `exports` map (only
  // "./package.json" is), so we resolve the package root via package.json
  // and join the bin path ourselves rather than deep-importing the subpath.
  cachedCliBinPath = path.join(path.dirname(pkgJsonPath), "dist", "index.mjs");
  return cachedCliBinPath;
}

let cachedTailwindPkgDir: string | undefined;

function resolveTailwindPkgDir(): string {
  if (cachedTailwindPkgDir) return cachedTailwindPkgDir;
  const req = createRequire(import.meta.url);
  cachedTailwindPkgDir = path.dirname(req.resolve("tailwindcss/package.json"));
  return cachedTailwindPkgDir;
}

/**
 * Makes `@import "tailwindcss"` resolvable from `scanDir` regardless of
 * where it lives on disk, by symlinking the actually-installed package
 * into `scanDir/node_modules/` — see this file's header comment for why
 * this is necessary at all. Idempotent and safe under concurrent calls
 * against the same `scanDir` (e.g. two `put_canvas_doc` compiles racing).
 */
async function ensureTailwindResolvable(scanDir: string): Promise<void> {
  const linkPath = path.join(scanDir, "node_modules", "tailwindcss");
  try {
    await fs.access(linkPath);
    return;
  } catch {
    // fall through to create it
  }
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  try {
    await fs.symlink(resolveTailwindPkgDir(), linkPath, "dir");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

/**
 * Compiles a raw Tailwind v4 entry CSS string (typically the contents of a
 * `<style>@import "tailwindcss"; @theme {...}</style>` block) into real,
 * resolved CSS, scanning `scanDir` (and its descendants) for utility class
 * usage.
 *
 * Throws with the CLI's stderr attached to the message on build failure —
 * per PLAN.md section 2.4, failed builds are meant to be surfaced as
 * feedback (there is no separate class-name validator in v0.1).
 */
export async function buildTailwindCss(rawCss: string, scanDir: string): Promise<string> {
  const cliBin = resolveTailwindCliBin();
  const id = randomUUID();
  const inputPath = path.join(scanDir, `.tw-input-${id}.css`);
  const outputPath = path.join(scanDir, `.tw-output-${id}.css`);

  await fs.writeFile(inputPath, rawCss, "utf8");
  await ensureTailwindResolvable(scanDir);
  try {
    await execFileAsync(
      process.execPath,
      [cliBin, "-i", inputPath, "-o", outputPath, "--cwd", scanDir, "--minify"],
      { cwd: scanDir },
    );
    return await fs.readFile(outputPath, "utf8");
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr)
        : "";
    const message = stderr || (err instanceof Error ? err.message : String(err));
    throw new Error(`Tailwind v4 CSS build failed: ${message}`);
  } finally {
    await fs.rm(inputPath, { force: true });
    await fs.rm(outputPath, { force: true });
  }
}
