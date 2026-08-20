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
});
