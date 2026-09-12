import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Film, Plus, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { IconButton } from "../components/ui/IconButton";
import { TextInput } from "../components/ui/TextInput";
import { VideoProjectCard } from "../components/VideoProjectCard";
import { WorkspaceChrome } from "../components/WorkspaceChrome";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export function VideoProjectsPage() {
  const { wsSlug } = useParams();
  const workspace = useQuery(api.workspaces.getBySlug, wsSlug ? { slug: wsSlug } : "skip");
  const renameWorkspace = useMutation(api.workspaces.renameMine);
  useDocumentTitle(workspace ? `${workspace.name} · Videos` : "Videos");
  const { results, status, loadMore } = usePaginatedQuery(
    api.video.listProjects,
    workspace ? { workspaceId: workspace.workspace_id } : "skip",
    { initialNumItems: 20 },
  );
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return results;
    return results.filter((project) =>
      [project.title, project.topic ?? ""].some((field) => field.toLowerCase().includes(needle)),
    );
  }, [filter, results]);

  if (workspace === undefined) return <LoadingState />;
  if (!workspace)
    return (
      <div className="page-stack">
        <WorkspaceChrome slug={wsSlug ?? "workspace"} workspace={null} />
        <EmptyState
          icon={Film}
          title="No workspace at this address."
          hint={<Link to="/">Back to workspaces</Link>}
        />
      </div>
    );

  return (
    <div className="page-stack video-projects">
      <WorkspaceChrome
        slug={wsSlug ?? workspace.slug}
        workspace={workspace}
        onRename={(name) => renameWorkspace({ workspaceId: workspace.workspace_id, name })}
        subtitle="Scripts, shots and edits."
        actions={<CreateVideoButton workspaceId={workspace.workspace_id} />}
      />
      {results.length > 1 && (
        <div className="list-toolbar">
          <TextInput
            id="video-filter"
            label="Filter videos"
            className="list-toolbar-search"
            leadingIcon={Search}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setFilter("");
            }}
            placeholder="Filter videos…"
            trailingSlot={
              filter && (
                <IconButton
                  icon={X}
                  label="Clear filter"
                  iconSize={14}
                  className="field-action"
                  onClick={() => setFilter("")}
                />
              )
            }
          />
        </div>
      )}
      {status === "LoadingFirstPage" ? (
        <LoadingState />
      ) : results.length === 0 ? (
        <EmptyState
          icon={Film}
          title="Your first story starts here."
          hint="Create a project, then write the scenario with your agent or edit the storyboard here."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Search}
          title={`No videos match “${filter.trim()}”.`}
          action={
            <Button variant="ghost" onClick={() => setFilter("")}>
              Show all videos
            </Button>
          }
        />
      ) : (
        <ul className="card-grid">
          {shown.map((project) => (
            <VideoProjectCardWithMutations key={project.projectId} project={project} />
          ))}
        </ul>
      )}
      {status === "CanLoadMore" && <Button onClick={() => loadMore(20)}>Load more projects</Button>}
      {status === "LoadingMore" && <p role="status">Loading more projects…</p>}
    </div>
  );
}

export function VideoAllPage() {
  const groups = useQuery(api.video.listMine, {});
  useDocumentTitle("Videos");
  return (
    <div className="page-stack video-projects">
      <PageHeader
        title="Videos"
        subtitle="Stories across your workspaces."
        crumbs={[{ to: "/", label: "Workspaces" }]}
      />
      {groups === undefined ? (
        <LoadingState />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No video projects yet."
          hint={<Link to="/">Open a workspace to create one.</Link>}
        />
      ) : (
        groups.map((group) => (
          <section key={group.workspaceId} className="video-project-group">
            <h2>
              <Link to={`/w/${group.slug}/videos`}>{group.name}</Link>
            </h2>
            <ul className="card-grid">
              {group.projects.map((project) => (
                <VideoProjectCardWithMutations key={project.projectId} project={project} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function VideoProjectCardWithMutations({
  project,
}: {
  project: {
    projectId: Parameters<typeof VideoProjectCard>[0]["project"]["projectId"];
    workspaceId?: Parameters<typeof VideoProjectCard>[0]["project"]["workspaceId"];
    title: string;
    topic?: string;
    updatedAt: number;
    languages?: Array<"ru" | "uz">;
    poster?: { assetId: string; revisionId: string } | null;
  };
}) {
  const rename = useMutation(api.video.renameProject);
  const remove = useMutation(api.video.deleteProject);
  return (
    <VideoProjectCard
      project={project}
      onRename={(title) => rename({ projectId: project.projectId, title })}
      onDelete={() => remove({ projectId: project.projectId })}
    />
  );
}

function CreateVideoButton({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const create = useMutation(api.video.createProject);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  async function createProject() {
    const input = {
      workspaceId,
      title: title.trim(),
      brief: { topic: topic.trim(), direction: direction.trim() },
      languages: ["ru", "uz"] as ("ru" | "uz")[],
      format: { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } },
    };
    const signature = JSON.stringify(input);
    if (!attempt.current || attempt.current.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError("");
    try {
      const result = await create({ ...input, idempotencyKey: attempt.current.key });
      navigate(`/v/${result.projectId}`);
    } catch {
      setError(
        "Creation could not be confirmed. Retry with the same details to recover this project.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button icon={Plus} variant="primary" onClick={() => setOpen(true)}>
        New video
      </Button>
      <Drawer
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="Start with the story"
        closeLabel="Close new video"
        side="right"
      >
        <form
          className="video-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createProject();
          }}
        >
          <TextInput
            id="video-title"
            label="Project title"
            labelVisible
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={200}
            disabled={busy || !!error}
          />
          <TextInput
            id="video-topic"
            label="Topic"
            labelVisible
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            required
            disabled={busy || !!error}
          />
          <label className="video-field" htmlFor="video-direction">
            Direction
            <textarea
              id="video-direction"
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              required
              rows={4}
              disabled={busy || !!error}
              placeholder="What should the viewer understand or feel?"
            />
          </label>
          <p className="video-hint">
            Creates separate Russian and Uzbek drafts in vertical 1080 × 1920. No generation starts.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="video-actions">
            <Button type="submit" variant="primary" busy={busy}>
              {busy ? "Creating…" : error ? "Retry same creation" : "Create project"}
            </Button>
            {!error && (
              <Button disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Drawer>
    </>
  );
}
