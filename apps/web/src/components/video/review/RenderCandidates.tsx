import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

export function RenderCandidates({
  workspaceId,
  projectId,
  activeJobId,
  onOpenRender,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"videoProjects">;
  activeJobId: Id<"videoJobs">;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
}) {
  const operations = useQuery(api.videoJobs.listOperations, {
    workspaceId,
    projectId,
    kind: "render",
    limit: 30,
  });
  const renders = operations
    ?.map((operation) => operation.latestSuccessfulAttempt)
    .filter((attempt) => attempt !== null);
  if (!operations) {
    return (
      <p className="video-candidates-loading" role="status">
        Loading saved exports…
      </p>
    );
  }
  if (!renders?.length) {
    if (!operations.length) return null;
    return (
      <p className="video-candidates-loading" role="status">
        Export in progress… Finished exports appear here.
      </p>
    );
  }
  return (
    <nav className="video-candidates" aria-label="Saved render candidates">
      <div className="video-candidates-heading">
        <strong>Exports</strong>
      </div>
      <div className="video-candidate-list">
        {renders.map((render) => (
          <RenderCandidate
            key={render.jobId}
            jobId={render.jobId}
            active={render.jobId === activeJobId}
            onOpenRender={onOpenRender}
          />
        ))}
      </div>
    </nav>
  );
}

function RenderCandidate({
  jobId,
  active,
  onOpenRender,
}: {
  jobId: Id<"videoJobs">;
  active: boolean;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
}) {
  const metadata = useQuery(api.videoReview.renderMetadata, { jobId });
  const version = useQuery(
    api.video.getVersionSummary,
    metadata ? { versionId: metadata.versionId } : "skip",
  );
  const label = version?.label ?? "Saved version";
  const duration = metadata ? `${(metadata.videoDurationMs / 1000).toFixed(1)}s` : "";
  return (
    <button
      type="button"
      className="video-candidate"
      aria-current={active ? "true" : undefined}
      title={label}
      disabled={!metadata || active}
      onClick={() => onOpenRender(jobId)}
    >
      {metadata ? (
        <>
          <span className="video-candidate-slate" aria-hidden="true">
            <span>{metadata.language.toUpperCase()}</span>
            <span>{duration}</span>
          </span>
          <span className="video-candidate-copy">
            <span className="video-candidate-title">
              <strong>{label}</strong>
            </span>
            <span className="video-candidate-state">
              {metadata.stale ? "Older draft" : "Current draft"}
              {metadata.approval ? " · Approved by you" : " · Not approved"}
            </span>
          </span>
        </>
      ) : (
        "Loading export…"
      )}
    </button>
  );
}
