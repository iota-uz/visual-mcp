/**
 * Wires Google Identity Services (via @react-oauth/google) into Convex's
 * `useAuth` contract (PLAN.md Part 1 section 7) — no @convex-dev/auth, no
 * server round-trip of our own: the ID token goes straight from Google to
 * the browser to Convex, which verifies it against Google's own JWKS
 * (../../convex/auth.config.ts).
 *
 * Refresh is intentionally simple, not silent: Google ID tokens live ~1h,
 * and @react-oauth/google exposes no clean imperative "refresh this token"
 * call. `fetchAccessToken` just returns the token currently held in memory.
 * When it expires, `ctx.auth.getUserIdentity()` starts returning null
 * server-side, Convex's `isAuthenticated` flips to false, and <AuthGate>
 * falls back to the sign-in button — a deliberate v1 tradeoff for an
 * internal tool with a handful of users, not an oversight.
 */

import { type CredentialResponse, GoogleLogin } from "@react-oauth/google";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

interface DecodedIdToken {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  hd?: string;
  exp: number;
}

function decodeIdToken(token: string): DecodedIdToken | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64)) as DecodedIdToken;
  } catch {
    return null;
  }
}

interface GoogleAuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  identity: DecodedIdToken | null;
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
  signIn: (response: CredentialResponse) => void;
  signOut: () => void;
}

const GoogleAuthContext = createContext<GoogleAuthState | null>(null);

export function GoogleAuthProvider({ children }: { children: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [identity, setIdentity] = useState<DecodedIdToken | null>(null);

  const signIn = useCallback((response: CredentialResponse) => {
    const token = response.credential ?? null;
    tokenRef.current = token;
    setIdentity(token ? decodeIdToken(token) : null);
  }, []);

  const signOut = useCallback(() => {
    tokenRef.current = null;
    setIdentity(null);
  }, []);

  const fetchAccessToken = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return null;
    const decoded = decodeIdToken(token);
    if (decoded && decoded.exp * 1000 <= Date.now()) {
      // Expired and we have no silent-refresh path — surface signed-out
      // rather than hand Convex a token it will reject anyway.
      tokenRef.current = null;
      setIdentity(null);
      return null;
    }
    return token;
  }, []);

  const value: GoogleAuthState = {
    isLoading: false,
    isAuthenticated: identity !== null,
    identity,
    fetchAccessToken,
    signIn,
    signOut,
  };

  return <GoogleAuthContext.Provider value={value}>{children}</GoogleAuthContext.Provider>;
}

export function useGoogleAuth(): GoogleAuthState {
  const ctx = useContext(GoogleAuthContext);
  if (!ctx) throw new Error("useGoogleAuth must be used inside <GoogleAuthProvider>");
  return ctx;
}

/** The hook shape `ConvexProviderWithAuth` expects. */
export function useConvexAuthFromGoogle() {
  const { isLoading, isAuthenticated, fetchAccessToken } = useGoogleAuth();
  return { isLoading, isAuthenticated, fetchAccessToken };
}

export function SignInButton() {
  const { signIn } = useGoogleAuth();
  return (
    <GoogleLogin
      onSuccess={signIn}
      onError={() => console.error("Google sign-in failed")}
      hosted_domain="iota.uz"
      useOneTap
    />
  );
}
