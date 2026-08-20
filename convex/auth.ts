/** Convex Auth with Google OAuth restricted to the iota.uz Workspace. */

import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { ALLOWED_HOSTED_DOMAIN, UnauthorizedError } from "./lib/auth";
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
    async createOrUpdateUser(ctx, { existingUserId, profile }) {
      const p = profile as unknown as {
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
      if (!p.email) {
        throw new UnauthorizedError("Google identity is missing an email claim.");
      }

      if (existingUserId !== null) {
        await ctx.db.patch(existingUserId, { lastSeenAt: Date.now() });
        return existingUserId;
      }

      return await ctx.db.insert("users", {
        email: p.email,
        name: p.name ?? p.email,
        pictureUrl: p.pictureUrl,
        lastSeenAt: Date.now(),
      });
    },
  },
});
