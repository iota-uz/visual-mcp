import { useMutation, useQuery } from "convex/react";
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
  media: "Media operation",
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
  const operations = useQuery(api.videoJobs.listOperations, { workspaceId, projectId, limit: 30 });
  const cancel = useMutation(api.videoJobs.cancel);
  const regenerate = useMutation(api.videoJobs.regenerate);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active =
    operations?.filter((operation) => activeStates.has(operation.latestAttempt.state)) ?? [];
  const history =
    operations?.filter((operation) => !activeStates.has(operation.latestAttempt.state)) ?? [];

  async function act(kind: "cancel" | "regenerate", jobId: Id<"videoJobs">) {
    setPending(jobId);
    setError("");
    try {
      if (kind === "cancel") await cancel({ jobId });
      else await regenerate({ jobId });
    } catch {
      setError(
        kind === "regenerate"
          ? "A new attempt was not confirmed. Inspect this operation; do not create another key."
          : "Cancellation could not be confirmed. Inspect this job before making another request.",
      );
    } finally {
      setPending(null);
    }
  }

  const cards = (items: NonNullable<typeof operations>) =>
    items.map((operation) => {
      const successfulAttempt = operation.latestSuccessfulAttempt;
      return (
        <Disclosure
          key={operation.operationId}
          className="video-job"
          summary={
            <div className="video-job-summary">
              <span className="video-job-summary-main">
                <strong>{kindLabels[operation.kind] ?? operation.kind}</strong>
                <span>
                  {operation.attempts.length}{" "}
                  {operation.attempts.length === 1 ? "attempt" : "attempts"}
                </span>
              </span>
              <span className="video-job-summary-meta">
                {operation.retryCount > 0 && <Badge>{operation.retryCount} retries</Badge>}
                <Badge tone={operation.latestSuccessfulAttempt ? "success" : "warning"}>
                  {operation.latestSuccessfulAttempt
                    ? "Draft saved"
                    : labels[operation.latestAttempt.state]}
                </Badge>
              </span>
            </div>
          }
        >
          <div className="video-job-body">
            {successfulAttempt && (
              <section className="video-job-success" aria-label="Latest successful draft">
                <Badge tone="success">Latest successful draft</Badge>
                <JobVersion versionId={successfulAttempt.versionId} kind={operation.kind} />
                {operation.kind === "render" && onOpenRender && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onOpenRender(successfulAttempt.jobId)}
                  >
                    Review export
                  </Button>
                )}
              </section>
            )}
            {operation.latestAttempt.state === "outcome_unknown" && (
              <p className="video-warning">
                The outcome is unknown. This operation cannot be regenerated from here.
              </p>
            )}
            {operation.latestAttempt.state === "running" &&
              operation.latestAttempt.progress !== null && (
                <div role="status">
                  <p className="video-hint">
                    {operation.latestAttempt.stage.replaceAll("_", " ")} ·{" "}
                    {Math.round(operation.latestAttempt.progress * 100)}%
                  </p>
                  <progress
                    value={operation.latestAttempt.progress}
                    max={1}
                    aria-label="Render progress"
                  />
                </div>
              )}
            <div className="video-actions">
              {activeStates.has(operation.latestAttempt.state) && (
                <Button
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => void act("cancel", operation.latestAttempt.jobId)}
                >
                  {pending === operation.latestAttempt.jobId
                    ? "Requesting cancellation…"
                    : "Request cancellation"}
                </Button>
              )}
              {operation.kind === "render" &&
                operation.latestAttempt.error?.recovery.kind === "regenerate" &&
                operation.latestAttempt.error.recovery.safeToRegenerate === true && (
                  <Button
                    size="sm"
                    disabled={pending !== null}
                    onClick={() => void act("regenerate", operation.latestAttempt.jobId)}
                  >
                    {pending === operation.latestAttempt.jobId ? "Starting…" : "Render again"}
                  </Button>
                )}
            </div>
            <Disclosure summary="Attempt history" className="video-job-technical">
              <ol className="video-attempt-history">
                {operation.attempts.map((attempt) => (
                  <li key={attempt.jobId}>
                    <div>
                      <strong>Attempt {attempt.attemptNumber}</strong>{" "}
                      <Badge
                        tone={
                          attempt.state === "succeeded"
                            ? "success"
                            : attempt.error
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {labels[attempt.state] ?? attempt.state}
                      </Badge>
                    </div>
                    <p className="video-hint">
                      {[
                        attempt.stage ? attempt.stage.replaceAll("_", " ") : null,
                        attempt.updatedAt ? new Date(attempt.updatedAt).toLocaleString() : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Attempt recorded"}
                    </p>
                    {attempt.error && (
                      <p role="alert">
                        {attempt.error.code}. {attempt.error.message}
                      </p>
                    )}
                    <code>{attempt.jobId}</code>
                  </li>
                ))}
              </ol>
            </Disclosure>
          </div>
        </Disclosure>
      );
    });

  return (
    <section className="video-jobs" aria-label="Production jobs">
      <div className="video-section-heading">
        <div>
          <h2>Production jobs</h2>
          <p className="video-hint">
            Attempts are grouped so a failed retry never hides a saved draft.
          </p>
        </div>
        {active.length > 0 && <Badge tone="info">{active.length} active</Badge>}
      </div>
      {!operations && <p role="status">Loading jobs…</p>}
      {operations?.length === 0 && <p className="video-hint">No jobs yet.</p>}
      {error && <p role="alert">{error}</p>}
      {active.length > 0 && (
        <div className="video-job-group">
          <h3>In progress</h3>
          {cards(active)}
        </div>
      )}
      {history.length > 0 && (
        <div className="video-job-group">
          <h3>Recent operations</h3>
          {cards(history)}
        </div>
      )}
    </section>
  );
}

function JobVersion({ versionId, kind }: { versionId: Id<"videoVersions"> | null; kind: string }) {
  const version = useQuery(api.video.getVersionSummary, versionId ? { versionId } : "skip");
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
