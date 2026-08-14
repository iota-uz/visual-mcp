/**
 * Sign-in for the SPA, on top of Convex Auth (../../convex/auth.ts).
 *
 * What this replaced and why: the browser used to hold a raw Google ID token
 * in localStorage and hand it to Convex on every request. Those tokens last
 * one hour, Google Identity Services issues no refresh token beside them,
 * and `@react-oauth/google` exposes no imperative renew — so a session
 * simply died mid-use and dropped the user back on the sign-in wall. Convex
 * Auth runs Google's OAuth code flow, holds a rotating refresh token, and
 * re-mints its access token silently, so the session survives for 30 days.
 *
 * The org check (`hd === "iota.uz"`) now runs server-side at sign-in rather
 * than on every request, which is why there is no client-side domain
 * inspection left in this file: a session that exists has already passed it,
 * and a Google account outside the org never gets one.
 */

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { LogIn } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";

/** The signed-in person, or null/undefined while unknown. */
export function useSessionUser() {
  return useQuery(api.users.getCurrentUser, {});
}

export function useSignOut() {
  const { signOut } = useAuthActions();
  return signOut;
}

export function SignInButton() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      // Full-page redirect to Google and back — no popup to be blocked, and
      // no One Tap prompt that Google can silently put on cooldown.
      await signIn("google");
    } catch (err: unknown) {
      // The most likely failure is the deliberate one: an account outside
      // iota.uz, rejected by `createOrUpdateUser` after the OAuth exchange.
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={handleSignIn} disabled={busy}>
        <LogIn size={16} aria-hidden="true" />
        {busy ? "Opening Google…" : "Sign in with Google"}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
