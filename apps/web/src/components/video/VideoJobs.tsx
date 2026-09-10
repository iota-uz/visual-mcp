import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "../Badge";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";

const labels: Record<string, string> = {
  queued: "Queued",
  running: "Processing",
  succeeded: "Saved",
  failed: "Failed",
  outcome_unknown: "Outcome unknown",
  cancel_requested: "Cancellation requested",
  cancelled: "Cancelled",
};
export function VideoJobs({
  workspaceId,
  projectId,
  onOpenRender,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"videoProjects">;
  onOpenRender?: (jobId: Id<"videoJobs">) => void;
}) {
  const jobs = usePaginatedQuery(
    api.videoJobs.listJobs,
    { workspaceId, projectId },
    { initialNumItems: 10 },
  );
  const cancel = useMutation(api.videoJobs.cancel);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function stop(jobId: Id<"videoJobs">) {
    setPending(jobId);
    setError("");
    try {
      await cancel({ jobId });
    } catch {
      setError(
        "Cancellation could not be confirmed. Inspect this job before making another request.",
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="video-jobs" aria-label="Production jobs">
      <h2>Production</h2>
      {jobs.status === "LoadingFirstPage" && <p role="status">Loading jobs…</p>}
      {jobs.status !== "LoadingFirstPage" && jobs.results.length === 0 && (
        <p className="video-hint">
          No jobs yet. Saving a script does not automatically start generation.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {jobs.results.map((job) => (
        <Disclosure
          key={job.jobId}
          summary={
            <>
              {job.kind} — {labels[job.state] ?? job.state}{" "}
              <JobVersion versionId={job.versionId} kind={job.kind} />
            </>
          }
        >
          <Badge
            tone={
              job.state === "succeeded"
                ? "success"
                : job.state === "outcome_unknown" || job.state === "failed"
                  ? "warning"
                  : "neutral"
            }
          >
            {labels[job.state] ?? job.state}
          </Badge>
          <p className="video-hint">Stage: {job.stage}</p>
          {job.stale && (
            <p className="video-hint">
              Created from an older draft. This result has not replaced your current edits.
            </p>
          )}
          {job.error && (
            <p role="alert">
              {job.error.code}. {job.error.message}
            </p>
          )}
          {job.error?.code === "WORKER_NOT_CONFIGURED" && (
            <p className="video-hint">
              An administrator must configure the render worker. No render was started; after
              configuration, request a new render of this saved version.
            </p>
          )}
          {job.state === "outcome_unknown" && (
            <p className="video-hint">
              The provider may have processed this request. Do not submit another generation to
              recover it.
            </p>
          )}
          {(job.state === "queued" || job.state === "running") && (
            <>
              <Button size="sm" disabled={pending !== null} onClick={() => void stop(job.jobId)}>
                {pending === job.jobId ? "Requesting cancellation…" : "Request cancellation"}
              </Button>
              <p className="video-hint">
                Processing may finish after cancellation is requested. Provider charges may still
                apply.
              </p>
            </>
          )}
          {job.kind === "render" && job.state === "succeeded" && onOpenRender && (
            <Button size="sm" onClick={() => onOpenRender(job.jobId)}>
              Open this render
            </Button>
          )}
        </Disclosure>
      ))}
      {jobs.status === "CanLoadMore" && (
        <Button size="sm" onClick={() => jobs.loadMore(10)}>
          More jobs
        </Button>
      )}
    </section>
  );
}
function JobVersion({ versionId, kind }: { versionId: Id<"videoVersions"> | null; kind: string }) {
  const version = useQuery(api.video.getVersion, versionId ? { versionId } : "skip");
  return (
    <span>
      {version
        ? `· ${version.version.language.toUpperCase()} · ${version.label} (${version.version.versionId})`
        : versionId
          ? `· version ${versionId}`
          : kind === "image"
            ? "· shared image (no language)"
            : "· project-level job"}
    </span>
  );
}
