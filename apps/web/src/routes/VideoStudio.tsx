import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Film } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Script, Timeline } from "../../../../packages/video/src/contracts";
import { Badge } from "../components/Badge";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LoadingState } from "../components/LoadingState";
import { Button } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { Panel } from "../components/ui/Panel";
import { SectionHeader } from "../components/ui/SectionHeader";
import { TextInput } from "../components/ui/TextInput";
import { HumanLoopPanel } from "../components/video/HumanLoopPanel";
import { ReelsArchive } from "../components/video/ReelsArchive";
import { RenderRequest } from "../components/video/RenderRequest";
import { ShotStudio } from "../components/video/ShotStudio";
import { StoryboardEditor } from "../components/video/StoryboardEditor";
import { TimelineEditor } from "../components/video/TimelineEditor";
import { useRevisionEditor } from "../components/video/useRevisionEditor";
import { useUnsavedNavigation } from "../components/video/useUnsavedNavigation";
import { VideoJobs } from "../components/video/VideoJobs";
import { VideoReview } from "../components/video/VideoReview";
import { useDocumentTitle } from "../lib/useDocumentTitle";

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
  const renderId = params.get("render");
  const language = version?.version.language ?? (params.get("language") === "uz" ? "uz" : "ru");
  const lane = project?.drafts.find((draft) => draft.language === language) ?? project?.drafts[0];
  const draft = useQuery(api.video.getDraft, lane ? { draftId: lane.draftId } : "skip");
  if (!project) return <LoadingState />;
  return (
    <div className="video-studio">
      <SectionHeader
        as="h1"
        title={project.title}
        subtitle={project.brief.topic}
        crumbs={[
          { to: "/", label: "Workspaces" },
          ...(workspace
            ? [
                { to: `/w/${workspace.slug}`, label: workspace.name },
                { to: `/w/${workspace.slug}/videos`, label: "Video Studio" },
              ]
            : []),
        ]}
        actions={
          <nav className="video-language-switch" aria-label="Draft language">
            {project.drafts.map((item) => (
              <Button
                key={item.language}
                size="sm"
                aria-pressed={lane?.language === item.language}
                disabled={blocked || reviewBlocked}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("language", item.language);
                  next.delete("version");
                  next.delete("render");
                  setParams(next);
                }}
              >
                {item.language === "ru" ? "Русский" : "O‘zbekcha"}
              </Button>
            ))}
          </nav>
        }
      />
      <p className="video-hint">{project.brief.direction}</p>
      <ErrorBoundary label="Original archive unavailable; native drafts remain available.">
        <ReelsArchive key={project.projectId} projectId={project.projectId} />
      </ErrorBoundary>
      {versionId ? (
        !version ? (
          <LoadingState />
        ) : version.version.projectId !== project.projectId ? (
          <Panel tone="warning">This version does not belong to this project.</Panel>
        ) : (
          <>
            <div className="video-save-summary">
              <Badge>Saved version · {version.version.language.toUpperCase()}</Badge>
              <strong>{version.label}</strong>
              <Button
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("version");
                  next.set("language", version.version.language);
                  setParams(next);
                }}
              >
                Return to editable draft
              </Button>
            </div>
            <p className="video-hint">
              Read-only checkpoint. This snapshot is not a rendered MP4 or an approval.
            </p>
            <StoryboardEditor document={version.script} onChange={() => {}} disabled />
            <TimelineEditor document={version.timeline} onChange={() => {}} disabled />
            <RenderRequest
              key={version.version.versionId}
              workspaceId={project.workspaceId}
              projectId={project.projectId}
              versionId={version.version.versionId}
            />
          </>
        )
      ) : !draft || draft.draftId !== lane?.draftId ? (
        <LoadingState />
      ) : (
        <DraftStudio key={draft.draftId} project={project} draft={draft} onBlocked={setBlocked} />
      )}
      {renderId && (
        <VideoReview
          key={renderId}
          jobId={renderId as Id<"videoJobs">}
          projectId={project.projectId}
          onBlocked={setReviewBlocked}
        />
      )}
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
            (blocked || reviewBlocked) &&
            !window.confirm("Leave these unsaved edits? Saved drafts remain available.")
          )
            return;
          const next = new URLSearchParams(params);
          next.set("render", jobId);
          setParams(next);
        }}
      />
    </div>
  );
}

