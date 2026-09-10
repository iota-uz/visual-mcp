import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge } from "../components/Badge";
import { LoadingState } from "../components/LoadingState";
import { Button } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const Ref = z.object({ assetId: z.string().min(1), revisionId: z.string().min(1) });
type Asset = z.infer<typeof Ref>;
/** Only registered output fields, never arbitrary execution output interpreted as asset authority. */
export function jobAssets(result: unknown): { label: string; asset: Asset }[] {
  if (!result || typeof result !== "object") return [];
  const value = result as Record<string, unknown>;
  const found: { label: string; asset: Asset }[] = [];
  function add(label: string, item: unknown) {
    const parsed = Ref.safeParse(item);
    if (parsed.success && !found.some((row) => row.asset.revisionId === parsed.data.revisionId))
      found.push({ label, asset: parsed.data });
  }
  if (["image", "voice", "shot"].includes(String(value.kind)) && Array.isArray(value.artifacts)) {
    for (const row of value.artifacts.slice(0, 32))
      if (row && typeof row === "object") add(String(row.role ?? "Output"), row.asset);
  }
  if (value.kind === "render")
    for (const name of ["video", "poster", "captions", "technicalReport"]) add(name, value[name]);
  if (value.kind === "critique") add("Full critique report", value.report);
  if (value.kind === "media" && Array.isArray(value.outputs)) {
    for (const row of value.outputs.slice(0, 32))
      if (row && typeof row === "object") add(String(row.name ?? "Output"), row.asset);
  }
  return found;
}

export function VideoJobPage() {
  const { jobId } = useParams();
  return jobId ? (
    <JobDetails key={jobId} jobId={jobId as Id<"videoJobs">} />
  ) : (
    <p>No job at this address.</p>
  );
}
function JobDetails({ jobId }: { jobId: Id<"videoJobs"> }) {
  // Convex subscription delivers durable progress; no polling interval or paid retry is needed.
  const job = useQuery(api.videoJobs.getJob, { jobId });
  const cancel = useMutation(api.videoJobs.cancel);
  const reconcile = useAction(api.videoRecovery.reconcile);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useDocumentTitle(job ? `${job.kind} · ${job.state} · Job` : "Job");
  if (job === undefined) return <LoadingState />;
  if (!job)
    return (
      <p>
        No accessible job at this address. <Link to="/">Back to workspaces</Link>
      </p>
    );
  async function act(kind: "cancel" | "reconcile") {
    setPending(true);
    setError("");
    try {
      if (kind === "cancel") await cancel({ jobId });
      else await reconcile({ jobId });
    } catch {
      setError(
        "Operation could not be confirmed. Wait for this job’s status to update; do not submit another generation.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="page-stack video-projects">
      <nav aria-label="Breadcrumb">
        <Link to="/">Workspaces</Link>
        {job.projectId && (
          <>
            {" "}
            / <Link to={`/v/${job.projectId}`}>Video Studio</Link>
          </>
        )}
      </nav>
      <header>
        <p className="video-hint">Saved operation · {job.jobId}</p>
        <h1>{job.kind} job</h1>
        <Badge tone={job.state === "succeeded" ? "success" : job.error ? "warning" : "neutral"}>
          {job.state}
        </Badge>
      </header>
      <p role="status">Stage: {job.stage}. Updates automatically.</p>
      {job.versionId && (
        <p>
          Exact version: <code>{job.versionId}</code>
        </p>
      )}
      {job.stale && (
        <p className="video-warning">
          This result belongs to an older draft; current edits have not been replaced.
        </p>
      )}
      {job.error && (
        <div role="alert">
          <p>
            {job.error.code}: {job.error.message}
          </p>
          {job.error.recovery.kind === "configure_service" && (
            <p>
              An administrator must configure the service on the server. No credentials belong in
              this page. This page never resubmits generation.
            </p>
          )}
        </div>
      )}
      {job.state === "outcome_unknown" && (
        <p className="video-warning">
          The provider may have processed this request. Keep this receipt; do not start another paid
          generation to recover it.
        </p>
      )}
      {job.error?.recovery.kind === "reconcile" && (
        <Button disabled={pending} onClick={() => void act("reconcile")}>
          Recover already stored output
        </Button>
      )}
      {["running", "queued"].includes(job.state) && (
        <div>
          <Button disabled={pending} onClick={() => void act("cancel")}>
            Request cancellation
          </Button>
          <p className="video-hint">
            Work may finish after this request. Provider charges may still apply.
          </p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {job.state === "succeeded" && (
        <section aria-label="Saved outputs">
          <h2>Saved outputs</h2>
          {job.result?.partial && (
            <p className="video-warning">Partial output, not a complete final deliverable.</p>
          )}
          {jobAssets(job.result).map((row) => (
            <JobAsset key={row.asset.revisionId} workspaceId={job.workspaceId} {...row} />
          ))}
          {jobAssets(job.result).length === 0 && (
            <p>No media assets were produced. Inspect the recorded result below.</p>
          )}
          <p className="video-hint">A completed job is not human approval.</p>
        </section>
      )}
      {job.result && (
        <Disclosure summary="Recorded result">
          <pre className="video-original-record">{JSON.stringify(job.result, null, 2)}</pre>
        </Disclosure>
      )}
    </div>
  );
}
function JobAsset({
  workspaceId,
  label,
  asset,
}: {
  workspaceId: Id<"workspaces">;
  label: string;
  asset: Asset;
}) {
  const resolve = useAction(api.videoMedia.previewAsset);
  const [media, setMedia] = useState<{ url: string; mimeType: string; sha256: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <article className="video-comment">
      <h3>{label}</h3>
      <p className="video-hint">Revision: {asset.revisionId}</p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void resolve({
            workspaceId,
            asset: asset as { assetId: Id<"assets">; revisionId: Id<"assetVersions"> },
          })
            .then(setMedia)
            .catch(() =>
              setError(
                "Preview unavailable. Refresh the authenticated link; generation will not run again.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Loading link…" : media ? "Refresh preview link" : "Open saved output"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {media && (
        <div>
          <p>
            <a href={media.url} target="_blank" rel="noreferrer">
              Download {label}
            </a>
          </p>
          <p className="video-hint">
            SHA-256: <code>{media.sha256}</code>
          </p>
          {media.mimeType.startsWith("image/") && (
            <img src={media.url} alt={label} style={{ maxWidth: "100%", maxHeight: "60vh" }} />
          )}
          {media.mimeType.startsWith("video/") && (
            // biome-ignore lint/a11y/useMediaCaption: Generated media may not have a registered caption track; do not fabricate one.
            <video
              key={media.url}
              controls
              playsInline
              preload="metadata"
              src={media.url}
              aria-label={label}
              style={{ width: "100%", maxHeight: "60vh" }}
              onError={() =>
                setError(
                  "Playback unavailable. Refresh the preview link to retry these same saved bytes.",
                )
              }
            />
          )}
          {media.mimeType.startsWith("audio/") && (
            // biome-ignore lint/a11y/useMediaCaption: Audio outputs include music and SFX without a transcript.
            <audio key={media.url} controls preload="metadata" src={media.url} aria-label={label} />
          )}
        </div>
      )}
    </article>
  );
}
