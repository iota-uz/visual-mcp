import { Plus } from "lucide-react";
import { useState } from "react";
import type { ScriptDocument } from "../../../../../packages/video/src/contracts";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

export function StoryboardEditor({
  document,
  onChange,
  disabled,
}: {
  document: ScriptDocument;
  onChange: (next: ScriptDocument) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const id = selected && document.scenesById[selected] ? selected : document.sceneOrder[0];
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
    setSelected(newId);
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
        <Button
          icon={Plus}
          size="sm"
          onClick={addScene}
          disabled={disabled || document.sceneOrder.length >= 100}
        >
          Add scene
        </Button>
      </div>
      <TextInput
        id="script-premise"
        label="Main idea"
        labelVisible
        value={document.premise}
        onChange={(event) => onChange({ ...document, premise: event.target.value })}
        readOnly={disabled}
        maxLength={16000}
      />
      <nav className="video-scene-strip" aria-label="Scenes">
        {document.sceneOrder.map((sceneId, index) => (
          <button
            type="button"
            className="video-scene-card"
            key={sceneId}
            aria-pressed={id === sceneId}
            onClick={() => setSelected(sceneId)}
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
                    <strong>{shot.purpose || shotId}</strong>
                    <span>
                      {shot.method === "higgsfield"
                        ? "Generative motion"
                        : shot.method === "recording"
                          ? "Recorded footage"
                          : "Remotion"}
                    </span>
                    <p>{shot.subjectAction}</p>
                    <p className="video-hint">Camera: {shot.cameraMotion || "Not specified"}</p>
                    {shot.startImage && (
                      <p className="video-hint">Pinned keyframe: {shot.startImage.assetId}</p>
                    )}
                    {shot.selectedVideo && (
                      <p className="video-hint">
                        Selected clip: {shot.selectedVideo.assetId}. Selection is not approval.
                      </p>
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