type Project = NonNullable<ReturnType<typeof useQuery<typeof api.video.getProject>>>;
type Draft = NonNullable<ReturnType<typeof useQuery<typeof api.video.getDraft>>>;

function DraftStudio({
  project,
  draft,
  onBlocked,
}: {
  project: Project;
  draft: Draft;
  onBlocked: (value: boolean) => void;
}) {
  const [params, setParams] = useSearchParams();
  const patchScript = useMutation(api.video.patchScript);
  const patchTimeline = useMutation(api.video.patchTimeline);
  const checkpoint = useMutation(api.video.checkpoint);
  const [label, setLabel] = useState("");
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointMessage, setCheckpointMessage] = useState("");
  const [checkpointError, setCheckpointError] = useState(false);
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
  // State is reported after render, not while rendering the parent shell.
  useReportBlocked(unsaved || checkpointBusy || checkpointError, onBlocked);
  const versions = usePaginatedQuery(
    api.video.listVersions,
    { projectId: project.projectId, language: draft.language },
    { initialNumItems: 10 },
  );

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
      setCheckpointMessage("Version saved. This does not render, publish or approve the video.");
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
    <>
      <div className="video-save-summary" role="status">
        <Badge tone={unsaved ? "warning" : "success"}>
          {unsaved ? "Unsaved changes" : "Draft saved"}
        </Badge>
        <span>
          {draft.language === "ru" ? "Russian" : "Uzbek"} draft. Other languages are unchanged.
        </span>
      </div>
      <div className="video-workspace">
        <div className="video-editing-column">
          <EditorNotice editor={script} name="script" />
          <StoryboardEditor
            document={script.document}
            onChange={script.edit}
            disabled={script.locked || checkpointError}
          />
          <EditorNotice editor={timeline} name="timeline" />
          <ShotStudio
            workspaceId={project.workspaceId}
            projectId={project.projectId}
            draftId={draft.draftId}
            revision={draft.scriptRevision}
            document={script.document}
            onChange={script.edit}
            locked={script.locked || checkpointError}
            unsaved={script.dirty || script.awaitingSubscription}
          />
          <TimelineEditor
            document={timeline.document}
            onChange={timeline.edit}
            disabled={timeline.locked || checkpointError}
          />
        </div>
        <aside className="video-review-column" aria-label="Preview and versions">
          <div className="video-preview-empty">
            <Film size={36} aria-hidden="true" />
            <h2>No rendered video yet</h2>
            <p>
              The storyboard is available now. A completed render will appear here; saving a draft
              does not create an MP4.
            </p>
          </div>
          <Panel as="section">
            <h2>Save a version</h2>
            <p className="video-hint">
              An immutable snapshot of this language’s script and timeline. Not a human approval.
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
                disabled={checkpointBusy || checkpointError}
                placeholder="Opening revised"
              />
              <Button
                variant="primary"
                type="submit"
                busy={checkpointBusy}
                disabled={unsaved || !label.trim()}
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
          <section className="video-version-list">
            <h2>Saved versions</h2>
            {versions.results.length === 0 && (
              <p className="video-hint">No versions saved for this language.</p>
            )}
            {versions.results.map((version) => (
              <Disclosure key={version.version.versionId} summary={version.label}>
                <p className="video-hint">Saved {new Date(version.createdAt).toLocaleString()}</p>
                <p className="video-hash">Manifest: {version.manifestSha256}</p>
                <p>Snapshot only. No rendered artifact or approval.</p>
                <Button
                  size="sm"
                  disabled={unsaved || checkpointBusy || checkpointError}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("version", version.version.versionId);
                    next.set("language", version.version.language);
                    setParams(next);
                  }}
                >
                  View saved storyboard
                </Button>
              </Disclosure>
            ))}
            {versions.status === "CanLoadMore" && (
              <Button size="sm" onClick={() => versions.loadMore(10)}>
                More versions
              </Button>
            )}
          </section>
        </aside>
      </div>
    </>
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
