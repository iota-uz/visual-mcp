import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Minus,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState } from "react";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import { ConfirmButton } from "../ConfirmButton";
import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
import { RadioCards } from "../ui/RadioCards";
import { Select, TextInput } from "../ui/TextInput";

const framingOptions = [
  { value: "", label: "Not set" },
  { value: "Extreme wide", label: "Extreme wide" },
  { value: "Wide", label: "Wide" },
  { value: "Medium", label: "Medium" },
  { value: "Close-up", label: "Close-up" },
  { value: "Extreme close-up", label: "Extreme close-up" },
];

const movementOptions = [
  { value: "static", label: "Static", description: "Locked frame", icon: Minus },
  { value: "push-in", label: "Push in", description: "Move closer", icon: ZoomIn },
  { value: "pull-out", label: "Pull out", description: "Reveal context", icon: ZoomOut },
] as const;

export function StoryboardEditor({
  document,
  onChange,
  disabled,
  selectedId,
  onSelect,
  onOpenShot,
  showSceneNavigator = true,
}: {
  document: ScriptDocument;
  onChange: (next: ScriptDocument) => void;
  disabled: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onOpenShot?: (shotId: string) => void;
  showSceneNavigator?: boolean;
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
        <div className="video-section-title">
          <h2>Storyboard</h2>
          <span>
            {scene
              ? `Scene ${document.sceneOrder.indexOf(id ?? "") + 1} of ${document.sceneOrder.length}`
              : "Start with the opening scene"}
          </span>
        </div>
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
                <Menu
                  label={`Actions for scene ${document.sceneOrder.indexOf(id) + 1}`}
                  items={[
                    {
                      id: "delete-scene",
                      label: "Delete scene…",
                      icon: Trash2,
                      danger: true,
                      disabled,
                      onSelect: () => setConfirmDelete(true),
                    },
                  ]}
                />
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
      {showSceneNavigator && (
        <SceneNavigator document={document} selectedId={id} onSelect={select} />
      )}
      {!scene ? (
        <div className="video-story-empty">
          <ClapperboardMark />
          <div>
            <h3>Plan the opening scene</h3>
            <p>
              Give it a purpose, narration, and visual direction before choosing how to produce the
              shot.
            </p>
          </div>
          <Button icon={Plus} onClick={addScene} disabled={disabled} variant="primary">
            Add opening scene
          </Button>
        </div>
      ) : (
        <div className="video-scene-editor" key={id}>
          <div className="video-scene-editor-heading">
            <div>
              <span>Editing scene {document.sceneOrder.indexOf(id ?? "") + 1}</span>
              <strong>{scene.purpose || "Untitled scene"}</strong>
            </div>
            <SceneReadiness scene={scene} />
          </div>
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
          <section className="video-camera-direction" aria-label="Camera direction">
            <div className="video-camera-direction-heading">
              <strong>Camera direction</strong>
              <span>Controls how the scene is composed and moves</span>
            </div>
            <Select
              id="scene-shot"
              label="Framing"
              labelVisible
              value={framingValue(scene.visual.shot)}
              onChange={(event) => patch({ visual: { ...scene.visual, shot: event.target.value } })}
              disabled={disabled}
              options={framingOptionsWithLegacy(scene.visual.shot)}
            />
            <RadioCards
              label="Movement"
              hint="Choose the motion applied to this scene."
              name={`scene-motion-${id}`}
              value={movementValue(scene.visual.motion)}
              options={[...movementOptions]}
              disabled={disabled}
              onChange={(motion) => patch({ visual: { ...scene.visual, motion } })}
            />
          </section>
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

function framingValue(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized || normalized === "imported" || normalized === "unspecified") return "";
  if (normalized === "extreme wide" || normalized === "extreme-wide") return "Extreme wide";
  if (normalized === "wide") return "Wide";
  if (normalized === "medium") return "Medium";
  if (normalized === "closeup" || normalized === "close-up") return "Close-up";
  if (normalized === "extreme closeup" || normalized === "extreme close-up")
    return "Extreme close-up";
  return value;
}

function framingOptionsWithLegacy(value: string) {
  const current = framingValue(value);
  if (!current || framingOptions.some((option) => option.value === current)) return framingOptions;
  return [{ value: current, label: `Current: ${current}` }, ...framingOptions];
}

function movementValue(value: string): "static" | "push-in" | "pull-out" | "" {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  if (normalized === "static" || normalized === "locked" || normalized === "none") return "static";
  if (normalized === "push-in" || normalized === "pushin") return "push-in";
  if (normalized === "pull-out" || normalized === "pullout") return "pull-out";
  return "";
}

export function SceneNavigator({
  document,
  selectedId,
  onSelect,
}: {
  document: ScriptDocument;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="video-scene-navigator" aria-label="Scenes">
      <div className="video-scene-navigator-heading">
        <strong>Scenes</strong>
        <span>{document.sceneOrder.length}</span>
      </div>
      <div className="video-scene-list">
        {document.sceneOrder.map((sceneId, index) => {
          const scene = document.scenesById[sceneId];
          const ready = scene ? sceneReadiness(scene).ready : false;
          return (
            <button
              type="button"
              className="video-scene-card"
              key={sceneId}
              aria-current={selectedId === sceneId ? "true" : undefined}
              onClick={() => onSelect(sceneId)}
            >
              <span className="video-scene-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="video-scene-copy">
                <strong>{scene?.purpose || "Untitled scene"}</strong>
                <small>
                  {scene?.shotOrder.length
                    ? `${scene.shotOrder.length} shot${scene.shotOrder.length === 1 ? "" : "s"}`
                    : scene?.narration || "Narration and shots needed"}
                </small>
              </span>
              {ready ? (
                <CheckCircle2 size={15} aria-label="Scene brief ready" />
              ) : (
                <Circle size={15} aria-label="Scene brief incomplete" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SceneReadiness({ scene }: { scene: ScriptDocument["scenesById"][string] }) {
  const readiness = sceneReadiness(scene);
  return (
    <span className={`video-scene-readiness${readiness.ready ? " is-ready" : ""}`}>
      {readiness.ready ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      {readiness.complete}/3 brief fields
    </span>
  );
}

function sceneReadiness(scene: ScriptDocument["scenesById"][string]) {
  const complete = [scene.purpose, scene.narration, scene.visual.description].filter((value) =>
    value.trim(),
  ).length;
  return { complete, ready: complete === 3 };
}

function ClapperboardMark() {
  return (
    <span className="video-story-empty-mark" aria-hidden="true">
      01
    </span>
  );
}
