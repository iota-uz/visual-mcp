import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";

export function WorkspacePage() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const workspace = useQuery(api.workspaces.getBySlug, wsSlug ? { slug: wsSlug } : "skip");
  const canvases = useQuery(
    api.canvases.listForWorkspace,
    workspace ? { workspaceId: workspace.workspace_id } : "skip",
  );

  if (workspace === undefined) {
    return <p>Loading…</p>;
  }
  if (workspace === null) {
    return <p>No workspace found at "{wsSlug}".</p>;
  }

  return (
    <div>
      <p>
        <Link to="/">← Workspaces</Link>
      </p>
      <h1>{workspace.name}</h1>
      {workspace.description && <p className="muted">{workspace.description}</p>}

      {canvases === undefined && <p>Loading canvases…</p>}
      {canvases?.length === 0 && (
        <p>
          No canvases yet. Point Claude at this workspace over MCP — see{" "}
          <Link to="/settings/tokens">MCP tokens</Link>.
        </p>
      )}
      <ul className="canvas-grid">
        {canvases?.map((c) => (
          <li key={c.canvas_id}>
            <Link to={`/c/${c.canvas_id}`} className="canvas-card">
              <strong>{c.title}</strong>
              <span className="muted">
                {c.kind} · {c.visibility}
                {c.visibility === "public" && c.public_slug ? " · shared" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
