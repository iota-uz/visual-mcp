import { useAction, useMutation, usePaginatedQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import {
  cameraMovementInstruction,
  normalizeCameraMovement,
} from "../../../../../../packages/video/src/camera";
import type { ScriptDocument } from "../../../../../../packages/video/src/contracts";
import type { PinnedImage } from "../../SharedImageStudio";
import { Button } from "../../ui/Button";
import { Checkbox, Select, TextInput } from "../../ui/TextInput";
import { useDurableJobIntent } from "../useDurableJobIntent";

type Shot = ScriptDocument["scenesById"][string]["shotsById"][string];
type ShotContext = { draftId: string; sceneId: string; shotId: string; scriptRevision: string };

function readShotContext(value: unknown): ShotContext | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("context" in value) ||
    !value.context ||
    typeof value.context !== "object"
  )
    return null;
  const context = value.context;
  return "draftId" in context &&
    "sceneId" in context &&
    "shotId" in context &&
    "scriptRevision" in context &&
    [context.draftId, context.sceneId, context.shotId, context.scriptRevision].every(
      (item) => typeof item === "string",
    )
    ? (context as ShotContext)
    : null;
}

function readCandidate(value: unknown): PinnedImage | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    value.kind !== "shot" ||
    !("artifacts" in value) ||
    !Array.isArray(value.artifacts)
  )
    return null;
  const first = value.artifacts.find(
    (item) => item?.mimeType === "video/mp4" && item?.asset?.assetId && item?.asset?.revisionId,
  );
  return first?.asset ?? null;
}

