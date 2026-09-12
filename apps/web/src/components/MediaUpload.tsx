import { sha256 } from "@noble/hashes/sha2.js";
import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatBytes } from "../lib/formatBytes";
import { Button } from "./ui/Button";

/** Keeps the input working set at 1 MiB, never file.arrayBuffer() for a large asset. */
export async function hashUpload(
  file: Blob,
  progress: (fraction: number) => void,
  signal?: AbortSignal,
) {
  const digest = sha256.create();
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    if (signal?.aborted) throw new Error("Hashing cancelled");
    digest.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
    progress(Math.min(1, (offset + chunkSize) / file.size));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return [...digest.digest()].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
type Attempt = {
  key: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  uploadId?: Id<"videoMediaUploads">;
};
export function MediaUpload({
  workspaceId,
  onReady,
}: {
  workspaceId: Id<"workspaces">;
  onReady?: () => void;
}) {
  const prepare = useAction(api.videoMedia.prepareUpload);
  const finalize = useAction(api.videoMedia.finalizeUpload);
  const storageKey = `visual-media-upload:${workspaceId}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return value && typeof value.key === "string" && typeof value.sha256 === "string"
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(
    attempt ? "Upload recovered — check its state or reselect the same file." : "",
  );
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      xhr.current?.abort();
    },
    [],
  );
  function remember(value: Attempt | null) {
    setAttempt(value);
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
  }
  async function check(uploadId: Id<"videoMediaUploads">) {
    setBusy(true);
    try {
      const result = await finalize({ uploadId });
      if (result.state === "ready") {
        setStage("Verified and saved in this workspace's isolated asset library.");
        remember(null);
        onReady?.();
      } else
        setStage(
          `Server state: ${result.state}. Verification does not repeat generation. Check again shortly.`,
        );
    } catch {
      setStage(
        "Upload is incomplete or verification could not be confirmed. Reselect the identical file to retry transfer; keep this reservation.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (file.size === 0 || file.size > 2_000_000_000) {
      setStage("Choose a non-empty file no larger than 2 GB (2,000,000,000 bytes).");
      return;
    }
    setBusy(true);
    setStage("Computing SHA-256 in bounded chunks…");
    setProgress(0);
    abort.current = new AbortController();
    try {
      const hash = await hashUpload(file, setProgress, abort.current.signal);
      if (
        attempt &&
        (attempt.sha256 !== hash ||
          attempt.filename !== file.name ||
          attempt.sizeBytes !== file.size)
      )
        throw new Error("different_file");
      let request: Attempt = attempt ?? {
        key: crypto.randomUUID(),
        filename: file.name,
        sizeBytes: file.size,
        mimeType: file.type || "application/octet-stream",
        sha256: hash,
      };
      remember(request);
      setStage("Reserving exact bytes…");
      const prepared = await prepare({
        workspaceId,
        idempotencyKey: request.key,
        filename: request.filename,
        sizeBytes: request.sizeBytes,
        mimeType: request.mimeType,
        sha256: request.sha256,
        source: "upload",
      });
      request = { ...request, uploadId: prepared.uploadId };
      remember(request);
      if (prepared.state === "ready") {
        setStage("Already verified and saved.");
        remember(null);
        onReady?.();
        return;
      }
      if ("upload" in prepared && prepared.upload) {
        const uploadUrl = prepared.upload.url;
        setStage(`Uploading ${formatBytes(file.size)}…`);
        setProgress(0);
        await new Promise<void>((resolve, reject) => {
          const transfer = new XMLHttpRequest();
          xhr.current = transfer;
          transfer.open("PUT", uploadUrl);
          transfer.setRequestHeader("Content-Type", request.mimeType);
          // The browser sets Content-Length from the Blob. It is a forbidden JS header.
          transfer.upload.onprogress = (event) => {
            if (event.lengthComputable) setProgress(event.loaded / event.total);
          };
          transfer.onload = () =>
            transfer.status >= 200 && transfer.status < 300
              ? resolve()
              : reject(new Error("transfer_failed"));
          transfer.onerror = () => reject(new Error("transfer_failed"));
          transfer.onabort = () => reject(new Error("transfer_cancelled"));
          transfer.send(file);
        });
      }
      await check(prepared.uploadId);
    } catch (error) {
      setStage(
        error instanceof Error && error.message === "different_file"
          ? "A previous reservation exists for another file. Finish it or explicitly forget it before choosing a new file."
          : "Transfer was not confirmed. Your reservation is retained; reselect the identical file or check the server state.",
      );
    } finally {
      setBusy(false);
      xhr.current = null;
    }
  }
  return (
    <section className="media-upload" aria-label="Large media upload">
      <h3>Upload media · up to 2 GB</h3>
      <p className="video-hint">
        Images, audio and video go directly to the same private bucket. The server verifies the
        actual bytes, type and SHA-256 before making them available.
      </p>
      <label className="video-field">
        Choose a file
        <input
          aria-label="Upload media file"
          type="file"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      {busy && <progress value={progress} max={1} aria-label="Upload progress" />}
      {stage && <p role="status">{stage}</p>}
      {attempt?.uploadId && (
        <Button
          disabled={busy}
          size="sm"
          onClick={() => {
            if (attempt.uploadId) void check(attempt.uploadId);
          }}
        >
          Check saved upload
        </Button>
      )}
      {attempt && (
        <Button
          disabled={busy}
          size="sm"
          onClick={() => {
            if (
              !window.confirm(
                "Forget this local retry pointer? Uploaded bytes are not deleted, and you may need the reservation ID to recover them.",
              )
            )
              return;
            remember(null);
            setStage("Local retry pointer forgotten. Existing uploaded bytes were not deleted.");
          }}
        >
          Forget local retry pointer
        </Button>
      )}
      {attempt?.uploadId && <p className="video-hint">Reservation {attempt.uploadId}</p>}
    </section>
  );
}
