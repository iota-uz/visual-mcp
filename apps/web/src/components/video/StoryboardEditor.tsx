import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import { ConfirmButton } from "../ConfirmButton";
import { Button } from "../ui/Button";
import { useContextMenuTrigger } from "../ui/ContextMenu";
import { Menu } from "../ui/Menu";
import { TextInput } from "../ui/TextInput";
import { CameraDirection } from "./story/CameraDirection";

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
          {id &&
            (confirmDelete ? (
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
            ))}
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
        <SceneNavigator
          document={document}
          selectedId={id}
          onSelect={select}
          onReorderScenes={(sceneOrder) => onChange({ ...document, sceneOrder })}
          scenesLocked={disabled}
        />
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
              <span>
                Editing scene {document.sceneOrder.indexOf(id ?? "") + 1} of{" "}
                {document.sceneOrder.length}
              </span>
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
          <CameraDirection
            sceneId={id ?? "selected"}
            framing={scene.visual.shot}
            movement={scene.visual.motion}
            disabled={disabled}
            onFraming={(shot) => patch({ visual: { ...scene.visual, shot } })}
            onMovement={(motion) => patch({ visual: { ...scene.visual, motion } })}
          />
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

export function SceneNavigator({
  document,
  selectedId,
  onSelect,
  onReorderScenes,
  onDeleteScene,
  scenesLocked,
}: {
  document: ScriptDocument;
  selectedId?: string;
  onSelect: (id: string) => void;
  onReorderScenes?: (order: string[]) => void;
  onDeleteScene?: (id: string) => void;
  scenesLocked?: boolean;
}) {
  const [dragId, setDragId] = useState<string>();
  const [overId, setOverId] = useState<string>();
  const sortable = Boolean(onReorderScenes) && !scenesLocked && document.sceneOrder.length > 1;
  // Dropping a card onto another takes that card's place: the dragged scene
  // is inserted at the target's index in the original order.
  function reorder(targetId: string) {
    if (!onReorderScenes || !dragId || dragId === targetId) return;
    const order = [...document.sceneOrder];
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = order.splice(from, 1);
    if (!moved) return;
    order.splice(to, 0, moved);
    onReorderScenes(order);
  }
  function nudge(sceneId: string, delta: -1 | 1) {
    if (!onReorderScenes) return;
    const order = [...document.sceneOrder];
    const from = order.indexOf(sceneId);
    const next = from + delta;
    if (from < 0 || next < 0 || next >= order.length) return;
    const [moved] = order.splice(from, 1);
    if (!moved) return;
    order.splice(next, 0, moved);
    onReorderScenes(order);
  }
  function clearDrag() {
    setDragId(undefined);
    setOverId(undefined);
  }
  const { triggerProps, menu } = useContextMenuTrigger({
    resolveAnchor: (target) => {
      const element = target instanceof HTMLElement ? target : null;
      const card = element?.closest("[data-scene-id]");
      return card instanceof HTMLElement ? card : null;
    },
    getMenu: (anchor) => {
      const sceneId = anchor.dataset.sceneId;
      const scene = sceneId ? document.scenesById[sceneId] : undefined;
      if (!sceneId || !scene || !onDeleteScene) return null;
      onSelect(sceneId);
      const index = document.sceneOrder.indexOf(sceneId);
      return {
        label: `Scene ${index + 1} actions`,
        items: [
          {
            id: "delete",
            label: "Delete scene…",
            icon: Trash2,
            danger: true,
            disabled: scenesLocked,
            onSelect: () => onDeleteScene(sceneId),
          },
        ],
      };
    },
  });
  return (
    <nav className="video-scene-navigator" aria-label="Scenes" {...triggerProps}>
      <div className="video-scene-navigator-heading">
        <strong>Scenes</strong>
        <span>{document.sceneOrder.length}</span>
      </div>
      {sortable && (
        <p className="video-scene-drag-hint">Drag to reorder · Alt + arrow keys move a scene</p>
      )}
      <ul className="video-scene-list">
        {document.sceneOrder.map((sceneId, index) => {
          const scene = document.scenesById[sceneId];
          const ready = scene ? sceneReadiness(scene).ready : false;
          const dropTarget = Boolean(dragId && dragId !== sceneId && overId === sceneId);
          return (
            <li
              key={sceneId}
              data-scene-id={sceneId}
              className={`video-scene-item${dragId === sceneId ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}`}
              draggable={sortable ? true : undefined}
              onDragStart={(event) => {
                setDragId(sceneId);
                // Firefox only starts a drag when the payload is set.
                event.dataTransfer?.setData("text/plain", sceneId);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (!dragId || dragId === sceneId) return;
                event.preventDefault();
                setOverId(sceneId);
              }}
              onDrop={(event) => {
                event.preventDefault();
                reorder(sceneId);
                clearDrag();
              }}
              onDragEnd={clearDrag}
            >
              <button
                type="button"
                className="video-scene-card"
                aria-current={selectedId === sceneId ? "true" : undefined}
                aria-keyshortcuts={sortable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                title={scene?.purpose || "Untitled scene"}
                onClick={() => onSelect(sceneId)}
                onKeyDown={(event) => {
                  if (!sortable || !event.altKey) return;
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    nudge(sceneId, -1);
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    nudge(sceneId, 1);
                  }
                }}
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
            </li>
          );
        })}
      </ul>
      {menu}
    </nav>
  );
}

function SceneReadiness({ scene }: { scene: ScriptDocument["scenesById"][string] }) {
  const readiness = sceneReadiness(scene);
  return (
    <span className={`video-scene-readiness${readiness.ready ? " is-ready" : ""}`}>
      {readiness.ready ? (
        <CheckCircle2 size={14} aria-hidden="true" />
      ) : (
        <Circle size={14} aria-hidden="true" />
      )}
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
