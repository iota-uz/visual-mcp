import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import { ConfirmButton } from "../ConfirmButton";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

export function StoryboardEditor({
  document,
  onChange,
  disabled,
  selectedId,
  onSelect,
  onOpenShot,
}: {
  document: ScriptDocument;
  onChange: (next: ScriptDocument) => void;
  disabled: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onOpenShot?: (shotId: string) => void;
}) {
  const [localSelected, setLocalSelected] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = selectedId ?? localSelected;
  const id = selected && document.scenesById[selected] ? selected : document.sceneOrder[0];
  function select(next: string) {
    onSelect?.(next);
    setLocalSelected(next);
  }
  const scene = id ? document.scenesById[id] : undefined;
  function addScene() {
    const newId = `scene_${crypto.randomUUID().replaceAll("-", "")}`;
    onChange({
      ...document,
      sceneOrder: [...document.sceneOrder, newId],
      scenesById: {
        ...document.scenesById,
        [newId]: {
          purpose: "",
          narration: "",
          onScreenText: [],
          visual: { description: "", shot: "", motion: "", keyframeOrder: [], keyframesById: {} },
          shotOrder: [],
          shotsById: {},
          claims: [],
        },
      },
    });
    select(newId);
  }
  function move(delta: number) {
    if (!id) return;
    const index = document.sceneOrder.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= document.sceneOrder.length) return;
    const order = [...document.sceneOrder];
    const scene = order[index];
    if (!scene) return;
    order.splice(index, 1);
    order.splice(next, 0, scene);
    onChange({ ...document, sceneOrder: order });
  }
  function removeScene() {
    if (!id) return;
    const { [id]: _removed, ...scenesById } = document.scenesById;
    const sceneOrder = document.sceneOrder.filter((sceneId) => sceneId !== id);
    onChange({ ...document, sceneOrder, scenesById });
    select(sceneOrder[0] ?? "");
    setConfirmDelete(false);
  }
  function patch(patch: Partial<ScriptDocument["scenesById"][string]>) {
    if (id && scene)
      onChange({
        ...document,
        scenesById: { ...document.scenesById, [id]: { ...scene, ...patch } },
      });
  }
  return (
    <section className="video-storyboard" aria-label="Storyboard">
      <div className="video-section-heading">
        <h2>Storyboard</h2>
        <div className="video-actions">
          <Button
            icon={Plus}
            size="sm"
            onClick={addScene}
            disabled={disabled || document.sceneOrder.length >= 100}
          >
            Add scene
          </Button>
          {id && (
            <>
              <Button
                size="sm"
                icon={ChevronLeft}
                disabled={disabled || document.sceneOrder.indexOf(id) <= 0}
                onClick={() => move(-1)}
              >
                Earlier
              </Button>
              <Button
                size="sm"
                iconEnd={ChevronRight}
                disabled={
                  disabled || document.sceneOrder.indexOf(id) >= document.sceneOrder.length - 1
                }
                onClick={() => move(1)}
              >
                Later
              </Button>
              {confirmDelete ? (
                <ConfirmButton
                  defaultArmed
                  confirmLabel="Delete scene"
                  description="Removes this scene from the draft. Shots planned on it are lost."
                  onDisarm={() => setConfirmDelete(false)}
                  onConfirm={async () => removeScene()}
                />
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  icon={Trash2}
                  disabled={disabled}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete scene
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="video-field video-premise-field">
        <span className="video-field-heading">
          <label htmlFor="script-premise">Main idea</label>
          <span className="video-hint" id="script-premise-hint">
            The creative brief that keeps every scene aligned
          </span>
        </span>
        <textarea
          id="script-premise"
          aria-describedby="script-premise-hint"
          rows={4}
          value={document.premise}
          onChange={(event) => onChange({ ...document, premise: event.target.value })}
          readOnly={disabled}
          maxLength={16000}
          placeholder="Describe the premise, audience, hook, and intended outcome…"
        />
      </div>
      <nav className="video-scene-strip" aria-label="Scenes">
        {document.sceneOrder.map((sceneId, index) => (
          <button
            type="button"
            className="video-scene-card"
            key={sceneId}
            aria-pressed={id === sceneId}
            onClick={() => select(sceneId)}
          >
            <span className="video-scene-number">Scene {index + 1}</span>
            <strong>{document.scenesById[sceneId]?.purpose || "Untitled scene"}</strong>
            <span>
              {document.scenesById[sceneId]?.narration || "Add narration and a visual direction"}
            </span>
          </button>
        ))}
      </nav>
      {!scene ? (
        <p className="video-hint">
          Add the opening scene. Describe its purpose before choosing how to produce it.
        </p>
      ) : (
        <div className="video-scene-editor" key={id}>
          <TextInput
            id="scene-purpose"
            label="Scene purpose"
            labelVisible
            value={scene.purpose}
            onChange={(event) => patch({ purpose: event.target.value })}
            readOnly={disabled}
            maxLength={16000}
          />
          <label className="video-field" htmlFor="scene-narration">
            Narration
            <textarea
              id="scene-narration"
              lang={document.language}
              rows={5}
              value={scene.narration}
              onChange={(event) => patch({ narration: event.target.value })}
              readOnly={disabled}
              maxLength={16000}
            />
          </label>
          <label className="video-field" htmlFor="scene-text">
            On-screen text <span className="video-hint">One line per caption</span>
            <textarea
              id="scene-text"
              rows={3}
              value={scene.onScreenText.join("\n")}
              onChange={(event) => patch({ onScreenText: event.target.value.split("\n") })}
              readOnly={disabled}
            />
          </label>
          <label className="video-field" htmlFor="scene-visual">
            Visual direction
            <textarea
              id="scene-visual"
              rows={3}
              value={scene.visual.description}
              onChange={(event) =>
                patch({ visual: { ...scene.visual, description: event.target.value } })
              }
              readOnly={disabled}
              maxLength={16000}
            />
          </label>
          <div className="video-field-pair">
            <TextInput
              id="scene-shot"
              label="Framing"
              labelVisible
              value={scene.visual.shot}
              onChange={(event) => patch({ visual: { ...scene.visual, shot: event.target.value } })}
              readOnly={disabled}
            />
            <TextInput
              id="scene-motion"
              label="Movement"
              labelVisible
              value={scene.visual.motion}
              onChange={(event) =>
                patch({ visual: { ...scene.visual, motion: event.target.value } })
              }
              readOnly={disabled}
            />
          </div>
          {scene.shotOrder.length > 0 && (
            <div className="video-shot-list">
              <h3>Planned shots</h3>
              {scene.shotOrder.map((shotId) => {
                const shot = scene.shotsById[shotId];
                if (!shot) return null;
                return (
                  <article className="video-shot" key={shotId}>
                    <strong>{shot.purpose || "Untitled shot"}</strong>
                    <span>
                      {shot.method === "higgsfield"
                        ? "Generative motion"
                        : shot.method === "recording"
                          ? "Recorded footage"
                          : "Remotion"}
                    </span>
                    <p>{shot.subjectAction}</p>
                    {shot.selectedVideo && (
                      <p className="video-hint">Candidate chosen for this shot.</p>
                    )}
                    {onOpenShot && (
                      <Button size="sm" onClick={() => onOpenShot(shotId)}>
                        Open in Shots
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
