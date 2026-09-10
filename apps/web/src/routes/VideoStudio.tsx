import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { CheckCircle2, Clapperboard, Film, Layers, ListVideo, PlaySquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Script, Timeline } from "../../../../packages/video/src/contracts";
import { Badge } from "../components/Badge";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LoadingState } from "../components/LoadingState";
import { Button } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { Drawer } from "../components/ui/Drawer";
import { IconButton } from "../components/ui/IconButton";
import { Panel } from "../components/ui/Panel";
import { TextInput } from "../components/ui/TextInput";
import { HumanLoopPanel } from "../components/video/HumanLoopPanel";
import { ReelsArchive } from "../components/video/ReelsArchive";
import { RenderRequest } from "../components/video/RenderRequest";
import { ShotStudio } from "../components/video/ShotStudio";
import { SceneNavigator, StoryboardEditor } from "../components/video/StoryboardEditor";
import { TimelineEditor } from "../components/video/TimelineEditor";
import { useRevisionEditor } from "../components/video/useRevisionEditor";
import { useUnsavedNavigation } from "../components/video/useUnsavedNavigation";
import { VideoJobs } from "../components/video/VideoJobs";
import { VideoReview } from "../components/video/VideoReview";
import { useDocumentTitle } from "../lib/useDocumentTitle";

type StudioMode = "story" | "shots" | "timeline" | "review";

const MODES: Array<{ id: StudioMode; label: string; icon: typeof Film }> = [
  { id: "story", label: "Story", icon: Clapperboard },
  { id: "shots", label: "Shots", icon: Layers },
  { id: "timeline", label: "Timeline", icon: ListVideo },
  { id: "review", label: "Review", icon: PlaySquare },
];

