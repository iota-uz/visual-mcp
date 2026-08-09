import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { findTailwindStyleBlock } from "@visual-canvas/runtime/render/playwright-renderer/html.js";
import { buildTailwindCss } from "@visual-canvas/runtime/render/playwright-renderer/tailwind.js";
import type { CompileCssRequest } from "./schemas.js";

export interface CompileCssResult {
  css: string;
}

/**
 * Compiles Tailwind utilities for a CanvasDoc's node HTML (PLAN.md section
 * 2) — there's no single entrypoint file here for renderFile's own inline
 * Tailwind step to run against, so this concatenates every node's HTML into
 * one scan directory and builds one stylesheet covering all of them.
 */
export async function handleCompileCss(req: CompileCssRequest): Promise<CompileCssResult> {
  if (req.htmlFragments.length === 0) return { css: "" };

  const scanDir = await mkdtemp(path.join(os.tmpdir(), "vc-css-"));
  try {
    // One file with every fragment's markup, so the Tailwind CLI's
    // content-detection (scanning scanDir for utility-class usage) sees
    // every node in a single pass.
    await writeFile(path.join(scanDir, "nodes.html"), req.htmlFragments.join("\n"), "utf8");

    // A node that declared its own `<style>@import "tailwindcss"; @theme
    // {...}</style>` block (PLAN.md section 2) supplies the entry CSS —
    // first one found wins, since @theme customizations are meant to be
    // shared across a doc's nodes, not per-node. No such block just means
    // the bare import, which still resolves the full utility set.
    let entryCss = '@import "tailwindcss";';
    for (const fragment of req.htmlFragments) {
      const block = findTailwindStyleBlock(fragment);
      if (block) {
        entryCss = block.rawCss;
        break;
      }
    }

    return { css: await buildTailwindCss(entryCss, scanDir) };
  } finally {
    await rm(scanDir, { recursive: true, force: true });
  }
}
