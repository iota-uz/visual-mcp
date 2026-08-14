/**
 * Which JWT issuers Convex will accept for `ctx.auth.getUserIdentity()`.
 *
 * Two are listed while the sign-in migration is in flight:
 *
 * 1. **Convex Auth** (./auth.ts) — this deployment issues and signs its own
 *    JWTs, so the issuer is the deployment's own site URL and the audience
 *    is the literal `"convex"`. This is the path new sign-ins take.
 * 2. **Google directly** — the previous design passed a raw Google ID token
 *    from the browser, verified against Google's JWKS with `aud` equal to
 *    our OAuth client id. Kept so tokens minted before the switch keep
 *    working until they expire (~1h), rather than logging everyone out the
 *    moment the backend deploys. Safe to delete a day after rollout.
 *
 * ../lib/auth.ts's `requireIotaIdentity` is what actually gates access; this
 * file only establishes that a token is genuine and unexpired.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
    {
      domain: "https://accounts.google.com",
      applicationID: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    },
  ],
};
