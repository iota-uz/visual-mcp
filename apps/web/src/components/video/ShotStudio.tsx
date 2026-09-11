import { CheckCircle2, Circle, Clapperboard, Film, Plus, Sparkles, Video } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { normalizeCameraMovement } from "../../../../../packages/video/src/camera";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import type { PinnedImage } from "../SharedImageStudio";
import { Button } from "../ui/Button";
import { RadioCards } from "../ui/RadioCards";
import { Select, TextInput } from "../ui/TextInput";
import { ShotCandidates } from "./shots/ShotCandidates";
import { ShotStartImage } from "./shots/ShotStartImage";

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
  const [shotChoice, setShotChoice] = useState("");
  const requestedShot = selectedShotId && scene?.shotsById[selectedShotId] ? selectedShotId : null;
  const shotId = requestedShot ?? (scene?.shotsById[shotChoice] ? shotChoice : scene?.shotOrder[0]);
  const shot = shotId ? scene?.shotsById[shotId] : undefined;
  function selectShot(next: string) {
    setShotChoice(next);
    onSelectShot?.(next);
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
    <section className="video-shot-studio" aria-label="Shot production">
      <header className="video-shot-heading">
        <div className="video-section-title">
          <h2>Shot production</h2>
          <span>Plan the material that will become this scene</span>
        </div>
        {scene && (
          <Button
            disabled={locked || scene.shotOrder.length >= 100}
            size="sm"
            variant="primary"
            icon={Plus}
            onClick={addShot}
          >
            Add shot
          </Button>
        )}
      </header>
      {!scene ? (
        <div className="video-shot-empty">
          <Film size={28} aria-hidden="true" />
          <div>
            <h3>Add a scene before planning shots</h3>
            <p>Return to Story and describe what this part of the video needs to communicate.</p>
          </div>
        </div>
      ) : (
        <>
          <section className="video-shot-scene-context" aria-label="Selected scene context">
            <div>
              <span>Scene {document.sceneOrder.indexOf(sceneId ?? "") + 1}</span>
              <h3>{scene.purpose || "Untitled scene"}</h3>
            </div>
            <dl>
              <div>
                <dt>Narration</dt>
                <dd>{scene.narration || "Add narration in Story"}</dd>
              </div>
              <div>
                <dt>Visual direction</dt>
                <dd>{scene.visual.description || "Add visual direction in Story"}</dd>
              </div>
            </dl>
          </section>
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
          {!shot || !shotId ? (
            <div className="video-shot-empty">
              <span className="video-shot-empty-number" aria-hidden="true">
                01
              </span>
              <div>
                <h3>Plan the first shot</h3>
                <p>
                  Start with the material this scene needs. You can build it in Remotion, animate a
                  start image, or use recorded footage.
                </p>
              </div>
              <Button variant="primary" icon={Plus} onClick={addShot} disabled={locked}>
                Plan first shot
              </Button>
            </div>
          ) : (
            <div className="video-shot-workspace">
              <nav className="video-shot-navigator" aria-label="Shots in selected scene">
                <div className="video-shot-navigator-heading">
                  <strong>Shots</strong>
                  <span>{scene.shotOrder.length}</span>
                </div>
                {scene.shotOrder.map((id, index) => {
                  const item = scene.shotsById[id];
                  const ready = Boolean(item?.purpose.trim() && item.subjectAction.trim());
                  return (
                    <button
                      type="button"
                      key={id}
                      aria-current={shotId === id ? "true" : undefined}
                      title={item?.purpose || "Untitled shot"}
                      onClick={() => selectShot(id)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <span>
                        <strong>{item?.purpose || "Untitled shot"}</strong>
                        <small>{productionMethod(item?.method)}</small>
                      </span>
                      {ready ? (
                        <CheckCircle2 size={14} aria-label="Shot plan ready" />
                      ) : (
                        <Circle size={14} aria-label="Shot plan incomplete" />
                      )}
                    </button>
                  );
                })}
              </nav>
              <div className="video-shot-editor">
                <div className="video-shot-editor-heading">
                  <div>
                    <span>
                      Editing shot {scene.shotOrder.indexOf(shotId) + 1} of {scene.shotOrder.length}
                    </span>
                    <strong>{shot.purpose || "Untitled shot"}</strong>
                  </div>
                  <span>{productionMethod(shot.method)}</span>
                </div>
                <div className="vs-shot-progress" aria-hidden="true">
                  <i
                    style={{
                      width: `${Math.round(
                        ((scene.shotOrder.indexOf(shotId) + 1) /
                          Math.max(1, scene.shotOrder.length)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <TextInput
                  id="shot-purpose"
                  label="Story purpose"
                  labelVisible
                  readOnly={locked}
                  value={shot.purpose}
                  onChange={(event) => patch({ purpose: event.target.value })}
                />
                <RadioCards
                  label="Production method"
                  hint="Choose where this shot will come from."
                  name={`shot-method-${shotId}`}
                  disabled={locked}
                  value={shot.method}
                  onChange={(method) => patch({ method })}
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
                  id="shot-action"
                  label="Subject action"
                  labelVisible
                  readOnly={locked}
                  value={shot.subjectAction}
                  onChange={(event) => patch({ subjectAction: event.target.value })}
                />
                <RadioCards
                  label="Camera movement"
                  hint="Uses the same motion vocabulary in prompts and the timeline."
                  name={`shot-camera-${shotId}`}
                  disabled={locked}
                  value={normalizeCameraMovement(shot.cameraMotion)}
                  onChange={(cameraMotion) => patch({ cameraMotion })}
                  options={[
                    { value: "static", label: "Static", description: "Locked frame" },
                    { value: "push-in", label: "Push in", description: "Move closer" },
                    { value: "pull-out", label: "Pull out", description: "Reveal context" },
                  ]}
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
                <ShotStartImage
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
                  sceneId={sceneId ?? ""}
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
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function productionMethod(method: Shot["method"] | undefined) {
  if (method === "higgsfield") return "Generative motion";
  if (method === "recording") return "Recorded footage";
  return "Remotion";
}