export function ShotCandidates({
  workspaceId,
  projectId,
  draftId,
  sceneId,
  shotId,
  revision,
  shot,
  sceneMotion,
  disabled,
  onSelect,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"videoProjects">;
  draftId: Id<"videoDrafts">;
  sceneId: string;
  shotId: string;
  revision: string;
  shot: Shot;
  sceneMotion?: string;
  disabled: boolean;
  onSelect: (asset: PinnedImage, reason: string, jobId: string) => void;
}) {
  const submit = useMutation(api.videoJobs.submit);
  const jobs = usePaginatedQuery(
    api.videoJobs.listJobs,
    { workspaceId, projectId },
    { initialNumItems: 20 },
  );
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [durationMs, setDurationMs] = useState(5000);
  const [time, setTime] = useState(0);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const pending = useDurableJobIntent<Parameters<typeof submit>[0]>(
    `shot:${workspaceId}:${draftId}:${sceneId}:${shotId}`,
  );

  useEffect(() => {
    if (pending.current?.request.kind === "shot") {
      setPaid(true);
      setDurationMs(pending.current.request.durationMs);
    }
  }, [pending.current]);

  const rows = jobs.results.filter((job) => {
    const context = readShotContext(job);
    return context?.draftId === draftId && context.sceneId === sceneId && context.shotId === shotId;
  });

  async function generate() {
    const movement =
      normalizeCameraMovement(shot.cameraMotion) || normalizeCameraMovement(sceneMotion);
    const request =
      pending.current ??
      (shot.startImage
        ? {
            workspaceId,
            projectId,
            idempotencyKey: crypto.randomUUID(),
            request: {
              kind: "shot" as const,
              allowPaid: true,
              draftId,
              sceneId,
              shotId,
              scriptRevision: revision,
              startImage: shot.startImage,
              profileId: "higgsfield-kling-v2.5-turbo-pro",
              prompt: [
                shot.subjectAction,
                movement
                  ? `Camera: ${cameraMovementInstruction(movement)}`
                  : sceneMotion
                    ? `Camera: ${sceneMotion}`
                    : "",
                ...shot.constraints,
              ]
                .filter(Boolean)
                .join("\n"),
              durationMs,
            },
          }
        : null);
    if (!request) return;
    setBusy(true);
    try {
      pending.save(request);
      await submit(request);
      pending.save(null);
      setPaid(false);
      setMessage("Candidate requested. It will not replace any selected clip.");
    } catch (error) {
      const data = error && typeof error === "object" && "data" in error ? error.data : null;
      if (data && typeof data === "object" && "effect" in data && data.effect === "not_applied") {
        pending.save(null);
        setPaid(false);
      }
      setMessage(
        "Request not confirmed. Retry retains the identical operation. Do not start another paid job as recovery.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="video-shot-candidates">
      {shot.method === "higgsfield" && (
        <>
          <p className="video-hint">
            Kling v2.5 Turbo Pro · capability/credentials checked server-side. Not a guarantee of
            identity or camera control.
          </p>
          <Select
            id="shot-duration"
            data-native-history
            label="Requested duration"
            labelVisible
            disabled={disabled || busy || !!pending.current}
            value={String(durationMs)}
            onChange={(event) => setDurationMs(Number(event.target.value))}
            options={[
              { value: "5000", label: "5 seconds" },
              { value: "10000", label: "10 seconds" },
            ]}
          />
          <Checkbox
            label="Authorize this paid shot generation"
            checked={paid}
            disabled={disabled || busy}
            onChange={(event) => setPaid(event.target.checked)}
          />
          <Button
            disabled={
              !pending.ready ||
              busy ||
              !paid ||
              (!pending.current && (disabled || !shot.startImage || !shot.subjectAction.trim()))
            }
            onClick={() => void generate()}
          >
            {busy
              ? "Submitting…"
              : pending.current
                ? "Retry same shot request"
                : "Generate shot candidate"}
          </Button>
          {!pending.current && (!shot.startImage || !shot.subjectAction.trim()) && (
            <p className="video-hint">
              Pin a start image and describe the subject action to enable generation.
            </p>
          )}
          {disabled && (
            <p className="video-hint">
              Save the current script before generating or selecting a candidate.
            </p>
          )}
          {pending.error && <p role="alert">{pending.error}</p>}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {jobs.status === "LoadingFirstPage" && (
        <p className="video-hint" role="status">
          Loading shot candidates…
        </p>
      )}
      {rows.length === 0 && jobs.status !== "LoadingFirstPage" && (
        <p className="video-hint">
          No candidates yet for this shot. Generate one above, or arrange this shot’s media on the
          timeline.
        </p>
      )}
      {rows.length > 0 && (
        <>
          <TextInput
            id="compare-shot-time"
            data-native-history
            label="Compare candidates at time (seconds)"
            labelVisible
            type="number"
            min={0}
            step={0.1}
            value={time}
            onChange={(event) => setTime(Number(event.target.value))}
          />
          <div className="video-shot-compare">
            {rows.map((job) => {
              const asset = readCandidate(job.result);
              const stale = readShotContext(job)?.scriptRevision !== revision;
              const selected =
                asset !== null && shot.selectedVideo?.revisionId === asset.revisionId;
              return (
                <article key={job.jobId} data-selected={selected || undefined}>
                  <p>
                    {job.state} · {stale ? "Older shot plan" : "Current shot plan"}
                  </p>
                  {job.error && <p role="alert">{job.error.message}</p>}
                  {job.state === "succeeded" && asset && (
                    <CandidatePlayer
                      workspaceId={workspaceId}
                      asset={asset}
                      time={time}
                      selected={selected}
                      disabled={disabled}
                      choosing={reasonFor === job.jobId}
                      reason={reason}
                      onReason={setReason}
                      onStartChoose={() => {
                        setReasonFor(job.jobId);
                        setReason("");
                      }}
                      onCancelChoose={() => setReasonFor(null)}
                      onSelect={(value) => {
                        onSelect(asset, value, job.jobId);
                        setReasonFor(null);
                        setReason("");
                      }}
                    />
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
      {jobs.status === "CanLoadMore" && (
        <Button size="sm" onClick={() => jobs.loadMore(20)}>
          Earlier project candidates
        </Button>
      )}
    </div>
  );
}

function CandidatePlayer({
  workspaceId,
  asset,
  time,
  selected,
  disabled,
  choosing,
  reason,
  onReason,
  onStartChoose,
  onCancelChoose,
  onSelect,
}: {
  workspaceId: Id<"workspaces">;
  asset: PinnedImage;
  time: number;
  selected: boolean;
  disabled: boolean;
  choosing: boolean;
  reason: string;
  onReason: (value: string) => void;
  onStartChoose: () => void;
  onCancelChoose: () => void;
  onSelect: (reason: string) => void;
}) {
  const preview = useAction(api.videoMedia.previewAsset);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const { assetId, revisionId } = asset;

  useEffect(() => {
    let active = true;
    void preview({ workspaceId, asset: { assetId, revisionId } })
      .then((value) => {
        if (active) setUrl(value.url);
      })
      .catch(() => {
        if (active) setError("Candidate preview unavailable.");
      });
    return () => {
      active = false;
    };
  }, [workspaceId, assetId, revisionId, preview]);

  useEffect(() => {
    if (video.current && Number.isFinite(time)) {
      video.current.pause();
      video.current.currentTime = Math.max(0, Math.min(time, video.current.duration || time));
    }
  }, [time]);

  return (
    <>
      {url && (
        // biome-ignore lint/a11y/useMediaCaption: Unvoiced provider shot candidate; captions are authored on the final timeline.
        <video
          controls
          playsInline
          preload="metadata"
          ref={video}
          src={url}
          aria-label="Shot candidate preview"
        />
      )}
      <p className="video-hint">
        {asset.assetId} @ {asset.revisionId}
      </p>
      {error && <p role="alert">{error}</p>}
      {choosing ? (
        <div className="video-form">
          <TextInput
            id={`shot-reason-${asset.revisionId}`}
            data-native-history
            label="Why this candidate?"
            labelVisible
            value={reason}
            onChange={(event) => onReason(event.target.value)}
          />
          <p className="video-hint">Choosing a clip updates the shot plan. It is not approval.</p>
          <div className="video-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={disabled || !reason.trim()}
              onClick={() => onSelect(reason.trim())}
            >
              Choose candidate
            </Button>
            <Button size="sm" onClick={onCancelChoose}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={disabled || selected || !url} size="sm" onClick={onStartChoose}>
          {selected ? "Selected candidate" : "Choose this candidate"}
        </Button>
      )}
    </>
  );
}
