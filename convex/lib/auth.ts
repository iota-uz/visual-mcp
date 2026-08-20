/** Convex Auth session helpers for the SPA. */

import type { GenericQueryCtx, UserIdentity } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";

export const ALLOWED_HOSTED_DOMAIN = "iota.uz";

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function convexAuthUserIdFromSubject(subject: string): string | null {
  const [userId, sessionId] = subject.split("|");
  return userId && sessionId ? userId : null;
}

export async function requireIotaIdentity(
  ctx: GenericQueryCtx<DataModel> | { auth: GenericQueryCtx<DataModel>["auth"] },
): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new UnauthorizedError("Not signed in.");
  }
  if (convexAuthUserIdFromSubject(identity.subject) === null)
    throw new UnauthorizedError("Invalid Convex Auth session.");
  return identity;
}

/**
 * Read-only identity → `users` row, or null when the row does not exist yet.
 * Queries use this; they cannot create the row themselves.
 */
export async function resolveUserId(
  ctx: { db: GenericQueryCtx<DataModel>["db"] },
  identity: UserIdentity,
): Promise<Id<"users"> | null> {
  const authUserId = convexAuthUserIdFromSubject(identity.subject);
  if (authUserId === null) return null;
  return ctx.db.normalizeId("users", authUserId);
}

export async function requireUserId(
  ctx: { db: GenericQueryCtx<DataModel>["db"] },
  identity: UserIdentity,
): Promise<Id<"users">> {
  const userId = await resolveUserId(ctx, identity);
  if (!userId || !(await ctx.db.get(userId)))
    throw new UnauthorizedError("Session user not found.");
  return userId;
}