export function VideoStudioPage() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useQuery(
    api.video.getProject,
    projectId ? { projectId: projectId as Id<"videoProjects"> } : "skip",
  );
  const versionId = params.get("version");
  const workspace = useQuery(
    api.workspaces.getById,
    project ? { workspaceId: project.workspaceId } : "skip",
  );
  useDocumentTitle(project ? `${project.title} · Video Studio` : undefined);
  const version = useQuery(
    api.video.getVersion,
    versionId ? { versionId: versionId as Id<"videoVersions"> } : "skip",
  );
  const [blocked, setBlocked] = useState(false);
  const [reviewBlocked, setReviewBlocked] = useState(false);
  const retainedDraft = useRef<Draft | null>(null);
  const [productionOpen, setProductionOpen] = useState(params.get("production") === "1");
  const renderId = params.get("render");
  const language = version?.version.language ?? (params.get("language") === "uz" ? "uz" : "ru");
  const mode = parseMode(params.get("mode"));
  const lane = project?.drafts.find((draft) => draft.language === language) ?? project?.drafts[0];
  const draft = useQuery(api.video.getDraft, lane ? { draftId: lane.draftId } : "skip");
  const latestRender = useQuery(
    api.video.latestRender,
    project ? { projectId: project.projectId, language } : "skip",
  );
  const currentDraft = draft && draft.draftId === lane?.draftId ? draft : null;
  if (currentDraft) retainedDraft.current = currentDraft;
  const visibleDraft =
    currentDraft ??
    (retainedDraft.current?.projectId === project?.projectId ? retainedDraft.current : null);
  const draftTransitioning = Boolean(!currentDraft && visibleDraft && lane);
  function setParam(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  }

  if (!project) return <LoadingState />;
  const busy = blocked || reviewBlocked;
  const activeRender = renderId ?? latestRender?.jobId ?? null;

  return (
    <div className="video-studio-page">
      <header className="canvas-command-bar">
        <div className="canvas-command-lead">
          <Link
            to={workspace ? `/w/${workspace.slug}/videos` : "/videos"}
            className="canvas-command-crumb"
          >
            {workspace?.name ?? "Videos"}
          </Link>
          <span className="canvas-command-crumb-sep" aria-hidden="true">
            /
          </span>
          <h1 className="canvas-command-name">{project.title}</h1>
        </div>
        {!versionId && (
          <nav className="canvas-mode-switch video-workflow-switch" aria-label="Studio workflow">
            {MODES.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={mode === item.id ? "secondary" : "ghost"}
                icon={item.icon}
                aria-current={mode === item.id ? "step" : undefined}
                onClick={() => setParam({ mode: item.id })}
              >
                {item.label}
              </Button>
            ))}
          </nav>
        )}
        <div className="canvas-command-actions">
          <nav className="canvas-mode-switch" aria-label="Draft language">
            {project.drafts.map((item) => (
              <Button
                key={item.language}
                size="sm"
                aria-pressed={lane?.language === item.language}
                disabled={busy}
                onClick={() => {
                  setParam({
                    language: item.language,
                    version: null,
                    render: null,
                  });
                }}
              >
                {item.language === "ru" ? "Русский" : "O‘zbekcha"}
              </Button>
            ))}
          </nav>
          <IconButton
            icon={Film}
            label="Open production"
            text="Production"
            iconSize={16}
            className="canvas-command-details"
            onClick={() => setProductionOpen(true)}
            aria-expanded={productionOpen}
            aria-controls="video-production"
          />
        </div>
      </header>

      {versionId ? (
        !version ? (
          <LoadingState />
        ) : version.version.projectId !== project.projectId ? (
          <Panel tone="warning">This version does not belong to this project.</Panel>
        ) : (
          <div className="video-studio-body">
            <div className="video-editing-column">
              <div className="video-save-summary">
                <Badge>Saved version · {version.version.language.toUpperCase()}</Badge>
                <strong>{version.label}</strong>
                <Button
                  onClick={() => {
                    setParam({
                      version: null,
                      language: version.version.language,
                    });
                  }}
                >
                  Return to editable draft
                </Button>
              </div>
              <p className="video-hint">
                Read-only snapshot of the script and timeline. Not a rendered MP4 or an approval.
              </p>
              <StoryboardEditor document={version.script} onChange={() => {}} disabled />
              <TimelineEditor document={version.timeline} onChange={() => {}} disabled />
              <RenderRequest
                key={version.version.versionId}
                workspaceId={project.workspaceId}
                projectId={project.projectId}
                versionId={version.version.versionId}
              />
            </div>
          </div>
        )
      ) : !visibleDraft ? (
        <LoadingState />
      ) : (
        <div className="video-draft-continuity">
          {draftTransitioning && (
            <div className="video-draft-transition" role="status">
              <span aria-hidden="true" />
              Loading the {language === "ru" ? "Russian" : "Uzbek"} draft…
            </div>
          )}
          <DraftStudio
            project={project}
            draft={visibleDraft}
            mode={mode}
            transitioning={draftTransitioning}
            onBlocked={setBlocked}
            onMode={(next) => setParam({ mode: next })}
            latestRenderId={activeRender as Id<"videoJobs"> | null}
            onOpenRender={(jobId) => setParam({ render: jobId, mode: "review", production: null })}
          />
        </div>
      )}

      {mode === "review" && activeRender && (
        <div className="video-studio-review">
          <VideoReview
            key={activeRender}
            jobId={activeRender as Id<"videoJobs">}
            projectId={project.projectId}
            workspaceId={project.workspaceId}
            onOpenRender={(jobId) => setParam({ render: jobId, mode: "review" })}
            onBlocked={setReviewBlocked}
          />
        </div>
      )}

      <Drawer
        id="video-production"
        open={productionOpen}
        onClose={() => setProductionOpen(false)}
        title="Production"
        closeLabel="Close production"
        side="right"
      >
        <ErrorBoundary label="Original archive unavailable; native drafts remain available.">
          <ReelsArchive key={project.projectId} projectId={project.projectId} />
        </ErrorBoundary>
        <ErrorBoundary label="Improvement loop unavailable; script and video review remain available.">
          <HumanLoopPanel
            key={`${project.projectId}:${language}`}
            projectId={project.projectId}
            language={language}
          />
        </ErrorBoundary>
        <VideoJobs
          workspaceId={project.workspaceId}
          projectId={project.projectId}
          onOpenRender={(jobId) => {
            if (
              busy &&
              !window.confirm("Leave these unsaved edits? Saved drafts remain available.")
            )
              return;
            setProductionOpen(false);
            setParam({ render: jobId, mode: "review" });
          }}
        />
      </Drawer>
    </div>
  );
}

function parseMode(value: string | null): StudioMode {
  return MODES.some((mode) => mode.id === value) ? (value as StudioMode) : "story";
}

type Project = NonNullable<ReturnType<typeof useQuery<typeof api.video.getProject>>>;
type Draft = NonNullable<ReturnType<typeof useQuery<typeof api.video.getDraft>>>;

