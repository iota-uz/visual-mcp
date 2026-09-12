import { useMutation, usePaginatedQuery, type useQuery } from "convex/react";
import { CheckCircle2, Film, Redo2, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  Script,
  Timeline,
  type ScriptDocument,
  type TimelineDocument,
} from "../../../../../packages/video/src/contracts";
import { ConfirmButton } from "../ConfirmButton";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import { Panel } from "../ui/Panel";
import { TextInput } from "../ui/TextInput";
import { RenderRequest } from "./RenderRequest";
import { ShotStudio } from "./ShotStudio";
import { SceneNavigator, StoryboardEditor } from "./StoryboardEditor";
import { TimelineEditor } from "./TimelineEditor";
import { useDocumentHistory } from "./useDocumentHistory";
import { useRevisionEditor } from "./useRevisionEditor";
import { useStudioShortcuts } from "./useStudioShortcuts";
import { useUnsavedNavigation } from "./useUnsavedNavigation";

export type StudioMode = "story" | "shots" | "timeline" | "review";

export type Project = NonNullable<ReturnType<typeof useQuery<typeof api.video.getProject>>>;
export type Draft = NonNullable<ReturnType<typeof useQuery<typeof api.video.getDraft>>>;
export type VersionSnapshot = {
  versionId: Id<"videoVersions">;
  label: string;
  language: "ru" | "uz";
  script: ScriptDocument;
  timeline: TimelineDocument;
};

