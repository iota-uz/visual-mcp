import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import type { PinnedImage } from "../SharedImageStudio";
import { Button } from "../ui/Button";
import { Checkbox, Select, TextInput } from "../ui/TextInput";
import { useDurableJobIntent } from "./useDurableJobIntent";

type Shot = ScriptDocument["scenesById"][string]["shotsById"][string];
export function ShotStudio({
  workspaceId,
  projectId,
  draftId,
  revision,
  document,
  onChange,
  locked,
  unsaved,
  sceneId: sceneIdProp,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"videoProjects">;
  draftId: Id<"videoDrafts">;
  revision: string;
  document: ScriptDocument;
  onChange: (value: ScriptDocument) => void;
  locked: boolean;
  unsaved: boolean;
  sceneId?: string;
}) {
  const [sceneChoice, setSceneChoice] = useState("");
  const requestedScene = sceneIdProp && document.scenesById[sceneIdProp] ? sceneIdProp : undefined;
  const sceneId = requestedScene
    ? requestedScene
    : document.scenesById[sceneChoice]
      ? sceneChoice
      : document.sceneOrder[0];
  const scene = sceneId ? document.scenesById[sceneId] : undefined;
  const [shotChoice, setShotChoice] = useState("");
  const shotId = scene?.shotsById[shotChoice] ? shotChoice : scene?.shotOrder[0];
  const shot = shotId ? scene?.shotsById[shotId] : undefined;
  function patch(value: Partial<Shot>) {
    if (!scene || !sceneId || !shotId || !shot) return;
    onChange({
      ...document,
      scenesById: {
        ...document.scenesById,
        [sceneId]: { ...scene, shotsById: { ...scene.shotsById, [shotId]: { ...shot, ...value } } },
      },
    });
  }
  return (
    <section className="video-shot-studio" aria-label="Shot production">
      <h2>Shot production</h2>
      <p className="video-hint">
        A generation creates a candidate. Choosing it does not place it on the timeline or approve
        the video.
      </p>
      {!scene ? (
        <p>Add a scene to plan a shot.</p>
      ) : (
        <>
          {!sceneIdProp && (
            <Select
              id="shot-scene"
              label="Scene"
              labelVisible
              disabled={locked}
              value={sceneId}
              onChange={(event) => setSceneChoice(event.target.value)}
              options={document.sceneOrder.map((id) => ({
                value: id,
                label: document.scenesById[id]?.purpose || id,
              }))}
            />
          )}
          <Button
            disabled={locked || scene.shotOrder.length >= 100}
            size="sm"
            onClick={() => {
              const id = `shot-${crypto.randomUUID()}`;
              onChange({
                ...document,
                scenesById: {
                  ...document.scenesById,
                  [sceneId!]: {
                    ...scene,
                    shotOrder: [...scene.shotOrder, id],
                    shotsById: {
                      ...scene.shotsById,
                      [id]: {
                        purpose: "New shot",
                        method: "remotion",
                        subjectAction: "",
                        cameraMotion: "",
                        constraints: [],
                      },
                    },
                  },
                },
              });
              setShotChoice(id);
            }}
          >
            Add shot
          </Button>
          {shot && shotId && (
            <>
              <Select
                id="shot-choice"
                label="Shot"
                labelVisible
                value={shotId}
                disabled={locked}
                onChange={(event) => setShotChoice(event.target.value)}
                options={scene.shotOrder.map((id) => ({
                  value: id,
                  label: scene.shotsById[id]?.purpose || id,
                }))}
              />
              <TextInput
                id="shot-purpose"
                label="Story purpose"
                labelVisible
                readOnly={locked}
                value={shot.purpose}
                onChange={(event) => patch({ purpose: event.target.value })}
              />
              <Select
                id="shot-method"
                label="Production method"
                labelVisible
                disabled={locked}
                value={shot.method}
                onChange={(event) => patch({ method: event.target.value as Shot["method"] })}
                options={[
                  { value: "remotion", label: "Deterministic Remotion" },
                  { value: "higgsfield", label: "Higgsfield image-to-video" },
                  { value: "recording", label: "Real recording" },
                ]}
              />
              <TextInput
                id="shot-action"
                label="Subject action"
                labelVisible
                readOnly={locked}
                value={shot.subjectAction}
                onChange={(event) => patch({ subjectAction: event.target.value })}
              />
              <TextInput
                id="shot-camera"
                label="Camera movement"
                labelVisible
                readOnly={locked}
                value={shot.cameraMotion}
                onChange={(event) => patch({ cameraMotion: event.target.value })}
              />
              <label className="video-field">
                Immutable constraints
                <textarea
                  readOnly={locked}
                  value={shot.constraints.join("\n")}
                  onChange={(event) =>
                    patch({ constraints: event.target.value.split("\n").filter(Boolean) })
                  }
                />
              </label>
              <PinnedSource
                workspaceId={workspaceId}
                source={shot.startImage as PinnedImage | undefined}
                onSelected={(asset) => patch({ startImage: asset })}
                disabled={locked}
              />
              <ShotCandidates
                key={`${sceneId}/${shotId}`}
                workspaceId={workspaceId}
                projectId={projectId}
                draftId={draftId}
                sceneId={sceneId!}
                shotId={shotId}
                revision={revision}
                shot={shot}
                disabled={locked || unsaved}
                onSelect={(asset, reason, jobId) =>
                  patch({
                    selectedVideo: asset,
                    selectedVideoReason: reason,
                    selectedVideoJobId: jobId,
                  })
                }
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
function PinnedSource({
  workspaceId,
  source,
  onSelected,
  disabled,
}: {
  workspaceId: Id<"workspaces">;
  source?: PinnedImage;
  onSelected: (asset: PinnedImage) => void;
  disabled: boolean;
}) {
  const workspace = useQuery(api.workspaces.getById, { workspaceId });
  const list = useAction(api.assets.listMine);
  const [library, setLibrary] = useState<
    Array<{
      asset_id: Id<"assets">;
      revision_id: Id<"assetVersions">;
      name: string;
      preview_url: string;
    }>
  >([]);
  const workspaceSlug = workspace?.slug;
  useEffect(() => {
    if (!workspaceSlug) return;
    let active = true;
    void list({ scope: "workspace", workspaceSlug, kind: "image", limit: 20 }).then((rows) => {
      if (active) setLibrary(rows);
    });
    return () => {
      active = false;
    };
  }, [workspaceSlug, list]);
  const preview = useAction(api.videoMedia.previewAsset);
  const [assetId, setAssetId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const sourceAssetId = source?.assetId;
  const sourceRevisionId = source?.revisionId;
  useEffect(() => {
    setUrl(null);
    if (!sourceAssetId || !sourceRevisionId) return;
    let active = true;
    void preview({ workspaceId, asset: { assetId: sourceAssetId, revisionId: sourceRevisionId } })
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch(() => {
        if (active) setMessage("Pinned source unavailable.");
      });
    return () => {
      active = false;
    };
  }, [sourceAssetId, sourceRevisionId, workspaceId, preview]);
  return (
    <div className="video-shot-source">
      <h3>Start image</h3>
      {url && <img src={url} alt="Pinned start frame" />}
      <p className="video-hint">
        Recent 20 shared images. Selecting pins this exact revision, including Codex imagegen
        uploads.
      </p>
      <div className="video-keyframe-library">
        {library.map((item) => (
          <button
            type="button"
            key={item.revision_id}
            className="video-keyframe-thumb"
            disabled={disabled}
            aria-pressed={source?.revisionId === item.revision_id}
            onClick={() => onSelected({ assetId: item.asset_id, revisionId: item.revision_id })}
          >
            <img src={item.preview_url} alt="" />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      <details className="video-advanced">
        <summary>Pin exact revision</summary>
        <TextInput
          id="shot-source-asset"
          label="Asset ID"
          labelVisible
          value={assetId}
          disabled={disabled}
          onChange={(event) => setAssetId(event.target.value)}
        />
        <TextInput
          id="shot-source-revision"
          label="Asset revision ID"
          labelVisible
          value={revisionId}
          disabled={disabled}
          onChange={(event) => setRevisionId(event.target.value)}
        />
        <Button
          size="sm"
          disabled={disabled || !assetId || !revisionId}
          onClick={() => {
            const asset = {
              assetId: assetId as Id<"assets">,
              revisionId: revisionId as Id<"assetVersions">,
            };
            void preview({ workspaceId, asset })
              .then((result) => {
                if (!result.mimeType.startsWith("image/")) throw new Error();
                onSelected(asset);
                setMessage("Pinned start image selected.");
              })
              .catch(() =>
                setMessage("Select an accessible image and its exact revision in this workspace."),
              );
          }}
        >
          Pin start image
        </Button>
      </details>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
function shotContext(
  value: unknown,
): { draftId: string; sceneId: string; shotId: string; scriptRevision: string } | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("context" in value) ||
    !value.context ||
    typeof value.context !== "object"
  )
    return null;
  const ctx = value.context;
  return "draftId" in ctx &&
    "sceneId" in ctx &&
    "shotId" in ctx &&
    "scriptRevision" in ctx &&
    [ctx.draftId, ctx.sceneId, ctx.shotId, ctx.scriptRevision].every(
      (item) => typeof item === "string",
    )
    ? (ctx as { draftId: string; sceneId: string; shotId: string; scriptRevision: string })
    : null;
}
function candidate(value: unknown): PinnedImage | null {
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
function ShotCandidates({
  workspaceId,
  projectId,
  draftId,
  sceneId,
  shotId,
  revision,
  shot,
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
    const ctx = shotContext(job);
    return ctx?.draftId === draftId && ctx.sceneId === sceneId && ctx.shotId === shotId;
  });
  async function generate() {
    if (!shot.startImage && !pending.current) return;
    const request = pending.current ?? {
      workspaceId,
      projectId,
      idempotencyKey: crypto.randomUUID(),
      request: {
        kind: "shot",
        allowPaid: true,
        draftId,
        sceneId,
        shotId,
        scriptRevision: revision,
        startImage: shot.startImage!,
        profileId: "higgsfield-kling-v2.5-turbo-pro",
        prompt: [shot.subjectAction, `Camera: ${shot.cameraMotion}`, ...shot.constraints].join(
          "\n",
        ),
        durationMs,
      },
    };
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
          {disabled && (
            <p className="video-hint">
              Save the current script before generating or selecting a candidate.
            </p>
          )}
          {pending.error && <p role="alert">{pending.error}</p>}
        </>
      )}
      {message && <p role="status">{message}</p>}
      <TextInput
        id="compare-shot-time"
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
          const asset = candidate(job.result);
          const stale = shotContext(job)?.scriptRevision !== revision;
          return (
            <article key={job.jobId}>
              <p>
                {job.state} · {stale ? "Older shot plan" : "Current shot plan"}
              </p>
              {job.error && <p role="alert">{job.error.message}</p>}
              {job.state === "succeeded" && asset && (
                <CandidatePlayer
                  workspaceId={workspaceId}
                  asset={asset}
                  time={time}
                  selected={shot.selectedVideo?.revisionId === asset.revisionId}
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
  const { assetId: previewAssetId, revisionId: previewRevisionId } = asset;
  useEffect(() => {
    let active = true;
    void preview({ workspaceId, asset: { assetId: previewAssetId, revisionId: previewRevisionId } })
      .then((value) => {
        if (active) setUrl(value.url);
      })
      .catch(() => {
        if (active) setError("Candidate preview unavailable.");
      });
    return () => {
      active = false;
    };
  }, [workspaceId, previewAssetId, previewRevisionId, preview]);
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