function DraftStudio({
  project,
  draft,
  mode,
  transitioning,
  onBlocked,
  onMode,
  latestRenderId,
  onOpenRender,
}: {
  project: Project;
  draft: Draft;
  mode: StudioMode;
  transitioning: boolean;
  onBlocked: (value: boolean) => void;
  onMode: (mode: StudioMode) => void;
  latestRenderId: Id<"videoJobs"> | null;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
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
    script.dirty ||
    timeline.dirty ||
    script.state === "saving" ||
    timeline.state === "saving" ||
    script.awaitingSubscription ||
    timeline.awaitingSubscription;
  useUnsavedNavigation(unsaved || checkpointBusy || checkpointError);
  useReportBlocked(unsaved || checkpointBusy || checkpointError || transitioning, onBlocked);
  const versions = usePaginatedQuery(
    api.video.listVersions,
    { projectId: project.projectId, language: draft.language },
    { initialNumItems: 10 },
  );
  const activeSceneId = script.document.scenesById[sceneId]
    ? sceneId
    : (script.document.sceneOrder[0] ?? "");
  const activeScene = activeSceneId ? script.document.scenesById[activeSceneId] : undefined;
  useEffect(() => {
    if (activeSceneId !== sceneId) setSceneId(activeSceneId);
    if (shotId && !activeScene?.shotsById[shotId]) setShotId("");
  }, [activeScene, activeSceneId, sceneId, shotId]);
  const sceneBriefsReady = script.document.sceneOrder.filter((id) => {
    const scene = script.document.scenesById[id];
    return Boolean(
      scene?.purpose.trim() && scene.narration.trim() && scene.visual.description.trim(),
    );
  }).length;
  const shotsPlanned = script.document.sceneOrder.reduce(
    (total, id) => total + (script.document.scenesById[id]?.shotOrder.length ?? 0),
    0,
  );
  const editorLocked = transitioning || checkpointError;

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
      <div className="video-studio-statusbar" role="status">
        <div>
          <Badge tone={unsaved ? "warning" : "success"}>
            {unsaved ? "Unsaved changes" : "Draft saved"}
          </Badge>
          <span>{draft.language === "ru" ? "Russian" : "Uzbek"} draft</span>
        </div>
        <ol className="video-workflow-readiness" aria-label="Production readiness">
          <li className={sceneBriefsReady > 0 ? "is-ready" : ""}>
            <CheckCircle2 size={13} aria-hidden="true" />
            {sceneBriefsReady}/{script.document.sceneOrder.length} scene briefs
          </li>
          <li className={shotsPlanned > 0 ? "is-ready" : ""}>
            <CheckCircle2 size={13} aria-hidden="true" />
            {shotsPlanned} planned shots
          </li>
          <li className={latestRenderId ? "is-ready" : ""}>
            <CheckCircle2 size={13} aria-hidden="true" />
            {latestRenderId ? "Render ready" : "Render pending"}
          </li>
        </ol>
      </div>

      {mode === "review" ? (
        !latestRenderId && (
          <div className="video-preview-empty video-review-empty">
            <Film size={36} aria-hidden="true" />
            <h2>No rendered video yet</h2>
            <p>Save a version, then render it. Watching a draft does not approve it.</p>
          </div>
        )
      ) : (
        <div
          className={`video-studio-workspace${mode === "timeline" ? " video-studio-workspace-timeline" : ""}`}
        >
          {mode !== "timeline" && (
            <aside className="video-studio-navigator" aria-label="Project scenes">
              <SceneNavigator
                document={script.document}
                selectedId={activeSceneId}
                onSelect={(next) => {
                  setSceneId(next);
                  setShotId("");
                }}
              />
            </aside>
          )}

          <main className="video-editing-column">
            {mode === "story" && (
              <>
                <EditorNotice editor={script} name="script" />
                <StoryboardEditor
                  document={script.document}
                  onChange={script.edit}
                  disabled={script.locked || editorLocked}
                  selectedId={activeSceneId}
                  onSelect={setSceneId}
                  showSceneNavigator={false}
                  onOpenShot={(nextShotId) => {
                    setShotId(nextShotId);
                    onMode("shots");
                  }}
                />
              </>
            )}
            {mode === "shots" && (
              <>
                <EditorNotice editor={script} name="script" />
                <ShotStudio
                  workspaceId={project.workspaceId}
                  projectId={project.projectId}
                  draftId={draft.draftId}
                  revision={draft.scriptRevision}
                  document={script.document}
                  onChange={script.edit}
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
                <EditorNotice editor={timeline} name="timeline" />
                <TimelineEditor
                  document={timeline.document}
                  onChange={timeline.edit}
                  disabled={timeline.locked || editorLocked}
                />
              </>
            )}
          </main>

          <details key={mode} className="video-studio-inspector" open={mode !== "timeline"}>
            <summary>
              <span>Version and render</span>
              <span aria-hidden="true">›</span>
            </summary>
            <div className="video-studio-inspector-content">
              {latestRenderId ? (
                <section className="video-render-callout">
                  <Film size={22} aria-hidden="true" />
                  <div>
                    <h2>Latest render ready</h2>
                    <p>Watch this language’s exact MP4 and leave timecoded notes.</p>
                  </div>
                  <Button variant="primary" onClick={() => onOpenRender(latestRenderId)}>
                    Review render
                  </Button>
                </section>
              ) : (
                <section className="video-render-callout is-empty">
                  <Film size={22} aria-hidden="true" />
                  <div>
                    <h2>No rendered video yet</h2>
                    <p>Create an immutable version first. Saving the draft does not render it.</p>
                  </div>
                </section>
              )}
              <Panel as="section" className="video-checkpoint-panel">
                <h2>Save a version</h2>
                <p className="video-hint">
                  Freeze this language’s script and timeline without approving it.
                </p>
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
                    <p>Snapshot only. No rendered artifact or approval.</p>
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
                      View storyboard
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
