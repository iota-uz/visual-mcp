/**
 * Validation failures, said out loud.
 *
 * A CanvasNode is a union of three shapes, so zod reports a node it cannot
 * parse as one `invalid_union` issue at `nodes.<index>` whose own message is
 * the literal string "Invalid input". Every branch's real complaint —
 * "Expected 'iphone-safari' | 'desktop-safari', received 'iphone'" — sits one
 * level down in `unionErrors`, unread. An MCP caller then sees
 * `nodes.10: Invalid input` for a wrong preset, a wrong viewport and a typo
 * alike, which is indistinguishable from "this field does not exist" and
 * turns a one-call fix into a guessing game.
 *
 * This walks the union, picks the branch the author plainly meant, and names
 * entities by id rather than by array index.
 */

interface RawIssue {
  code?: string;
  message: string;
  path?: PropertyKey[];
  /** zod 3 nests union branches here… */
  unionErrors?: { issues: RawIssue[] }[];
  /** …zod 4 here. Both shapes are in this repo. */
  errors?: RawIssue[][];
}

export interface DescribeIssuesOptions {
  /**
   * The value that failed. Used only to read entity ids, so a path reads
   * `nodes.10 (calc-mobile-app)` instead of leaving the caller to count.
   */
  value?: unknown;
  /** How many issues to list before summarising the rest. */
  limit?: number;
}

const DEFAULT_LIMIT = 8;

/** True for the "this is not that branch" issue a union always produces. */
function rejectsDiscriminant(issue: RawIssue): boolean {
  const last = issue.path?.[issue.path.length - 1];
  if (last !== "kind" && last !== "op" && last !== "type") return false;
  return (
    issue.code === "invalid_literal" ||
    issue.code === "invalid_enum_value" ||
    issue.code === "invalid_value" ||
    issue.code === "invalid_type"
  );
}

function branchesOf(issue: RawIssue): RawIssue[][] {
  if (Array.isArray(issue.unionErrors)) return issue.unionErrors.map((error) => error.issues);
  if (Array.isArray(issue.errors)) return issue.errors;
  return [];
}

/**
 * The branch worth reporting: the one whose discriminant matched. Failing
 * that — an untagged union, or a value that matches nothing — the branch
 * that came closest, which is the one with the fewest complaints.
 */
function intendedBranch(branches: RawIssue[][]): RawIssue[] {
  const matched = branches.filter((issues) => !issues.some(rejectsDiscriminant));
  const pool = matched.length > 0 ? matched : branches;
  return pool.reduce((best, current) => (current.length < best.length ? current : best));
}

function entityAt(value: unknown, path: PropertyKey[]): unknown {
  let cursor = value;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<PropertyKey, unknown>)[segment];
  }
  return cursor;
}

function labelPath(path: PropertyKey[], value: unknown): string {
  return path
    .map((segment, index) => {
      if (typeof segment !== "number") return String(segment);
      const entity = entityAt(value, path.slice(0, index + 1));
      const id = entity && typeof entity === "object" ? (entity as { id?: unknown }).id : undefined;
      return typeof id === "string" ? `${segment} (${id})` : String(segment);
    })
    .join(".");
}

/**
 * zod 3 gives a union branch's issues the *absolute* path they failed at,
 * zod 4 gives them one relative to the union. Both are in this repo, so a
 * child path that already carries the prefix is left alone rather than
 * getting `nodes.0.nodes.0`.
 */
function joinPath(prefix: PropertyKey[], child: PropertyKey[]): PropertyKey[] {
  const carriesPrefix =
    child.length >= prefix.length && prefix.every((segment, index) => child[index] === segment);
  return carriesPrefix ? [...child] : [...prefix, ...child];
}

function flatten(issues: RawIssue[], base: PropertyKey[], value: unknown, out: string[]): void {
  for (const issue of issues) {
    const path = joinPath(base, issue.path ?? []);
    const branches = branchesOf(issue);
    if (branches.length > 0) {
      flatten(intendedBranch(branches), path, value, out);
      continue;
    }
    const label = path.length > 0 ? labelPath(path, value) : null;
    out.push(label ? `${label}: ${issue.message}` : issue.message);
  }
}

/**
 * Turns a ZodError (or anything else carrying `issues`) into one line per
 * real problem. Returns null for a value that is not a validation error, so
 * callers can fall through to their own formatting.
 */
export function describeIssues(error: unknown, options: DescribeIssuesOptions = {}): string | null {
  if (!error || typeof error !== "object") return null;
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;
  const messages: string[] = [];
  flatten(issues as RawIssue[], [], options.value, messages);
  const unique = [...new Set(messages)];
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (unique.length <= limit) return unique.join("; ");
  return `${unique.slice(0, limit).join("; ")} (+${unique.length - limit} more)`;
}
