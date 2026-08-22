import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("signed-in shell scroll contract", () => {
  it("keeps the document fixed while content and sidebar own bounded scrolling", async () => {
    const styles = join(process.cwd(), "src/styles");
    const [reset, shell, sidebar] = await Promise.all([
      readFile(join(styles, "reset.css"), "utf8"),
      readFile(join(styles, "surfaces/app-shell.css"), "utf8"),
      readFile(join(styles, "surfaces/sidebar.css"), "utf8"),
    ]);
    expect(reset).toMatch(/html,\s*body,\s*#root[\s\S]*height:\s*100%[\s\S]*overflow:\s*hidden/);
    expect(shell).toMatch(/\.app-shell[\s\S]*height:\s*100dvh[\s\S]*min-height:\s*0/);
    expect(shell).toMatch(/\.app-content[\s\S]*min-height:\s*0[\s\S]*overflow-y:\s*auto/);
    expect(sidebar).toMatch(/\.app-sidebar[\s\S]*min-height:\s*0[\s\S]*overflow-y:\s*auto/);
  });

  /*
   * The narrow-width rules collapse the rail to icons with a caption under
   * each. The canvas navigation drawer reuses the same markup inside a
   * ~300px panel, where that collapse produced a column of unlabelled
   * glyphs in a screen of white with the workspace list switched off — so
   * every rule in the block has to exclude the drawer.
   */
  it("collapses only the docked rail, never the canvas navigation drawer", async () => {
    const sidebar = await readFile(join(process.cwd(), "src/styles/surfaces/sidebar.css"), "utf8");
    const narrow = sidebar.slice(sidebar.indexOf("@media (max-width: 640px)"));
    expect(narrow).not.toBe("");
    for (const selector of narrow.matchAll(/^\s{2}(\.app-sidebar[^{,]*)[,{]/gm)) {
      expect(selector[1]).toContain(":not(.app-sidebar-canvas-drawer)");
    }
  });

  /*
   * `isOverlayRail()` decides at click time whether the Pages rail is a
   * column beside the canvas or a card on top of it, and it does that by
   * asking matchMedia the same question the stylesheet asks. Nothing kept
   * the two strings in step — the comment above the function conceded as
   * much — and they now carry a media feature each, not just a width.
   */
  it("asks matchMedia exactly what the stylesheet asks", async () => {
    const [css, route] = await Promise.all([
      readFile(join(process.cwd(), "src/styles/surfaces/canvas.css"), "utf8"),
      readFile(join(process.cwd(), "src/routes/Canvas.tsx"), "utf8"),
    ]);
    // The rule that stops the panels insetting the canvas and lets them
    // overlay it instead — the whole of what "overlay mode" means.
    const overlay = css.indexOf(".canvas-comments-panel ~ .vc-viewport-host,");
    expect(overlay).toBeGreaterThan(-1);
    const opener = css.lastIndexOf("@media ", overlay);
    expect(opener).toBeGreaterThan(-1);
    const condition = css.slice(opener + "@media ".length, css.indexOf("{", opener)).trim();
    expect(condition).toMatch(/pointer: coarse/);
    expect(route).toContain(`const OVERLAY_PANELS_QUERY = "${condition}"`);
  });
});
