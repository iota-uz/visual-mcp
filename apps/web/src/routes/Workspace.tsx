import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";

export function WorkspacePage() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const workspace = useQuery(api.workspaces.getBySlug, wsSlug ? { slug: wsSlug } : "skip");
  const canvases = useQuery(
    api.canvases.listForWorkspace,
    workspace ? { workspaceId: workspace.workspace_id } : "skip",
  );

  if (workspace === undefined) {
    return <LoadingState />;
  }
  if (workspace === null) {
    return <p className="error-text">No workspace found at "{wsSlug}".</p>;
  }

  return (
    <div>
      <PageHeader
        title={workspace.name}
        subtitle={workspace.description}
        back={{ to: "/", label: "Workspaces" }}
      />

      {canvases === undefined && <LoadingState label="Loading canvases…" />}
      {canvases?.length === 0 && (
        <EmptyState
          title="No canvases yet."
          hint={
            <>
              Point Claude at this workspace over MCP — see{" "}
              <Link to="/settings/tokens">MCP tokens</Link>.
            </>
          }
        />
      )}
      <ul className="canvas-grid">
        {canvases?.map((c) => (
          <li key={c.canvas_id}>
            <Link to={`/c/${c.canvas_id}`} className="canvas-card">
              {c.thumbnail_url ? (
                <img src={c.thumbnail_url} alt="" className="canvas-card-thumbnail" />
              ) : (
                <div className="canvas-card-thumbnail canvas-card-thumbnail-empty" />
              )}
              <strong>{c.title}</strong>
              <span className="canvas-card-status">
                <Badge tone="neutral">{c.kind}</Badge>
                <Badge tone={c.visibility === "public" ? "success" : "neutral"}>
                  {c.visibility}
                </Badge>
                {c.visibility === "public" && c.public_slug && <Badge tone="info">shared</Badge>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
