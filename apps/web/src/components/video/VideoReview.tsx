import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "../Badge";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import { Checkbox } from "../ui/TextInput";
import { RenderCandidates } from "./review/RenderCandidates";
import { type CapturedRegion, type Feedback, VideoFeedback } from "./review/VideoFeedback";
import { VideoPlayer } from "./VideoPlayer";

type Preview = { videoUrl: string; posterUrl: string; captionsUrl: string; expiresAt: number };

export { VideoFeedback } from "./review/VideoFeedback";
export function VideoReview({
  jobId,
  projectId,
  workspaceId,
  onOpenRender,
  onBlocked,
}: {
  jobId: Id<"videoJobs">;
  projectId: Id<"videoProjects">;
  workspaceId: Id<"workspaces">;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
  onBlocked: (value: boolean) => void;
}) {
  const metadata = useQuery(api.videoReview.renderMetadata, { jobId });
  const getPreview = useAction(api.videoReview.preview);
  const approve = useMutation(api.videoReview.approve);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [anchor, setAnchor] = useState<Feedback | undefined>();
  const [annotationMode, setAnnotationMode] = useState(false);
  const [capturedRegion, setCapturedRegion] = useState<CapturedRegion>();
  const approvalKey = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTarget = metadata ? jobId : null;
  useEffect(() => {
    if (focusTarget && heading.current) {
      heading.current.focus({ preventScroll: true });
    }
  }, [focusTarget]);
  async function refresh() {
    setLoaded(false);
    setConfirmed(false);
    setError("");
    try {
      setPreview(await getPreview({ jobId }));
    } catch {
      setError("Preview link could not be loaded. Nothing has been approved.");
    }
  }
  useEffect(() => {
    let active = true;
    void getPreview({ jobId })
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch(() => {
        if (active) setError("Preview unavailable. Retry to obtain a fresh link.");
      });
    return () => {
      active = false;
    };
  }, [jobId, getPreview]);
  if (!metadata) return <p role="status">Loading exact render…</p>;
  if (metadata.projectId !== projectId)
    return <p role="alert">This render belongs to another project.</p>;
  return (
    <section className="video-review" aria-label="Review exact render">
      <header className="video-review-heading">
        <div>
          <span className="video-review-kicker">
            Final check · {metadata.language.toUpperCase()}
          </span>
          <h2 ref={heading} tabIndex={-1}>
            Review this export
          </h2>
          <p>
            Watch the exact export, check sound and captions, then approve or leave a timecoded
            note.
          </p>
        </div>
        <div className="video-review-status">
          <Badge tone={metadata.stale ? "warning" : "success"}>
            {metadata.stale ? "Older candidate" : "Current candidate"}
          </Badge>
          <span>{(metadata.videoDurationMs / 1000).toFixed(1)} seconds</span>
        </div>
      </header>
      {metadata.stale && (
        <p className="video-warning">
          The editable draft is newer. Any approval here applies only to this saved candidate, never
          to the newer draft.
        </p>
      )}
      <RenderCandidates
        workspaceId={workspaceId}
        projectId={projectId}
        activeJobId={jobId}
        onOpenRender={onOpenRender}
      />
      {error && <p role="alert">{error}</p>}
      <div className="video-review-workspace">
        <div className="video-review-screen">
          {preview ? (
            <VideoPlayer
              key={`${jobId}-${metadata.sha256}`}
              asset={{ ...metadata, ...preview }}
              onLoaded={(ready) => {
                setLoaded(ready);
                if (!ready) setConfirmed(false);
              }}
              onTime={setTime}
              seekMs={anchor?.startMs}
              region={anchor?.region}
              onRefresh={() => void refresh()}
              annotationMode={annotationMode}
              onAnnotationModeChange={setAnnotationMode}
              onRegion={(next) => {
                const selection = { id: crypto.randomUUID(), startMs: time, region: next };
                setAnchor({ text: "", startMs: time, region: next });
                setCapturedRegion(selection);
              }}
            />
          ) : (
            <div className="video-review-loading">
              <div>
                <h3>Preview not loaded yet</h3>
                <p>
                  Fetch a fresh playable link for this exact MP4. Approval unlocks once the preview
                  loads.
                </p>
                <Button onClick={() => void refresh()}>Load preview</Button>
              </div>
            </div>
          )}
        </div>
        <aside className="video-review-notes" aria-label="Approval and feedback">
          <div className="video-approval">
            <h3>Approval</h3>
            {metadata.approval ? (
              <Badge tone="success">You approved this exact MP4</Badge>
            ) : (
              <>
                <Checkbox
                  checked={confirmed}
                  disabled={!loaded || !metadata.approvable || busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  label={`I reviewed this ${metadata.stale ? "older " : ""}${metadata.language.toUpperCase()} candidate and its exact MP4, including sound and captions.`}
                />
                <Button
                  variant="primary"
                  disabled={!loaded || !confirmed || !metadata.approvable || busy}
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void approve({
                      jobId,
                      versionId: metadata.versionId,
                      language: metadata.language,
                      sha256: metadata.sha256,
                      confirmedViewed: true,
                      idempotencyKey: approvalKey.current,
                    })
                      .catch(() =>
                        setError(
                          "Approval was not confirmed. Retry this exact candidate; do not assume it was accepted.",
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? "Confirming…" : "Approve this exact MP4"}
                </Button>
                {!metadata.approvable && (
                  <p className="video-hint">
                    Partial previews and analysis proxies cannot be approved.
                  </p>
                )}
                {metadata.approvable && !loaded && (
                  <p className="video-hint">Load and watch the preview to unlock approval.</p>
                )}
              </>
            )}
          </div>
          <VideoFeedback
            key={jobId}
            projectId={projectId}
            target={{ kind: "render", jobId }}
            time={time}
            durationMs={metadata.videoDurationMs}
            capturedRegion={capturedRegion}
            onAnchor={setAnchor}
            onBlocked={onBlocked}
          />
        </aside>
      </div>
      <p className="video-review-integrity">
        Approval is bound to this saved version and exact MP4.
      </p>
      <Disclosure
        summary="Technical details and render provenance"
        className="video-review-technical"
      >
        <p className="video-hint">
          Version <code>{metadata.versionId}</code>
          <br />
          MP4 SHA-256 <code>{metadata.sha256}</code>
        </p>
        {metadata.engine ? (
          <>
            <p className="video-hint">
              Remotion {metadata.engine.remotionVersion} · FFmpeg {metadata.engine.ffmpegVersion} ·
              worker build {metadata.engine.workerBuildSha ?? "not recorded"}
            </p>
            {metadata.engine.fonts.map((font) => (
              <p className="video-hint" key={font.family}>
                {font.family}: <code>{font.sha256}</code>
              </p>
            ))}
          </>
        ) : (
          <p className="video-hint">
            Engine provenance was not recorded for this historical render; current deployment
            versions do not describe it.
          </p>
        )}
      </Disclosure>
    </section>
  );
}
