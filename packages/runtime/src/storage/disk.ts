/**
 * `DiskCanvasStorage` — the dev/test `CanvasStorage` implementation.
 *
 * Backs every canvas's files under a single root directory:
 *
 *   <rootDir>/<canvasId>/<relPath>
 *   <rootDir>/<canvasId>/<relPath>.meta.json   — { mimeType, size }
 *
 * `storageId` is not an in-memory handle — it's `base64url(JSON.stringify([
 * canvasId, relPath]))` — so `downloadUrl` can resolve it back to a file
 * without a lookup table, and ids stay valid across process restarts, the
 * same as a real object store's ids would.
 *
 * `downloadUrl` returns a `data:` URL (base64-encoded bytes inline), not an
 * `http(s)://` one — there is no server here to point a URL at. `fetch()` on
 * a `data:` URL works fine in Node (verified against v22.14.0), which is
 * what {@link hydrate} in `./workspace.js` uses to pull files down, so this
 * is a faithful stand-in for "a URL that returns the object's bytes" in
 * tests. It does **not** scale to large files the way a real presigned URL
 * would — fine for dev/test fixtures, not a production concern since this
 * class is never the production implementation.
 *
 * `uploadUrl` deliberately does not implement Convex's real upload protocol
 * (POST bytes to a generated URL, get a `storageId` back) — see the
 * interface doc comment. It returns an opaque, unusable placeholder;
 * callers against this implementation write via `putFile` instead.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { normalizeCanvasPath } from "../paths/index.js";
import type { CanvasStorage, StoredObject } from "./types.js";
import { CanvasStorageNotFoundError } from "./types.js";

interface ObjectMeta {
  mimeType: string;
  size: number;
}

/**
 * Same shape as `sandbox/workspace.ts`'s session-id pattern, for the same
 * reason: `canvasId` gets `path.join`ed onto `rootDir` below, so — unlike
 * `relPath`, which `normalizeCanvasPath` already guards — it must be
 * rejected outright if it contains `..` or a path separator, not merely
 * confined after the fact.
 */
const CANVAS_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class DiskCanvasStorage implements CanvasStorage {
  constructor(private readonly rootDir: string) {}

  private canvasDir(canvasId: string): string {
    if (!CANVAS_ID_PATTERN.test(canvasId)) {
      throw new Error(
        `Invalid canvasId: ${JSON.stringify(canvasId)} (must match ${CANVAS_ID_PATTERN})`,
      );
    }
    return path.join(this.rootDir, canvasId);
  }

  private resolve(canvasId: string, relPath: string): { absPath: string; relPath: string } {
    const normalized = normalizeCanvasPath(relPath, "read", "relPath");
    return {
      absPath: path.join(this.canvasDir(canvasId), normalized.relPath),
      relPath: normalized.relPath,
    };
  }

  private encodeStorageId(canvasId: string, relPath: string): string {
    return Buffer.from(JSON.stringify([canvasId, relPath]), "utf8").toString("base64url");
  }

  private decodeStorageId(storageId: string): { canvasId: string; relPath: string } {
    try {
      const [canvasId, relPath] = JSON.parse(
        Buffer.from(storageId, "base64url").toString("utf8"),
      ) as [string, string];
      if (typeof canvasId !== "string" || typeof relPath !== "string") throw new Error("shape");
      return { canvasId, relPath };
    } catch {
      throw new CanvasStorageNotFoundError(`Unrecognized storageId: ${storageId}`);
    }
  }

  async putFile(
    canvasId: string,
    relPath: string,
    body: Buffer | Uint8Array,
    mimeType: string,
  ): Promise<StoredObject> {
    const { absPath, relPath: normalizedRelPath } = this.resolve(canvasId, relPath);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buf);
    const meta: ObjectMeta = { mimeType, size: buf.byteLength };
    await fs.writeFile(`${absPath}.meta.json`, JSON.stringify(meta), "utf8");
    return {
      storageId: this.encodeStorageId(canvasId, normalizedRelPath),
      relPath: normalizedRelPath,
      size: buf.byteLength,
    };
  }

  async getFile(canvasId: string, relPath: string): Promise<Readable> {
    const { absPath } = this.resolve(canvasId, relPath);
    try {
      const buf = await fs.readFile(absPath);
      return Readable.from(buf);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CanvasStorageNotFoundError(
          `No object at "${relPath}" for canvas "${canvasId}"`,
        );
      }
      throw err;
    }
  }

  async deleteCanvas(canvasId: string): Promise<void> {
    await fs.rm(this.canvasDir(canvasId), { recursive: true, force: true });
  }

  async downloadUrl(storageId: string): Promise<string> {
    const { canvasId, relPath } = this.decodeStorageId(storageId);
    let absPath: string;
    try {
      ({ absPath } = this.resolve(canvasId, relPath));
    } catch {
      // A crafted/malformed storageId decodes to a canvasId or relPath that
      // fails validation. Report it the same as an unknown storageId rather
      // than leaking which check tripped.
      throw new CanvasStorageNotFoundError(`Unrecognized storageId: ${storageId}`);
    }
    let buf: Buffer;
    let meta: ObjectMeta;
    try {
      buf = await fs.readFile(absPath);
      meta = JSON.parse(await fs.readFile(`${absPath}.meta.json`, "utf8")) as ObjectMeta;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CanvasStorageNotFoundError(`Unknown storageId: ${storageId}`);
      }
      throw err;
    }
    return `data:${meta.mimeType};base64,${buf.toString("base64")}`;
  }

  async uploadUrl(): Promise<string> {
    // Not a real, POST-able upload endpoint — see module doc. Unique per
    // call so tests can at least assert callers don't cache/reuse it.
    return `disk-upload://unsupported/${randomUUID()}`;
  }
}
