import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  FRAMING_OPTIONS,
  normalizeCameraMovement,
  normalizeFraming,
} from "../../../../../packages/video/src/camera";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import { ConfirmButton } from "../ConfirmButton";
import { Button } from "../ui/Button";
import { useContextMenuTrigger } from "../ui/ContextMenu";
import { TextInput } from "../ui/TextInput";
import { CameraDirection } from "./story/CameraDirection";

type Scene = ScriptDocument["scenesById"][string];

export function StoryboardEditor({
  document,
  onChange,
  disabled,
  selectedId,
  onSelect,
  onOpenShot,
  onReorderScenes,
  onDeleteScene,
  scenesLocked,
}: {
  document: ScriptDocument;
  onChange: (next: ScriptDocument) => void;
  disabled: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onOpenShot?: (shotId: string) => void;
  onReorderScenes?: (order: string[]) => void;
  onDeleteScene?: (id: string) => void;
  scenesLocked?: boolean;
}) {
  const [localSelected, setLocalSelected] = useState<string>();
  const [expandedId, setExpandedId] = useState<string>();
  const [premiseOpen, setPremiseOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const [overId, setOverId] = useState<string>();
  const dragged = useRef(false);
  const boardRef = useRef<HTMLElement>(null);
  const selected = selectedId ?? localSelected;
  const highlighted = selected && document.scenesById[selected] ? selected : document.sceneOrder[0];
  const locked = disabled || scenesLocked;
  const sortable = Boolean(onReorderScenes || onChange) && !locked && document.sceneOrder.length > 1;

  function select(next: string) {
    onSelect?.(next);
    setLocalSelected(next);
  }

  function reorder(order: string[]) {
    if (onReorderScenes) onReorderScenes(order);
    else onChange({ ...document, sceneOrder: order });
  }

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
    setExpandedId(newId);
  }

  function removeScene(id: string) {
    if (onDeleteScene) {
      onDeleteScene(id);
      setConfirmDelete(undefined);
      return;
    }
    const { [id]: _removed, ...scenesById } = document.scenesById;
    const sceneOrder = document.sceneOrder.filter((sceneId) => sceneId !== id);
    onChange({ ...document, sceneOrder, scenesById });
    if (highlighted === id) select(sceneOrder[0] ?? "");
    if (expandedId === id) setExpandedId(undefined);
    setConfirmDelete(undefined);
  }

  function patchScene(id: string, patch: Partial<Scene>) {
    const scene = document.scenesById[id];
    if (!scene) return;
    onChange({
      ...document,
      scenesById: { ...document.scenesById, [id]: { ...scene, ...patch } },
    });
  }

  function dropOn(targetId: string) {
    if (!dragId) return;
    const next = placeScene(document.sceneOrder, dragId, targetId);
    if (next) reorder(next);
  }

  function clearDrag() {
    setDragId(undefined);
    setOverId(undefined);
    window.setTimeout(() => {
      dragged.current = false;
    }, 0);
  }

  const { triggerProps, menu } = useContextMenuTrigger({
    resolveAnchor: (target) => {
      const element = target instanceof HTMLElement ? target : null;
      const card = element?.closest("[data-scene-id]");
      return card instanceof HTMLElement ? card : null;
    },
    getMenu: (anchor) => {
      const sceneId = anchor.dataset.sceneId;
      if (!sceneId || !document.scenesById[sceneId] || locked) return null;
      select(sceneId);
      const index = document.sceneOrder.indexOf(sceneId);
      return {
        label: `Scene ${index + 1} actions`,
        items: [
          {
            id: "delete",
            label: "Delete scene…",
            icon: Trash2,
            danger: true,
            disabled: locked,
            onSelect: () => {
              if (onDeleteScene) onDeleteScene(sceneId);
              else setConfirmDelete(sceneId);
            },
          },
        ],
      };
    },
  });

  useEffect(() => {
    if (!highlighted) return;
    const node = boardRef.current?.querySelector(`[data-scene-id="${CSS.escape(highlighted)}"]`);
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  useEffect(() => {
    if (!expandedId) return;
    const purpose = boardRef.current?.querySelector<HTMLInputElement>(
      `#scene-purpose-${CSS.escape(expandedId)}`,
    );
    purpose?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setExpandedId(undefined);
    }
    globalThis.document.addEventListener("keydown", onKey);
    return () => globalThis.document.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const empty = document.sceneOrder.length === 0;

  return (
    <section
      ref={boardRef}
      className="video-storyboard"
      aria-label="Story"
      {...triggerProps}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expandedId) {
          setExpandedId(undefined);
        }
      }}
    >
      <Premise
        value={document.premise}
        disabled={disabled}
        open={premiseOpen}
        onOpen={() => setPremiseOpen(true)}
        onChange={(premise) => onChange({ ...document, premise })}
      />
      {empty ? (
        <div className="video-story-empty">
          <span className="video-beat-frame" aria-hidden="true" />
          <div>
            <h3>Plan the opening scene</h3>
            <p>Write the beat you can read at a glance, then open it to edit.</p>
          </div>
          <Button icon={Plus} onClick={addScene} disabled={disabled} variant="primary">
            Add opening scene
          </Button>
        </div>
      ) : (
        <ol className="video-beat-list">
          {document.sceneOrder.map((sceneId, index) => {
            const scene = document.scenesById[sceneId];
            if (!scene) return null;
            const expanded = expandedId === sceneId && !disabled;
            const current = highlighted === sceneId;
            const dropTarget = Boolean(dragId && dragId !== sceneId && overId === sceneId);
            return (
              <li
                key={sceneId}
                data-scene-id={sceneId}
                className={`video-beat${dragId === sceneId ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}${expanded ? " is-expanded" : ""}${current ? " is-current" : ""}`}
                onDragOver={(event) => {
                  if (!dragId || dragId === sceneId) return;
                  event.preventDefault();
                  setOverId(sceneId);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropOn(sceneId);
                  clearDrag();
                }}
                onDragEnd={clearDrag}
                onKeyDown={(event) => {
                  if (!sortable || !event.altKey) return;
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    const next = nudgeScene(
                      document.sceneOrder,
                      sceneId,
                      event.key === "ArrowUp" ? -1 : 1,
                    );
                    if (next) reorder(next);
                  }
                }}
              >
                <BeatFrame scene={scene} />
                <div className="video-beat-body">
                  <div className="video-beat-index-row">
                    {sortable ? (
                      <button
                        type="button"
                        className="video-beat-handle"
                        draggable
                        aria-label={`Reorder scene ${index + 1}`}
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        title="Drag to reorder"
                        onClick={() => {
                          if (dragged.current) return;
                          select(sceneId);
                        }}
                        onDragStart={(event) => {
                          dragged.current = true;
                          setDragId(sceneId);
                          select(sceneId);
                          event.dataTransfer?.setData("text/plain", sceneId);
                          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </button>
                    ) : (
                      <span className="video-beat-handle" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    )}
                    <SceneDot scene={scene} />
                    {expanded && (
                      <Button size="sm" onClick={() => setExpandedId(undefined)}>
                        Done
                      </Button>
                    )}
                  </div>
                  {expanded ? (
                    <BeatEditor
                      id={sceneId}
                      scene={scene}
                      language={document.language}
                      disabled={disabled}
                      onPatch={(patch) => patchScene(sceneId, patch)}
                      onOpenShot={onOpenShot}
                    />
                  ) : disabled ? (
                    <BeatRead scene={scene} />
                  ) : (
                    <button
                      type="button"
                      className="video-beat-open"
                      aria-expanded="false"
                      aria-current={current ? "true" : undefined}
                      onClick={() => {
                        select(sceneId);
                        setExpandedId(sceneId);
                      }}
                    >
                      <span className="visually-hidden">Edit scene {index + 1}. </span>
                      <BeatRead scene={scene} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {!disabled && !empty && (
        <Button
          icon={Plus}
          className="video-beat-add"
          onClick={addScene}
          disabled={document.sceneOrder.length >= 100}
        >
          Add scene
        </Button>
      )}
      {sortable && <p className="video-beat-drag-hint">Drag a number to reorder · Alt + arrow keys</p>}
      {confirmDelete && (
        <ConfirmButton
          defaultArmed
          confirmLabel="Delete scene"
          description="Removes this scene from the draft. Shots planned on it are lost."
          onDisarm={() => setConfirmDelete(undefined)}
          onConfirm={async () => removeScene(confirmDelete)}
        />
      )}
      {menu}
    </section>
  );
}

function Premise({
  value,
  disabled,
  open,
  onOpen,
  onChange,
}: {
  value: string;
  disabled: boolean;
  open: boolean;
  onOpen: () => void;
  onChange: (value: string) => void;
}) {
  const id = useId();
  if (disabled) {
    return value.trim() ? <p className="video-story-premise is-static">{value}</p> : null;
  }
  if (!open) {
    return (
      <button type="button" className="video-story-premise" onClick={onOpen}>
        {value.trim() || "Add the main idea"}
      </button>
    );
  }
  return (
    <label className="video-field video-premise-field" htmlFor={id}>
      Main idea
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={16000}
        placeholder="The logline that keeps every scene aligned"
      />
    </label>
  );
}

function BeatFrame({ scene }: { scene: Scene }) {
  const lines = beatFrameLines(scene);
  return (
    <div className="video-beat-frame" aria-hidden="true">
      {lines.length > 0 ? (
        <span className="video-beat-frame-copy">
          {lines.map((line, lineIndex) => (
            <span key={`${lineIndex}-${line}`}>{line}</span>
          ))}
        </span>
      ) : (
        <span className="video-beat-frame-empty" />
      )}
    </div>
  );
}

function BeatRead({ scene }: { scene: Scene }) {
  const purpose = scene.purpose.trim() || "Untitled scene";
  const narration = scene.narration.trim();
  const meta = beatMeta(scene);
  return (
    <span className="video-beat-read">
      <strong className="video-beat-purpose">{purpose}</strong>
      {narration ? <span className="video-beat-narration">{narration}</span> : null}
      {meta ? <span className="video-beat-meta">{meta}</span> : null}
    </span>
  );
}

function BeatEditor({
  id,
  scene,
  language,
  disabled,
  onPatch,
  onOpenShot,
}: {
  id: string;
  scene: Scene;
  language: ScriptDocument["language"];
  disabled: boolean;
  onPatch: (patch: Partial<Scene>) => void;
  onOpenShot?: (shotId: string) => void;
}) {
  return (
    <div className="video-beat-editor">
      <TextInput
        id={`scene-purpose-${id}`}
        label="Scene purpose"
        labelVisible
        value={scene.purpose}
        onChange={(event) => onPatch({ purpose: event.target.value })}
        readOnly={disabled}
        maxLength={16000}
      />
      <label className="video-field" htmlFor={`scene-narration-${id}`}>
        Narration
        <textarea
          id={`scene-narration-${id}`}
          lang={language}
          rows={4}
          value={scene.narration}
          onChange={(event) => onPatch({ narration: event.target.value })}
          readOnly={disabled}
          maxLength={16000}
        />
      </label>
      <label className="video-field" htmlFor={`scene-text-${id}`}>
        On-screen text <span className="video-hint">One line per caption</span>
        <textarea
          id={`scene-text-${id}`}
          rows={3}
          value={scene.onScreenText.join("\n")}
          onChange={(event) => onPatch({ onScreenText: event.target.value.split("\n") })}
          readOnly={disabled}
          maxLength={16000}
        />
      </label>
      <label className="video-field" htmlFor={`scene-visual-${id}`}>
        Visual direction
        <textarea
          id={`scene-visual-${id}`}
          rows={3}
          value={scene.visual.description}
          onChange={(event) =>
            onPatch({ visual: { ...scene.visual, description: event.target.value } })
          }
          readOnly={disabled}
          maxLength={16000}
        />
      </label>
      <CameraDirection
        sceneId={id}
        framing={scene.visual.shot}
        movement={scene.visual.motion}
        disabled={disabled}
        onFraming={(shot) => onPatch({ visual: { ...scene.visual, shot } })}
        onMovement={(motion) => onPatch({ visual: { ...scene.visual, motion } })}
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
                {shot.selectedVideo && <p className="video-hint">Candidate chosen for this shot.</p>}
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
  );
}

function SceneDot({ scene }: { scene: Scene }) {
  const ready = sceneReadiness(scene).ready;
  return ready ? (
    <CheckCircle2 size={14} aria-label="Scene brief ready" />
  ) : (
    <Circle size={14} aria-label="Scene brief incomplete" />
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
  function reorder(targetId: string) {
    if (!onReorderScenes || !dragId) return;
    const next = placeScene(document.sceneOrder, dragId, targetId);
    if (next) onReorderScenes(next);
  }
  function nudge(sceneId: string, delta: -1 | 1) {
    if (!onReorderScenes) return;
    const next = nudgeScene(document.sceneOrder, sceneId, delta);
    if (next) onReorderScenes(next);
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

function sceneReadiness(scene: Scene) {
  const complete = [scene.purpose, scene.narration, scene.visual.description].filter((value) =>
    value.trim(),
  ).length;
  return { complete, ready: complete === 3 };
}

function beatFrameLines(scene: Scene) {
  const captions = scene.onScreenText.map((line) => line.trim()).filter(Boolean);
  if (captions.length) return captions.slice(0, 4);
  const visual = scene.visual.description.trim();
  return visual ? [visual] : [];
}

function beatMeta(scene: Scene) {
  const hasCaptions = scene.onScreenText.some((line) => line.trim());
  return [
    hasCaptions ? scene.visual.description.trim() : "",
    framingLabel(scene.visual.shot),
    motionLabel(scene.visual.motion),
  ]
    .filter(Boolean)
    .join(" · ");
}

function framingLabel(value: string) {
  const normalized = normalizeFraming(value);
  if (normalized) return FRAMING_OPTIONS.find((option) => option.value === normalized)?.label ?? "";
  const legacy = value.trim();
  if (!legacy || legacy.toLowerCase() === "imported" || legacy.toLowerCase() === "unspecified")
    return "";
  return legacy;
}

function motionLabel(value: string) {
  const motion = normalizeCameraMovement(value);
  if (motion === "push-in") return "Push in";
  if (motion === "pull-out") return "Pull out";
  if (motion === "static") return "Static";
  return "";
}

function placeScene(order: string[], dragId: string, targetId: string) {
  if (dragId === targetId) return null;
  const next = [...order];
  const from = next.indexOf(dragId);
  const to = next.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(to, 0, moved);
  return next;
}

function nudgeScene(order: string[], sceneId: string, delta: -1 | 1) {
  const from = order.indexOf(sceneId);
  const target = order[from + delta];
  if (!target) return null;
  return placeScene(order, sceneId, target);
}
