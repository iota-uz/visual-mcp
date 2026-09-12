import type { Id } from "../../../convex/_generated/dataModel.js";
import { verifiedMediaMetadata } from "../../../convex/lib/videoAssetMetadata.js";
import type { AgentContext } from "./gateway.js";
import {
  ASSET_MAX_BYTES,
  ASSET_MIME_TYPES,
  type AssetKind,
  assertSafeImportUrl,
  sniffAssetMime,
  validateAssetBytes,
} from "./lib/assetSecurity.js";
import { sha256HexBytes } from "./lib/hash.js";
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
  scope: "shared" | "workspace";
  workspaceSlug?: string;
  slug: string;
  revision: number;
}): string {
  return input.scope === "shared"
    ? `asset://shared/${input.slug}@${input.revision}`
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

/** Materializes a content-addressed object while its Convex lease is active. */
async function ensureObject(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const existing = await headObject(key);
  if (existing.status === 404) {
    await putObject(key, bytes, mimeType);
    return;
  }
  if (!existing.ok) throw new Error(`Unable to inspect object: HTTP ${existing.status}`);
}

export type PreparedAssetObject = {
  objectKey: string;
  contentHash: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  originalFilename: string;
  objectLeaseId: string;
  cleanupClaimId: string;
  mediaMetadata?: ReturnType<typeof verifiedMediaMetadata>;
};

/**
 * Validates media and materializes its immutable content-addressed object.
 * Database visibility is deliberately left to the caller so canvas_save can
 * create the workspace asset and its canvas binding in the same transaction.
 */
export async function prepareAssetObject(input: {
  ctx: AgentContext;
  filename: string;
  rawBytes: Uint8Array;
  declaredMime: string;
}): Promise<PreparedAssetObject> {
  if (input.rawBytes.byteLength === 0) throw new Error("Asset is empty");
  if (input.rawBytes.byteLength > ASSET_MAX_BYTES)
    throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
  const detectedMime = sniffAssetMime(input.rawBytes, input.declaredMime);
  const detectedKind = ASSET_MIME_TYPES[detectedMime as keyof typeof ASSET_MIME_TYPES];
  if (!detectedKind) throw new Error(`Unsupported asset MIME type: ${detectedMime}`);
  const validated =
    detectedKind === "audio"
      ? {
          bytes: input.rawBytes,
          mimeType: detectedMime,
          kind: detectedKind,
          contentHash: await sha256HexBytes(input.rawBytes),
        }
      : await validateAssetBytes(input.rawBytes, input.declaredMime);
  const objectKey = `blobs/sha256/${validated.contentHash.slice(0, 2)}/${validated.contentHash}`;
  const objectLeaseId = crypto.randomUUID();
  const cleanupClaimId = crypto.randomUUID();
  await input.ctx.runMutation(internal.assets.acquireObjectLease, {
    objectKey,
    leaseId: objectLeaseId,
  });
  let mediaMetadata: ReturnType<typeof verifiedMediaMetadata> | undefined;
  try {
    await ensureObject(objectKey, validated.bytes, validated.mimeType);
    if (validated.kind === "audio") {
      const verified = await callWorker<{
        sha256: string;
        sizeBytes: number;
        mimeType: string;
        kind: string;
        durationMs?: number;
        hasAudio?: boolean;
        audioStreams?: Array<{
          codec: string | null;
          channels: number | null;
          sampleRateHz: number | null;
        }>;
      }>(getWorkerConfig(), "/media/verify", {
        sourceUrl: await presignObject(objectKey, "GET", 900),
        declaredMimeType: validated.mimeType,
        maxBytes: validated.bytes.byteLength,
        expectedSize: validated.bytes.byteLength,
        expectedSha256: validated.contentHash,
      });
      if (
        verified.kind !== "audio" ||
        verified.mimeType !== validated.mimeType ||
        verified.sizeBytes !== validated.bytes.byteLength ||
        verified.sha256 !== validated.contentHash
      ) {
        throw new Error("Audio verification result does not match the uploaded bytes");
      }
      mediaMetadata = verifiedMediaMetadata(verified);
    }
  } catch (error) {
    await discardPreparedAssetObject(input.ctx, {
      objectKey,
      contentHash: validated.contentHash,
      mimeType: validated.mimeType,
      size: validated.bytes.byteLength,
      kind: validated.kind,
      originalFilename: input.filename,
      objectLeaseId,
      cleanupClaimId,
    }).catch(() => undefined);
    throw error;
  }
  return {
    objectKey,
    contentHash: validated.contentHash,
    mimeType: validated.mimeType,
    size: validated.bytes.byteLength,
    kind: validated.kind,
    originalFilename: input.filename,
    objectLeaseId,
    cleanupClaimId,
    mediaMetadata,
  };
}

/**
 * Atomically releases the preparation lease and claims deletion only when no
 * revision or other in-flight preparation retains the key. The durable claim
 * prevents an asset-version insert from racing the external delete.
 */
export async function discardPreparedAssetObject(
  ctx: AgentContext,
  prepared: PreparedAssetObject,
): Promise<void> {
  const claimed = await ctx.runMutation(internal.assets.claimObjectDeletion, {
    objectKey: prepared.objectKey,
    leaseId: prepared.objectLeaseId,
    claimId: prepared.cleanupClaimId,
  });
  if (!claimed) return;
  try {
    await deleteObject(prepared.objectKey);
  } finally {
    await ctx.runMutation(internal.assets.finishObjectDeletion, {
      objectKey: prepared.objectKey,
      claimId: prepared.cleanupClaimId,
    });
  }
}

export async function persistAsset(
  ctx: AgentContext,
  input: {
    uploadId?: Id<"assetUploads">;
    scope: "shared" | "workspace";
    createdBy: Id<"users">;
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
    ctx,
    filename: input.filename,
    rawBytes: input.rawBytes,
    declaredMime: input.declaredMime,
  });
  let committed: { assetId: Id<"assets">; versionId: Id<"assetVersions">; revision: number };
  try {
    committed = await ctx.runMutation(internal.assets.commitAssetVersion, {
      uploadId: input.uploadId,
      scope: input.scope,
      createdBy: input.createdBy,
      workspaceId: input.workspaceId,
      workspaceSlug: input.workspaceSlug,
      slug: input.slug,
      name: input.name,
      description: input.description,
      tags: input.tags,
      kind: prepared.kind,
      mediaMetadata: prepared.mediaMetadata,
      objectKey: prepared.objectKey,
      contentHash: prepared.contentHash,
      mimeType: prepared.mimeType,
      size: prepared.size,
      originalFilename: input.filename,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      objectLeaseId: prepared.objectLeaseId,
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
