/**
 * A fake `@convex-dev/auth/react` for fixture mode — see ./convexReact.ts.
 * Fixtures render the signed-in app, so the provider is a passthrough and
 * the session always exists.
 */

import type { ReactNode } from "react";

export function ConvexAuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useAuthActions() {
  return {
    signIn: async () => {
      console.info("[fixtures] signIn ignored — fixture mode is always signed in.");
    },
    signOut: async () => {
      console.info("[fixtures] signOut ignored — fixture mode is always signed in.");
    },
  };
}