export function DraftStudio({
  project,
  draft,
  mode,
  transitioning,
  onBlocked,
  onMode,
  latestRenderId,
  onOpenRender,
  review,
  snapshot,
  onReturnToDraft,
}: {
  project: Project;
  draft: Draft;
  mode: StudioMode;
  transitioning: boolean;
  onBlocked: (value: boolean) => void;
  onMode: (mode: StudioMode) => void;
  latestRenderId: Id<"videoJobs"> | null;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
  review?: ReactNode;
  snapshot?: VersionSnapshot;
  onReturnToDraft?: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const patchScript = useMutation(api.video.patchScript);
  const patchTimeline = useMutation(api.video.patchTimeline);
  const checkpoint = useMutation(api.video.checkpoint);
  const [label, setLabel] = useState("");
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointMessage, setCheckpointMessage] = useState("");
  const [checkpointError, setCheckpointError] = useState(false);
  const [sceneId, setSceneId] = useState(draft.script.sceneOrder[0] ?? "");
  const [shotId, setShotId] = useState("");
  const [pendingSceneDelete, setPendingSceneDelete] = useState<string | null>(null);
  const navigatorRef = useRef<HTMLElement | null>(null);
  const readOnly = Boolean(snapshot);
  const pendingCheckpoint = useRef<Parameters<typeof checkpoint>[0] | null>(null);
  const script = useRevisionEditor(
    { revision: draft.scriptRevision, document: draft.script },
    async (document, revision, key) => {
      if (!Script.safeParse(document).success) throw { data: { code: "VALIDATION_ERROR" } };
      const result = await patchScript({
        draftId: draft.draftId,
        expectedRevision: revision,
        idempotencyKey: key,
        operations: ["title", "premise", "sceneOrder", "scenesById"].map((field) => ({
          op: "replace" as const,
          path: `/${field}`,
          value: document[field as keyof typeof document],
        })),
      });
      return result.revisionId;
    },
  );
  const timeline = useRevisionEditor(
    { revision: draft.timelineRevision, document: draft.timeline },
    async (document, revision, key) => {
      if (!Timeline.safeParse(document).success) throw { data: { code: "VALIDATION_ERROR" } };
      const result = await patchTimeline({
        draftId: draft.draftId,
        expectedRevision: revision,
        idempotencyKey: key,
        operations: ["durationFrames", "trackOrder", "tracksById"].map((field) => ({
          op: "replace" as const,
          path: `/${field}`,
          value: document[field as keyof typeof document],
        })),
      });
      return result.revisionId;
    },
  );
  const unsaved =
    !readOnly &&
    (script.dirty ||
      timeline.dirty ||
      script.state === "saving" ||
      timeline.state === "saving" ||
      script.awaitingSubscription ||
      timeline.awaitingSubscription);
  const scriptDocument = snapshot?.script ?? script.document;
  const timelineDocument = snapshot?.timeline ?? timeline.document;
  const history = useDocumentHistory({ script, timeline }, transitioning || checkpointError);
  const editScript = (next: typeof script.document) => history.edit("script", next);
  const editTimeline = (next: typeof timeline.document) => history.edit("timeline", next);
  useUnsavedNavigation(unsaved || checkpointBusy || checkpointError);
  useReportBlocked(unsaved || checkpointBusy || checkpointError || transitioning, onBlocked);
  const versions = usePaginatedQuery(
    api.video.listVersions,
    { projectId: project.projectId, language: draft.language },
    { initialNumItems: 10 },
  );
  const activeSceneId = scriptDocument.scenesById[sceneId]
    ? sceneId
    : (scriptDocument.sceneOrder[0] ?? "");
  const activeScene = activeSceneId ? scriptDocument.scenesById[activeSceneId] : undefined;
  useEffect(() => {
    if (activeSceneId !== sceneId) setSceneId(activeSceneId);
    if (shotId && !activeScene?.shotsById[shotId]) setShotId("");
  }, [activeScene, activeSceneId, sceneId, shotId]);
  const scriptSaveRef = useRef(script.save);
  scriptSaveRef.current = script.save;
  const timelineSaveRef = useRef(timeline.save);
  timelineSaveRef.current = timeline.save;
  useStudioShortcuts({
    mode,
    onMode,
    saveScript: () => void scriptSaveRef.current(),
    saveTimeline: () => void timelineSaveRef.current(),
    history,
  });
  const saveState =
    script.state === "saving" || timeline.state === "saving"
      ? "saving"
      : unsaved
        ? "dirty"
        : "saved";
  const shotsPlanned = scriptDocument.sceneOrder.reduce(
    (total, id) => total + (scriptDocument.scenesById[id]?.shotOrder.length ?? 0),
    0,
  );
  const editorLocked = transitioning || checkpointError || readOnly;

  function reorderScenes(sceneOrder: string[]) {
    editScript({ ...scriptDocument, sceneOrder });
  }

  function deleteScene(id: string) {
    const document = scriptDocument;
    const { [id]: _removed, ...scenesById } = document.scenesById;
    const sceneOrder = document.sceneOrder.filter((sceneId) => sceneId !== id);
    editScript({ ...document, sceneOrder, scenesById });
    if (sceneId === id) {
      setSceneId(sceneOrder[0] ?? "");
      setShotId("");
    }
    setPendingSceneDelete(null);
  }
  async function saveCheckpoint() {
    pendingCheckpoint.current ??= {
      draftId: draft.draftId,
      idempotencyKey: crypto.randomUUID(),
      expectedProjectRevision: project.revisionId,
      expectedScriptRevision: draft.scriptRevision,
      expectedTimelineRevision: draft.timelineRevision,
      label: label.trim(),
    };
    setCheckpointBusy(true);
    setCheckpointMessage("");
    try {
      await checkpoint(pendingCheckpoint.current);
      pendingCheckpoint.current = null;
      setCheckpointError(false);
      setLabel("");
      setCheckpointMessage("Version saved. This does not render or approve the video.");
    } catch (error) {
      const data = error && typeof error === "object" && "data" in error ? error.data : undefined;
      const code = data && typeof data === "object" && "code" in data ? data.code : undefined;
      if (code === "REVISION_CONFLICT" || code === "VALIDATION_ERROR") {
        pendingCheckpoint.current = null;
        setCheckpointError(false);
        setCheckpointMessage(
          "The draft changed or the label is invalid. Check the saved draft and create the version again.",
        );
      } else {
        setCheckpointError(true);
        setCheckpointMessage("Version creation could not be confirmed. Retry the same request.");
      }
    } finally {
      setCheckpointBusy(false);
    }
  }

  return (
    <div
      className={`video-studio-body video-studio-shell${mode === "review" ? " video-studio-body-review" : ""}`}
      aria-busy={transitioning || undefined}
    >
      <div className="video-studio-statusbar" role="status" data-save={saveState}>
        <div className="vs-save-state">
          <span className="vs-save-dot" data-state={readOnly ? "saved" : saveState} aria-hidden="true" />
          <span>
            {readOnly
              ? `Version · ${snapshot?.label ?? "saved"}`
              : saveState === "saving"
                ? "Saving…"
                : unsaved
                  ? "Unsaved changes"
                  : "Saved"}
            {" · "}
            {(snapshot?.language ?? draft.language) === "ru" ? "RU" : "UZ"}
          </span>
        </div>
        {mode !== "review" && (
          <ol className="video-workflow-readiness" aria-label="Production readiness">
            <li className={shotsPlanned > 0 ? "is-ready" : ""}>
              <button
                type="button"
                aria-label="Open Shots to plan shots"
                onClick={() => {
                  setShotId("");
                  onMode("shots");
                }}
              >
                <CheckCircle2 size={13} aria-hidden="true" />
                {shotsPlanned} planned shots
              </button>
            </li>
            {latestRenderId ? (
              <li className="is-ready">
                <button
                  type="button"
                  aria-label="Review the latest render"
                  onClick={() => onOpenRender(latestRenderId)}
                >
                  <CheckCircle2 size={13} aria-hidden="true" />
                  Render ready
                </button>
              </li>
            ) : (
              <li>
                <CheckCircle2 size={13} aria-hidden="true" />
                Render pending
              </li>
            )}
          </ol>
        )}
        {mode !== "review" && !readOnly && (
          <fieldset className="video-actions" aria-label="Draft edit history">
            <Button
              size="sm"
              icon={Undo2}
              disabled={!history.canUndo}
              onClick={history.undo}
              title="Undo draft edit (⌘Z / Ctrl+Z)"
            >
              Undo
            </Button>
            <Button
              size="sm"
              icon={Redo2}
              disabled={!history.canRedo}
              onClick={history.redo}
              title="Redo draft edit (⌘⇧Z / Ctrl+Shift+Z)"
            >
              Redo
            </Button>
          </fieldset>
        )}
        {readOnly && onReturnToDraft && (
          <Button size="sm" onClick={onReturnToDraft}>
            Return to editable draft
          </Button>
        )}
      </div>

      {mode === "review" ? (
        latestRenderId ? (
          review
        ) : (
          <div className="video-preview-empty video-review-empty">
            <Film size={36} aria-hidden="true" />
            <h2>No rendered video yet</h2>
            <p>Save a version, then render it. Watching a draft does not approve it.</p>
          </div>
        )
      ) : (
        <div
          className={`video-studio-workspace${mode === "timeline" ? " video-studio-workspace-timeline" : ""}${mode === "story" ? " video-studio-workspace-story" : ""}`}
        >
          {mode !== "timeline" && mode !== "story" && (
            <aside
              ref={navigatorRef}
              className="video-studio-navigator"
              aria-label="Project scenes"
            >
              <SceneNavigator
                document={scriptDocument}
                selectedId={activeSceneId}
                onSelect={(next) => {
                  setSceneId(next);
                  setShotId("");
                }}
                onReorderScenes={reorderScenes}
                onDeleteScene={setPendingSceneDelete}
                scenesLocked={script.locked || editorLocked}
              />
              {pendingSceneDelete && (
                <ConfirmButton
                  defaultArmed
                  confirmLabel="Delete scene"
                  description="Removes this scene from the draft. Shots planned on it are lost."
                  onDisarm={() => setPendingSceneDelete(null)}
                  returnFocusRef={navigatorRef}
                  onConfirm={async () => deleteScene(pendingSceneDelete)}
                />
              )}
            </aside>
          )}

          <main className="video-editing-column" data-document-history>
            {mode === "story" && (
              <>
                {!readOnly && <EditorNotice editor={script} name="script" />}
                {pendingSceneDelete && (
                  <ConfirmButton
                    defaultArmed
                    confirmLabel="Delete scene"
                    description="Removes this scene from the draft. Shots planned on it are lost."
                    onDisarm={() => setPendingSceneDelete(null)}
                    returnFocusRef={navigatorRef}
                    onConfirm={async () => deleteScene(pendingSceneDelete)}
                  />
                )}
                <StoryboardEditor
                  document={scriptDocument}
                  onChange={editScript}
                  disabled={script.locked || editorLocked}
                  selectedId={activeSceneId}
                  onSelect={setSceneId}
                  onReorderScenes={reorderScenes}
                  onDeleteScene={setPendingSceneDelete}
                  onOpenShot={(nextShotId) => {
                    setShotId(nextShotId);
                    onMode("shots");
                  }}
                />
              </>
            )}
            {mode === "shots" && (
              <>
                {!readOnly && <EditorNotice editor={script} name="script" />}
                <ShotStudio
                  workspaceId={project.workspaceId}
                  projectId={project.projectId}
                  draftId={draft.draftId}
                  revision={draft.scriptRevision}
                  document={scriptDocument}
                  onChange={editScript}
                  locked={script.locked || editorLocked}
                  unsaved={script.dirty || script.awaitingSubscription}
                  sceneId={activeSceneId}
                  selectedShotId={shotId}
                  onSelectShot={setShotId}
                />
              </>
            )}
            {mode === "timeline" && (
              <>
                {!readOnly && <EditorNotice editor={timeline} name="timeline" />}
                <TimelineEditor
                  document={timelineDocument}
                  onChange={editTimeline}
                  history={history}
                  disabled={timeline.locked || editorLocked}
                  workspaceId={project.workspaceId}
                  format={project.format}
                />
              </>
            )}
          </main>

          <details key={mode} className="video-studio-inspector">
            <summary>
              <span>{readOnly ? "Version" : "Version and render"}</span>
              <span aria-hidden="true">›</span>
            </summary>
            <div className="video-studio-inspector-content">
              {snapshot ? (
                <>
                  <section className="video-render-callout">
                    <Film size={18} aria-hidden="true" />
                    <div>
                      <h2>{snapshot.label}</h2>
                      <p>Read-only snapshot. Render this version or return to the draft.</p>
                    </div>
                  </section>
                  <RenderRequest
                    key={snapshot.versionId}
                    workspaceId={project.workspaceId}
                    projectId={project.projectId}
                    versionId={snapshot.versionId}
                  />
                </>
              ) : (
                <>
                  {latestRenderId ? (
                    <section className="video-render-callout">
                      <Film size={18} aria-hidden="true" />
                      <div>
                        <h2>Render ready</h2>
                        <p>Open Review for this language.</p>
                      </div>
                      <Button variant="primary" onClick={() => onOpenRender(latestRenderId)}>
                        Review render
                      </Button>
                    </section>
                  ) : (
                    <section className="video-render-callout is-empty">
                      <Film size={18} aria-hidden="true" />
                      <div>
                        <h2>No rendered video yet</h2>
                        <p>Save a version, then render.</p>
                      </div>
                    </section>
                  )}
                  <Panel as="section" className="video-checkpoint-panel">
                    <h2>Save a version</h2>
                    <p className="video-hint">Freeze this language’s script and timeline.</p>
                    <form
                      className="video-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveCheckpoint();
                      }}
                    >
                      <TextInput
                        id="checkpoint-label"
                        label="Version label"
                        labelVisible
                        value={label}
                        onChange={(event) => setLabel(event.target.value)}
                        required
                        maxLength={500}
                        disabled={checkpointBusy || checkpointError || transitioning}
                        placeholder="Opening revised"
                      />
                      <Button
                        variant="primary"
                        type="submit"
                        busy={checkpointBusy}
                        disabled={unsaved || transitioning || !label.trim()}
                      >
                        {checkpointBusy
                          ? "Saving version…"
                          : checkpointError
                            ? "Retry same version"
                            : "Save version"}
                      </Button>
                      {unsaved && <p className="video-hint">Save or resolve draft changes first.</p>}
                      {checkpointMessage && (
                        <p role={checkpointError ? "alert" : "status"}>{checkpointMessage}</p>
                      )}
                    </form>
                  </Panel>
                </>
              )}
              <Disclosure
                summary={`Saved versions (${versions.results.length})`}
                className="video-version-list"
              >
                {versions.results.length === 0 && (
                  <p className="video-hint">No versions saved for this language.</p>
                )}
                {versions.results.map((version) => (
                  <Disclosure key={version.version.versionId} summary={version.label}>
                    <p className="video-hint">
                      Saved {new Date(version.createdAt).toLocaleString()}
                    </p>
                    <Button
                      size="sm"
                      disabled={unsaved || checkpointBusy || checkpointError || transitioning}
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        next.set("version", version.version.versionId);
                        next.set("language", version.version.language);
                        setParams(next);
                      }}
                    >
                      Open version
                    </Button>
                  </Disclosure>
                ))}
                {versions.status === "CanLoadMore" && (
                  <Button size="sm" onClick={() => versions.loadMore(10)}>
                    More versions
                  </Button>
                )}
              </Disclosure>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}



