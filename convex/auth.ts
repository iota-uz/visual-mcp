/**
 * Convex Auth — the SPA's sign-in (replaces the raw Google ID token the
 * browser used to hold in localStorage).
 *
 * Why it changed: a Google ID token expires after one hour and Google
 * Identity Services hands out no refresh token with it, so there was nothing
 * to renew — the session simply died mid-session and dropped the user on the
 * sign-in wall. Convex Auth runs Google's OAuth *code* flow, keeps a
 * rotating refresh token, and re-mints its own 1h JWT silently behind it, so
 * the visible session lasts 30 days (`session.totalDurationMs` below).
 *
 * Trade-off, stated plainly because the old design deliberately took the
 * other side of it: the window in which a stolen browser token can
 * impersonate someone grows from ~1h to the refresh token's life, and
 * removing an account from the iota.uz Workspace now locks it out when its
 * session ends rather than within the hour. Shorten `totalDurationMs` if
 * that matters more than not being logged out mid-task.
 *
 * The org restriction moved with it. `hd` and `email_verified` are Google's
 * claims about the account, and they only reach us on the profile returned
 * by the OAuth exchange — so the check runs here, once, at sign-in, and
 * ../lib/auth.ts trusts any session that exists. `authorization.params.hd`
 * is only a hint to Google's account chooser; `createOrUpdateUser` is the
 * enforcement.
 */

import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { ALLOWED_HOSTED_DOMAIN, getOrCreateUserIdForProfile, UnauthorizedError } from "./lib/auth";
import { DevAuth, devAuthSecret } from "./lib/devAuth";

/** Shape of the claims we keep from Google's OIDC profile. */
interface GoogleOidcProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Sign-in without Google, present only where `DEV_AUTH_SECRET` is set —
 * which is the local backend `npm run dev:agent` creates, and nothing else.
 * Deliberately an environment variable rather than a build-time flag: this
 * project's live deployment IS the dev deployment, so anything keyed on
 * "dev" ships to production. See ./lib/devAuth.ts.
 */
export const devProviders = devAuthSecret() ? [DevAuth()] : [];

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ...devProviders,
    Google({
      authorization: { params: { hd: ALLOWED_HOSTED_DOMAIN, prompt: "select_account" } },
      // The stock Google provider maps the profile down to id/name/email/
      // image and drops `hd` and `email_verified` — the two claims the org
      // check is built on. Pass them through instead.
      profile(profile) {
        const p = profile as GoogleOidcProfile;
        return {
          id: p.sub,
          googleSub: p.sub,
          email: p.email,
          emailVerified: p.email_verified === true,
          name: p.name,
          pictureUrl: p.picture,
          hd: p.hd,
        };
      },
    }),
  ],
  session: {
    totalDurationMs: 30 * DAY_MS,
    inactiveDurationMs: 30 * DAY_MS,
  },
  callbacks: {
    /*
     * Owns the `users` row outright — when this callback is defined, Convex
     * Auth performs no writes to `users` of its own (see the library's
     * implementation/users.ts). That is exactly what makes the migration
     * lossless: existing rows are found by their `googleSub`, so every
     * workspace, canvas and MCP token keyed to a `users` id stays attached
     * to the same person instead of being orphaned behind a fresh row.
     */
    async createOrUpdateUser(ctx, { existingUserId, profile }) {
      const p = profile as unknown as {
        googleSub?: string;
        email?: string;
        emailVerified?: boolean;
        name?: string;
        pictureUrl?: string;
        hd?: string;
      };

      if (p.emailVerified !== true) {
        throw new UnauthorizedError("Google account email is not verified.");
      }
      if (p.hd !== ALLOWED_HOSTED_DOMAIN) {
        throw new UnauthorizedError(`Account is not a member of ${ALLOWED_HOSTED_DOMAIN}.`);
      }
      if (!p.email || !p.googleSub) {
        throw new UnauthorizedError("Google identity is missing an email or subject claim.");
      }

      if (existingUserId !== null) {
        await ctx.db.patch(existingUserId, { lastSeenAt: Date.now() });
        return existingUserId;
      }

      return await getOrCreateUserIdForProfile(ctx, {
        googleSub: p.googleSub,
        email: p.email,
        name: p.name,
        pictureUrl: p.pictureUrl,
      });
    },
  },
});
