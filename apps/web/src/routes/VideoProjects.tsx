import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Film, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { Button } from "../components/ui/Button";
import { Panel } from "../components/ui/Panel";
import { SectionHeader } from "../components/ui/SectionHeader";
import { TextInput } from "../components/ui/TextInput";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export function VideoProjectsPage() {
  const { wsSlug } = useParams();
  const workspace = useQuery(api.workspaces.getBySlug, wsSlug ? { slug: wsSlug } : "skip");
  useDocumentTitle(workspace ? `${workspace.name} · Video Studio` : "Video Studio");
  const { results, status, loadMore } = usePaginatedQuery(
    api.video.listProjects,
    workspace ? { workspaceId: workspace.workspace_id } : "skip",
    { initialNumItems: 20 },
  );
  const create = useMutation(api.video.createProject);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  async function createProject() {
    if (!workspace) return;
    const input = {
      workspaceId: workspace.workspace_id,
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

  if (workspace === undefined) return <LoadingState />;
  if (!workspace)
    return (
      <EmptyState
        icon={Film}
        title="No workspace at this address."
        hint={<Link to="/">Back to workspaces</Link>}
      />
    );
  return (
    <div className="page-stack video-projects">
      <SectionHeader
        as="h1"
        title="Video Studio"
        subtitle={`Scripts, shots and edits in ${workspace.name}.`}
        crumbs={[
          { to: "/", label: "Workspaces" },
          { to: `/w/${wsSlug}`, label: workspace.name },
        ]}
        actions={
          <Button icon={Plus} variant="primary" onClick={() => setCreating(true)}>
            New video
          </Button>
        }
      />
      {creating && (
        <Panel as="section">
          <form
            className="video-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createProject();
            }}
          >
            <h2>Start with the story</h2>
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
              Creates separate Russian and Uzbek drafts in vertical 1080 × 1920 format. No
              generation starts or provider charges are made.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="video-actions">
              <Button type="submit" variant="primary" busy={busy}>
                {busy ? "Creating…" : error ? "Retry same creation" : "Create project"}
              </Button>
              {!error && (
                <Button disabled={busy} onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Panel>
      )}
      {status === "LoadingFirstPage" ? (
        <LoadingState />
      ) : results.length === 0 ? (
        <EmptyState
          icon={Film}
          title="Your first story starts here."
          hint="Create a project, then write the scenario with your agent or edit the storyboard here."
        />
      ) : (
        <div className="video-project-list">
          {results.map((project) => (
            <Link
              className="video-project-link"
              key={project.projectId}
              to={`/v/${project.projectId}`}
            >
              <span className="video-project-icon">
                <Film size={24} aria-hidden="true" />
              </span>
              <span>
                <strong>{project.title}</strong>
                <span className="video-hint">Open storyboard and language drafts</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      {status === "CanLoadMore" && <Button onClick={() => loadMore(20)}>Load more projects</Button>}
      {status === "LoadingMore" && <p role="status">Loading more projects…</p>}
    </div>
  );
}
