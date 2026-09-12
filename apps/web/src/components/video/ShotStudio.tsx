import { CheckCircle2, Circle, Clapperboard, Film, Plus, Sparkles, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  CAMERA_MOVEMENTS,
  normalizeCameraMovement,
} from "../../../../../packages/video/src/camera";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import type { PinnedImage } from "../SharedImageStudio";
import { Button } from "../ui/Button";
import { RadioCards } from "../ui/RadioCards";
import { Select, TextInput } from "../ui/TextInput";
import { ShotCandidates } from "./shots/ShotCandidates";
import { ShotStartImage } from "./shots/ShotStartImage";

type Shot = ScriptDocument["scenesById"][string]["shotsById"][string];
type Scene = ScriptDocument["scenesById"][string];

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
  selectedShotId,
  onSelectShot,
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
  selectedShotId?: string;
  onSelectShot?: (shotId: string) => void;
}) {
  const [sceneChoice, setSceneChoice] = useState("");
  const requestedScene = sceneIdProp && document.scenesById[sceneIdProp] ? sceneIdProp : undefined;
  const sceneId = requestedScene
    ? requestedScene
    : document.scenesById[sceneChoice]
      ? sceneChoice
      : document.sceneOrder[0];
  const scene = sceneId ? document.scenesById[sceneId] : undefined;
  const [expandedId, setExpandedId] = useState<string>();
  const incomingShot = useRef<string | undefined>(undefined);
  const shotId =
    expandedId && scene?.shotsById[expandedId]
      ? expandedId
      : selectedShotId && scene?.shotsById[selectedShotId]
        ? selectedShotId
        : undefined;
  const shot = shotId ? scene?.shotsById[shotId] : undefined;

  useEffect(() => {
    if (
      selectedShotId &&
      selectedShotId !== incomingShot.current &&
      scene?.shotsById[selectedShotId]
    ) {
      setExpandedId(selectedShotId);
    }
    incomingShot.current = selectedShotId;
  }, [scene, selectedShotId]);

  function selectShot(next: string) {
    onSelectShot?.(next);
    setExpandedId(next);
  }

  function addShot() {
    if (!scene || !sceneId) return;
    const id = `shot-${crypto.randomUUID()}`;
    onChange({
      ...document,
      scenesById: {
        ...document.scenesById,
        [sceneId]: {
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
    selectShot(id);
  }

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
    <section className="video-shot-studio" aria-label="Shots">
      {!sceneIdProp && scene && (
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
      {!scene ? (
        <div className="video-shot-empty">
          <Film size={28} aria-hidden="true" />
          <div>
            <h3>Add a scene before planning shots</h3>
            <p>Return to Story and describe what this part of the video needs to communicate.</p>
          </div>
        </div>
      ) : scene.shotOrder.length === 0 ? (
        <div className="video-shot-empty">
          <span className="video-beat-frame" aria-hidden="true" />
          <div>
            <h3>Plan the first shot</h3>
            <p>Start with the material this scene needs, then open a shot to produce it.</p>
          </div>
          <Button variant="primary" icon={Plus} onClick={addShot} disabled={locked}>
            Plan first shot
          </Button>
        </div>
      ) : (
        <>
          <ol className="video-beat-list">
            {scene.shotOrder.map((id, index) => {
              const item = scene.shotsById[id];
              if (!item) return null;
              const expanded = expandedId === id && !locked;
              const current = shotId === id;
              return (
                <li
                  key={id}
                  className={`video-beat${expanded ? " is-expanded" : ""}${current ? " is-current" : ""}`}
                >
                  <ShotFrame shot={item} />
                  <div className="video-beat-body">
                    <div className="video-beat-index-row">
                      <span className="video-beat-handle" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {item.purpose.trim() && item.subjectAction.trim() ? (
                        <CheckCircle2 size={14} aria-label="Shot ready" />
                      ) : (
                        <Circle size={14} aria-label="Shot incomplete" />
                      )}
                      {expanded && (
                        <Button size="sm" onClick={() => setExpandedId(undefined)}>
                          Done
                        </Button>
                      )}
                    </div>
                    {expanded && shot ? (
                      <ShotEditor
                        scene={scene}
                        shot={shot}
                        shotId={id}
                        sceneId={sceneId ?? ""}
                        workspaceId={workspaceId}
                        projectId={projectId}
                        draftId={draftId}
                        revision={revision}
                        locked={locked}
                        unsaved={unsaved}
                        onPatch={patch}
                      />
                    ) : locked ? (
                      <ShotRead shot={item} scene={scene} />
                    ) : (
                      <button
                        type="button"
                        className="video-beat-open"
                        aria-expanded="false"
                        aria-current={current ? "true" : undefined}
                        onClick={() => selectShot(id)}
                      >
                        <span className="visually-hidden">Edit shot {index + 1}. </span>
                        <ShotRead shot={item} scene={scene} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {!locked && (
            <Button
              icon={Plus}
              className="video-beat-add"
              onClick={addShot}
              disabled={scene.shotOrder.length >= 100}
            >
              Add shot
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function ShotFrame({ shot }: { shot: Shot }) {
  const line = shot.subjectAction.trim() || shot.purpose.trim();
  return (
    <div className="video-beat-frame" aria-hidden="true">
      {line ? (
        <span className="video-beat-frame-copy">
          <span>{line}</span>
        </span>
      ) : (
        <span className="video-beat-frame-empty" />
      )}
    </div>
  );
}

function ShotRead({ shot, scene }: { shot: Shot; scene: Scene }) {
  const motion = shotMotionLabel(shot, scene);
  const meta = [productionMethod(shot.method), motion, shot.selectedVideo ? "Candidate chosen" : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="video-beat-read">
      <strong className="video-beat-purpose">{shot.purpose.trim() || "Untitled shot"}</strong>
      {shot.subjectAction.trim() ? (
        <span className="video-beat-narration">{shot.subjectAction}</span>
      ) : null}
      {meta ? <span className="video-beat-meta">{meta}</span> : null}
    </span>
  );
}

function ShotEditor({
  scene,
  shot,
  shotId,
  sceneId,
  workspaceId,
  projectId,
  draftId,
  revision,
  locked,
  unsaved,
  onPatch,
}: {
  scene: Scene;
  shot: Shot;
  shotId: string;
  sceneId: string;
  workspaceId: Id<"workspaces">;
  projectId: Id<"videoProjects">;
  draftId: Id<"videoDrafts">;
  revision: string;
  locked: boolean;
  unsaved: boolean;
  onPatch: (value: Partial<Shot>) => void;
}) {
  const sceneMotion = normalizeCameraMovement(scene.visual.motion);
  return (
    <div className="video-beat-editor">
      <TextInput
        id={`shot-purpose-${shotId}`}
        label="Shot purpose"
        labelVisible
        readOnly={locked}
        value={shot.purpose}
        onChange={(event) => onPatch({ purpose: event.target.value })}
      />
      <RadioCards
        label="Production method"
        name={`shot-method-${shotId}`}
        disabled={locked}
        value={shot.method}
        onChange={(method) => onPatch({ method })}
        options={[
          {
            value: "remotion",
            label: "Remotion",
            description: "Designed motion",
            icon: Clapperboard,
          },
          {
            value: "higgsfield",
            label: "AI motion",
            description: "Animate an image",
            icon: Sparkles,
          },
          {
            value: "recording",
            label: "Recording",
            description: "Use real footage",
            icon: Video,
          },
        ]}
      />
      <TextInput
        id={`shot-action-${shotId}`}
        label="Subject action"
        labelVisible
        readOnly={locked}
        value={shot.subjectAction}
        onChange={(event) => onPatch({ subjectAction: event.target.value })}
      />
      <Select
        id={`shot-camera-${shotId}`}
        label="Camera"
        labelVisible
        disabled={locked}
        value={normalizeCameraMovement(shot.cameraMotion)}
        onChange={(event) => onPatch({ cameraMotion: event.target.value })}
        options={[
          {
            value: "",
            label: sceneMotion
              ? `Same as scene (${motionName(sceneMotion)})`
              : "Same as scene",
          },
          ...CAMERA_MOVEMENTS.map((value) => ({ value, label: motionName(value) })),
        ]}
      />
      <details className="video-advanced">
        <summary>Constraints</summary>
        <label className="video-field" htmlFor={`shot-constraints-${shotId}`}>
          Immutable constraints
          <textarea
            id={`shot-constraints-${shotId}`}
            aria-label="Immutable constraints"
            readOnly={locked}
            value={shot.constraints.join("\n")}
            onChange={(event) =>
              onPatch({ constraints: event.target.value.split("\n").filter(Boolean) })
            }
          />
        </label>
      </details>
      <ShotStartImage
        workspaceId={workspaceId}
        source={shot.startImage as PinnedImage | undefined}
        onSelected={(asset) => onPatch({ startImage: asset })}
        disabled={locked}
      />
      <ShotCandidates
        key={`${sceneId}/${shotId}`}
        workspaceId={workspaceId}
        projectId={projectId}
        draftId={draftId}
        sceneId={sceneId}
        shotId={shotId}
        revision={revision}
        shot={shot}
        sceneMotion={scene.visual.motion}
        disabled={locked || unsaved}
        onSelect={(asset, reason, jobId) =>
          onPatch({
            selectedVideo: asset,
            selectedVideoReason: reason,
            selectedVideoJobId: jobId,
          })
        }
      />
    </div>
  );
}

function productionMethod(method: Shot["method"] | undefined) {
  if (method === "higgsfield") return "AI motion";
  if (method === "recording") return "Recording";
  return "Remotion";
}

function motionName(value: string) {
  if (value === "push-in") return "Push in";
  if (value === "pull-out") return "Pull out";
  if (value === "static") return "Static";
  return value;
}

function shotMotionLabel(shot: Shot, scene: Scene) {
  const own = normalizeCameraMovement(shot.cameraMotion);
  if (own) return motionName(own);
  const inherited = normalizeCameraMovement(scene.visual.motion);
  return inherited ? `${motionName(inherited)} (scene)` : "";
}
