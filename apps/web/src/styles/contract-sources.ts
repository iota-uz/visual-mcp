/*
 * Shared by the two stylesheet contract tests (tokens.test.ts,
 * class-contract.test.ts), both of which have to read every source file in
 * apps/web rather than a hand-listed few — a hand-listed few is exactly how
 * a new stylesheet slips past a contract.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SourceFile {
  /** Path relative to the root passed in, for legible failure messages. */
  path: string;
  text: string;
}

/** Every file under `dir` whose path matches `pattern`, read eagerly. */
export function sourceFiles(dir: string, pattern: RegExp): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((entry) => pattern.test(entry))
    .map((entry) => ({ path: entry, text: readFileSync(join(dir, entry), "utf8") }));
}
