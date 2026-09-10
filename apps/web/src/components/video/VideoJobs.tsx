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
const kindLabels: Record<string, string> = {
  render: "Video export",
  image: "Keyframe image",
  shot: "Generated shot",
  voice: "Voice-over",
  critique: "Quality review",
  video: "Generated video",
  music: "Music",
  sfx: "Sound effect",
  upload: "Media upload",
};
const activeStates = new Set(["queued", "running", "cancel_requested"]);
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
  const active = jobs.results.filter((job) => activeStates.has(job.state));
  const history = jobs.results.filter((job) => !activeStates.has(job.state));
  const renderJobs = (items: typeof jobs.results) =>
    items.map((job) => (
      <Disclosure
        key={job.jobId}
        className="video-job"
        summary={
          <div className="video-job-summary">
            <span className="video-job-summary-main">
              <strong>{kindLabels[job.kind] ?? job.kind}</strong>
              <JobVersion versionId={job.versionId} kind={job.kind} />
            </span>
            <span className="video-job-summary-meta">
              <time dateTime={new Date(job.createdAt).toISOString()}>
                {new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(job.createdAt)}
              </time>
              <Badge
                tone={
                  job.state === "succeeded"
                    ? "success"
                    : job.state === "outcome_unknown" || job.state === "failed"
                      ? "warning"
                      : job.state === "running"
                        ? "info"
                        : "neutral"
                }
              >
                {labels[job.state] ?? job.state}
              </Badge>
            </span>
          </div>
        }
      >
        <div className="video-job-body">
          <div className="video-job-stage">
            <span>Current step</span>
            <strong>{job.stage.replaceAll("_", " ")}</strong>
          </div>
          {job.context && (
            <p className="video-hint">
              Scene {job.context.sceneId} · shot {job.context.shotId}
            </p>
          )}
          {job.stale && (
            <p className="video-warning">
              This job used an older draft. Its result did not replace your current edits.
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
            <p className="video-warning">
              The provider may have processed this request. Inspect this job instead of submitting
              the same generation again.
            </p>
          )}
          <div className="video-actions">
            {(job.state === "queued" || job.state === "running") && (
              <Button size="sm" disabled={pending !== null} onClick={() => void stop(job.jobId)}>
                {pending === job.jobId ? "Requesting cancellation…" : "Request cancellation"}
              </Button>
            )}
            {job.kind === "render" && job.state === "succeeded" && onOpenRender && (
              <Button size="sm" variant="primary" onClick={() => onOpenRender(job.jobId)}>
                Review export
              </Button>
            )}
          </div>
          {(job.state === "queued" || job.state === "running") && (
            <p className="video-hint">
              Processing may finish after cancellation is requested. Provider charges may still
              apply.
            </p>
          )}
          <Disclosure summary="Technical details" className="video-job-technical">
            <dl className="video-job-facts">
              <div>
                <dt>Job ID</dt>
                <dd>
                  <code>{job.jobId}</code>
                </dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>
                  <time dateTime={new Date(job.updatedAt).toISOString()}>
                    {new Date(job.updatedAt).toLocaleString()}
                  </time>
                </dd>
              </div>
            </dl>
          </Disclosure>
        </div>
      </Disclosure>
    ));
  return (
    <section className="video-jobs" aria-label="Production jobs">
      <div className="video-section-heading">
        <div>
          <h2>Production jobs</h2>
          <p className="video-hint">
            Generation, voice, review and export activity for this project.
          </p>
        </div>
        {active.length > 0 && <Badge tone="info">{active.length} active</Badge>}
      </div>
      {jobs.status === "LoadingFirstPage" && <p role="status">Loading jobs…</p>}
      {jobs.status !== "LoadingFirstPage" && jobs.results.length === 0 && (
        <p className="video-hint">
          No jobs yet. Saving a script does not automatically start generation.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {active.length > 0 && (
        <div className="video-job-group">
          <h3>In progress</h3>
          {renderJobs(active)}
        </div>
      )}
      {history.length > 0 && (
        <div className="video-job-group">
          <h3>Recent history</h3>
          {renderJobs(history)}
        </div>
      )}
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
        ? `${version.version.language.toUpperCase()} · ${version.label}`
        : versionId
          ? "Saved version"
          : kind === "image"
            ? "Shared image"
            : "Project-level"}
    </span>
  );
}
