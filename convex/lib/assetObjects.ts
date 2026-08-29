import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Pins an asset-version write to an active preparation lease and rejects it
 * while cleanup owns the object key. Reading the claim index also makes a
 * concurrent claim conflict with the caller's transaction.
 */
export async function requireAssetObjectLease(
  ctx: MutationCtx,
  objectKey: string,
  leaseId?: string,
): Promise<Doc<"assetObjectLeases"> | null> {
  const claim = await ctx.db
    .query("assetObjectDeletionClaims")
    .withIndex("by_objectKey", (q) => q.eq("objectKey", objectKey))
    .unique();
  if (claim) throw new Error("Asset object cleanup is in progress; retry the save");
  if (!leaseId) return null;
  const lease = await ctx.db
    .query("assetObjectLeases")
    .withIndex("by_leaseId", (q) => q.eq("leaseId", leaseId))
    .unique();
  if (!lease || lease.objectKey !== objectKey) throw new Error("Asset object lease is unavailable");
  return lease;
}
