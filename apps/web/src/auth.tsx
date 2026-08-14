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
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";

/*
 * A rejected sign-in is silent on the wire, so we have to remember that one
 * was in flight. When `createOrUpdateUser` throws — the outsider-account
 * case — Convex Auth's callback logs the error server-side and redirects
 * back here with no `code` and no error param (see the library's
 * server/implementation/index.ts: `catch { logError; Response.redirect }`).
 * Without this marker the user bounces off Google straight back onto the
 * sign-in wall with nothing said, which is strictly worse than the
 * client-side "not an @iota.uz account" message this auth model removed.
 */
const SIGNIN_ATTEMPT_KEY = "visual-canvas:signin-attempt";

// Covers both ways to arrive back here without a session: the org rejection
// and simply abandoning Google's account chooser. It must not assert which.
const BOUNCED_MESSAGE =
  "Sign-in didn't complete. Only @iota.uz Google accounts can sign in — if you " +
  "picked a different account, that's why.";

function forgetSignInAttempt() {
  // Safari's "block all cookies" makes even sessionStorage throw.
  try {
    window.sessionStorage.removeItem(SIGNIN_ATTEMPT_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** Called once a session exists, so a later sign-out lands on a clean wall. */
export function clearSignInAttempt() {
  forgetSignInAttempt();
}

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

  // This component only mounts when the session settled as signed-out (see
  // AuthGate), so a marker still standing here means the round trip failed.
  useEffect(() => {
    let pending = false;
    try {
      pending = window.sessionStorage.getItem(SIGNIN_ATTEMPT_KEY) !== null;
    } catch {
      /* storage unavailable — nothing was recorded either */
    }
    if (pending) {
      forgetSignInAttempt();
      setError(BOUNCED_MESSAGE);
    }
  }, []);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      window.sessionStorage.setItem(SIGNIN_ATTEMPT_KEY, "1");
    } catch {
      /* the redirect still works; only the failure message is lost */
    }
    try {
      // Full-page redirect to Google and back — no popup to be blocked, and
      // no One Tap prompt that Google can silently put on cooldown.
      await signIn("google");
    } catch (err: unknown) {
      // Reached only if the *local* call fails (offline, deployment down);
      // the org rejection happens after the redirect and lands in the effect
      // above instead.
      forgetSignInAttempt();
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
