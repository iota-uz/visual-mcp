/**
 * A fake `convex/react`, swapped in by vite.config.ts when VITE_FIXTURES=1.
 *
 * Why an alias rather than a branch inside the app: the route files stay
 * untouched, and none of this reaches a normal build — there is no
 * `if (fixtures)` for anyone to trip over later, and no fixture data in the
 * production bundle.
 *
 * What it buys over the seeded local stack: states the seed cannot produce.
 * A query that never resolves (every skeleton on screen at once), a query
 * that throws (the per-route ErrorBoundary), and an account with nothing in
 * it. Pick one with `?fixture=full|empty|loading|error`.
 */

import { getFunctionName } from "convex/server";
import { fixtureFor, type Scenario } from "./data";

const SCENARIOS: Scenario[] = ["full", "empty", "loading", "error"];

/*
 * The two queries the shell itself runs, kept working under ?fixture=error.
 * They sit above every route boundary, so failing them shows one thing —
 * the top-level boundary — and hides the per-route ones, which are what
 * there is to look at. (That the sidebar's own query can take the whole
 * shell down is true of the real app too, and is its own question.)
 */
const SHELL_QUERIES = new Set(["users:getCurrentUser", "workspaces:listMine"]);

function scenario(): Scenario {
  const value = new URLSearchParams(window.location.search).get("fixture");
  return SCENARIOS.includes(value as Scenario) ? (value as Scenario) : "full";
}

/** Stands in for `ConvexReactClient` so main.tsx can still construct one. */
export class ConvexReactClient {
  constructor(public address: string) {}
  setAuth() {}
  clearAuth() {}
  close() {
    return Promise.resolve();
  }
}

export function useQuery(reference: unknown, args?: unknown): unknown {
  // "skip" is how the app expresses a query it isn't ready to run; Convex
  // returns undefined for it, and so must this or dependent queries look
  // like they resolved to nothing.
  if (args === "skip") return undefined;

  const current = scenario();
  // `undefined` is Convex's "still loading", which is exactly the state the
  // loading scenario wants — permanently.
  if (current === "loading") return undefined;

  const name = getFunctionName(reference as never);
  if (current === "error" && !SHELL_QUERIES.has(name)) {
    throw new Error(
      "Fixture backend: this query is configured to fail (?fixture=error). " +
        "The boundary you are looking at is the app's, not a real outage.",
    );
  }
  return fixtureFor(name, current);
}

export function useMutation(reference: unknown) {
  const name = getFunctionName(reference as never);
  return async (args: unknown) => {
    // Logged rather than applied: fixtures are a viewing mode, and a
    // half-applied write would make the next render disagree with the
    // scenario the URL asked for.
    console.info("[fixtures] mutation ignored:", name, args);
    return null;
  };
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true };
}

/*
 * Fixtures have no socket, so the connection banner must never appear in
 * them: `useConnectionStatus` treats a missing `connectionState` as
 * connected, and this returns a client without one.
 */
export function useConvex() {
  return null;
}
