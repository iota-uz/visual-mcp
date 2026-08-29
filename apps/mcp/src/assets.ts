import type { Id } from "../../../convex/_generated/dataModel.js";
import type { ActionCtx } from "../../../convex/_generated/server.js";
import {
  ASSET_MAX_BYTES,
  type AssetKind,
  assertSafeImportUrl,
  validateAssetBytes,
} from "./lib/assetSecurity.js";
import {
  deleteObject,
  getObject,
  headObject,
  presignObject,
  putObject,
} from "./lib/objectStore.js";
import { callWorker, getWorkerConfig } from "./lib/worker.js";
import { internal } from "./refs.js";

function assetRef(input: {
  scope: "personal" | "workspace";
  workspaceSlug?: string;
  slug: string;
  revision: number;
}): string {
  return input.scope === "personal"
    ? `asset://personal/${input.slug}@${input.revision}`
    : `asset://workspace/${input.workspaceSlug}/${input.slug}@${input.revision}`;
}

export async function fetchAssetImport(raw: string) {
  const url = assertSafeImportUrl(raw).toString();
  const stagingKey = `staging/import/${crypto.randomUUID()}`;
  try {
    const imported = await callWorker<{ finalUrl: string; mimeType: string; size: number }>(
      getWorkerConfig(),
      "/asset-import",
      {
        url,
        maxBytes: ASSET_MAX_BYTES,
        upload: { putUrl: await presignObject(stagingKey, "PUT", 900) },
      },
    );
    if (imported.size > ASSET_MAX_BYTES) throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
    const response = await getObject(stagingKey);
    if (!response.ok) throw new Error(`Imported object is unavailable: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== imported.size)
      throw new Error("Imported asset size does not match worker result");
    return { bytes, mimeType: imported.mimeType, finalUrl: imported.finalUrl };
  } finally {
    await deleteObject(stagingKey).catch(() => undefined);
  }
}

/** Materializes a content-addressed object and reports whether this call created it. */
async function ensureObject(key: string, bytes: Uint8Array, mimeType: string): Promise<boolean> {
  const existing = await headObject(key);
  if (existing.status === 404) {
    await putObject(key, bytes, mimeType);
    return true;
  }
  if (!existing.ok) throw new Error(`Unable to inspect object: HTTP ${existing.status}`);
  return false;
}

export type PreparedAssetObject = {
  objectKey: string;
  contentHash: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  originalFilename: string;
  createdObject: boolean;
};

/**
 * Validates media and materializes its immutable content-addressed object.
 * Database visibility is deliberately left to the caller so canvas_save can
 * create the workspace asset and its canvas binding in the same transaction.
 */
export async function prepareAssetObject(input: {
  filename: string;
  rawBytes: Uint8Array;
  declaredMime: string;
}): Promise<PreparedAssetObject> {
  const validated = await validateAssetBytes(input.rawBytes, input.declaredMime);
  const objectKey = `blobs/sha256/${validated.contentHash.slice(0, 2)}/${validated.contentHash}`;
  const createdObject = await ensureObject(objectKey, validated.bytes, validated.mimeType);
  return {
    objectKey,
    contentHash: validated.contentHash,
    mimeType: validated.mimeType,
    size: validated.bytes.byteLength,
    kind: validated.kind,
    originalFilename: input.filename,
    createdObject,
  };
}

/**
 * Removes an object created during preparation only when no immutable asset
 * revision references it. Pre-existing content-addressed objects are never
 * candidates for failed-save cleanup.
 */
export async function discardPreparedAssetObject(
  ctx: ActionCtx,
  prepared: PreparedAssetObject,
): Promise<void> {
  if (!prepared.createdObject) return;
  const referenced = await ctx.runQuery(internal.assets.objectKeyReferenced, {
    objectKey: prepared.objectKey,
  });
  if (!referenced) await deleteObject(prepared.objectKey);
}

export async function persistAsset(
  ctx: ActionCtx,
  input: {
    uploadId?: Id<"assetUploads">;
    scope: "personal" | "workspace";
    ownerUserId: Id<"users">;
    workspaceId?: Id<"workspaces">;
    workspaceSlug?: string;
    slug: string;
    name: string;
    description?: string;
    tags: string[];
    filename: string;
    rawBytes: Uint8Array;
    declaredMime: string;
    sourceType: "upload" | "url" | "canvas-import";
    sourceUrl?: string;
  },
) {
  const prepared = await prepareAssetObject({
    filename: input.filename,
    rawBytes: input.rawBytes,
    declaredMime: input.declaredMime,
  });
  let committed: { assetId: Id<"assets">; versionId: Id<"assetVersions">; revision: number };
  try {
    committed = await ctx.runMutation(internal.assets.commitAssetVersion, {
      uploadId: input.uploadId,
      scope: input.scope,
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      workspaceSlug: input.workspaceSlug,
      slug: input.slug,
      name: input.name,
      description: input.description,
      tags: input.tags,
      kind: prepared.kind,
      objectKey: prepared.objectKey,
      contentHash: prepared.contentHash,
      mimeType: prepared.mimeType,
      size: prepared.size,
      originalFilename: input.filename,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
    });
  } catch (error) {
    await discardPreparedAssetObject(ctx, prepared).catch(() => undefined);
    throw error;
  }
  return {
    ...committed,
    assetRef: assetRef({
      scope: input.scope,
      workspaceSlug: input.workspaceSlug,
      slug: input.slug,
      revision: committed.revision,
    }),
    mimeType: prepared.mimeType,
    size: prepared.size,
    contentHash: prepared.contentHash,
  };
}
