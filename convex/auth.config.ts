/**
 * Native Convex JWT verification against Google directly (PLAN.md Part 1
 * section 7) — no `@convex-dev/auth` or other auth library. The SPA obtains
 * a Google ID token client-side (Google Identity Services) and passes it to
 * the Convex client via `ConvexProviderWithAuth`'s `fetchAccessToken`;
 * Convex verifies its signature against Google's own JWKS
 * (`https://accounts.google.com/.well-known/openid-configuration`) and
 * checks `aud` against `applicationID` below. `ctx.auth.getUserIdentity()`
 * then exposes the verified claims, including the non-standard `hd` claim —
 * see ./lib/auth.ts's `requireIotaIdentity` for the org-restriction check
 * that actually gates access; this file only establishes that a token is a
 * genuine, unexpired Google ID token for our OAuth client.
 */
export default {
  providers: [
    {
      domain: "https://accounts.google.com",
      applicationID: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    },
  ],
};
