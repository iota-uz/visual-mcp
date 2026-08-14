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

/*
 * Google's "G" mark, inline. The old sign-in rendered `@react-oauth/google`'s
 * <GoogleLogin> widget, which was really Google Identity Services drawing
 * its own branded button into an iframe — that script is gone with the ID
 * token flow, and nothing ships a drop-in button for a plain server-side
 * redirect. Google's branding guidelines expect the mark and the exact
 * words "Sign in with Google", so the button below reproduces them rather
 * than inventing a house-style one.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
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
      <button type="button" className="btn btn-google" onClick={handleSignIn} disabled={busy}>
        <GoogleMark />
        {/* The label stays put while the redirect is in flight: Google's
            guidelines allow no other wording, and swapping it for
            "Opening Google…" also made the button change width mid-click. */}
        Sign in with Google
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
