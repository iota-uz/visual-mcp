/**
 * `CanvasStorage` — the storage abstraction PLAN.md section 5 calls for.
 *
 * Two implementations will exist: a Convex-backed one (production, added in
 * A1) and `DiskCanvasStorage` (this package, dev/test). Both sit behind this
 * interface so `packages/runtime` and its tests never depend on Convex.
 *
 * `relPath` is always workspace-relative POSIX, no leading slash
 * (`"output/report.pdf"`, not `"/output/report.pdf"`) — the same convention
 * `normalizeCanvasPath` in `../paths/index.js` produces. Every method routes
 * its `relPath` through that normalizer for traversal-safety before touching
 * storage; `mode: "read"` is used (any top-level directory), because canvas
 * storage holds a whole canvas's files, not a sandboxed session's writes.
 *
 * `downloadUrl`/`uploadUrl` deliberately take **no `ttlSec` parameter**,
 * even though PLAN.md section 5's sketch had one. Convex's real primitives —
 * `ctx.storage.getUrl` (no expiry at all; the URL is a stable pointer to the
 * stored object) and `ctx.storage.generateUploadUrl` (fixed ~1h expiry, not
 * caller-configurable) — don't support a caller-chosen TTL, so an interface
 * that accepted one would let a caller pass a value the production
 * implementation silently ignores. Dropping the parameter makes the
 * interface honest about what every implementation can actually promise.
 */

import type { Readable } from "node:stream";

/** Result of a successful `putFile`. */
export interface StoredObject {
  /** Opaque id this storage backend uses to address the object later (`downloadUrl`). */
  storageId: string;
  /** The `relPath` that was stored, normalized (see module header). */
  relPath: string;
  size: number;
}

/** Thrown by `getFile` (and `downloadUrl`, where applicable) when no object exists. */
export class CanvasStorageNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasStorageNotFoundError";
  }
}

export interface CanvasStorage {
  /** Stores `body` at `relPath` under `canvasId`, overwriting any existing object there. */
  putFile(
    canvasId: string,
    relPath: string,
    body: Buffer | Uint8Array,
    mimeType: string,
  ): Promise<StoredObject>;

  /** @throws {CanvasStorageNotFoundError} if nothing is stored at `relPath` under `canvasId`. */
  getFile(canvasId: string, relPath: string): Promise<Readable>;

  /** Deletes every object stored under `canvasId`. Not an error if none exist. */
  deleteCanvas(canvasId: string): Promise<void>;

  /**
   * A URL that, when fetched, returns the object's bytes. Used by
   * {@link hydrate} to pull a canvas's files into a worker's temp workspace.
   *
   * @throws {CanvasStorageNotFoundError} if `storageId` is unknown.
   */
  downloadUrl(storageId: string): Promise<string>;

  /**
   * A URL a caller can upload bytes to out-of-band, per the backend's own
   * upload protocol. `DiskCanvasStorage` does not implement this protocol
   * (see its module doc) — callers in this codebase use `putFile` directly
   * instead; `uploadUrl` exists on the interface for the Convex
   * implementation, whose worker-facing callers are added in A1.
   */
  uploadUrl(): Promise<string>;
}