function useReportBlocked(value: boolean, report: (value: boolean) => void) {
  useEffect(() => {
    report(value);
    return () => report(false);
  }, [value, report]);
}

function EditorNotice<T>({
  editor,
  name,
}: {
  editor: ReturnType<typeof useRevisionEditor<T>>;
  name: string;
}) {
  return (
    <div className="video-editor-status">
      <span role="status">
        {editor.state === "saving"
          ? `Saving ${name}…`
          : editor.dirty
            ? `${name} changes are not saved yet`
            : `${name} saved`}
      </span>
      {editor.error && (
        <Panel tone="warning" role="alert">
          <p>{editor.error}</p>
          {editor.state === "conflict" && (
            <>
              <p>Copy your text before discarding it. The saved draft is shown below.</p>
              <Disclosure summary="Show saved draft">
                <pre className="video-conflict-document">
                  {JSON.stringify(editor.savedDocument, null, 2)}
                </pre>
              </Disclosure>
              <Button onClick={editor.useSaved}>Discard local edits and load saved draft</Button>
            </>
          )}
          {editor.state === "error" && (
            <Button onClick={() => void editor.save()}>Retry same save</Button>
          )}
        </Panel>
      )}
      {editor.dirty && editor.state === "editing" && (
        <Button size="sm" onClick={() => void editor.save()}>
          Save {name} now
        </Button>
      )}
    </div>
  );
}
