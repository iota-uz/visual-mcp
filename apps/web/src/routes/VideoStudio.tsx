import { useQuery } from "convex/react";
import { Clapperboard, Film, Layers, ListVideo, PlaySquare } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge } from "../components/Badge";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LoadingState } from "../components/LoadingState";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { IconButton } from "../components/ui/IconButton";
import { Panel } from "../components/ui/Panel";
import { HumanLoopPanel } from "../components/video/HumanLoopPanel";
import { ReelsArchive } from "../components/video/ReelsArchive";
import { RenderRequest } from "../components/video/RenderRequest";
import { StoryboardEditor } from "../components/video/StoryboardEditor";
import { TimelineEditor } from "../components/video/TimelineEditor";
import { type Draft, DraftStudio, type StudioMode } from "../components/video/VideoDraftStudio";
import { VideoJobs } from "../components/video/VideoJobs";
import { VideoReview } from "../components/video/VideoReview";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const MODES: Array<{ id: StudioMode; label: string; icon: typeof Film; shortcut: string }> = [
  { id: "story", label: "Story", icon: Clapperboard, shortcut: "1" },
  { id: "shots", label: "Shots", icon: Layers, shortcut: "2" },
  { id: "timeline", label: "Timeline", icon: ListVideo, shortcut: "3" },
  { id: "review", label: "Review", icon: PlaySquare, shortcut: "4" },
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
                data-shortcut={item.shortcut}
                title={`${item.label} (${item.shortcut})`}
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
            key={visibleDraft.draftId}
            project={project}
            draft={visibleDraft}
            mode={mode}
            transitioning={draftTransitioning}
            onBlocked={setBlocked}
            onMode={(next) => setParam({ mode: next })}
            latestRenderId={activeRender as Id<"videoJobs"> | null}
            onOpenRender={(jobId) => setParam({ render: jobId, mode: "review", production: null })}
            review={
              activeRender ? (
                <VideoReview
                  key={activeRender}
                  jobId={activeRender as Id<"videoJobs">}
                  projectId={project.projectId}
                  workspaceId={project.workspaceId}
                  onOpenRender={(jobId) => setParam({ render: jobId, mode: "review" })}
                  onBlocked={setReviewBlocked}
                />
              ) : null
            }
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
            setParam({ version: null, render: jobId, mode: "review" });
          }}
        />
      </Drawer>
    </div>
  );
}

function parseMode(value: string | null): StudioMode {
  return MODES.some((mode) => mode.id === value) ? (value as StudioMode) : "story";
}
