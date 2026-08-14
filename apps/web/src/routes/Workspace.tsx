import { useMutation, useQuery } from "convex/react";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge } from "../components/Badge";
import { ConfirmButton } from "../components/ConfirmButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RenameForm } from "../components/RenameForm";
import { formatRelativeTime } from "../lib/formatDate";

interface CanvasSummary {
  canvas_id: Id<"canvases">;
  title: string;
  kind: string;
  visibility: "private" | "public";
  public_slug?: string;
  updated_at: number;
  thumbnail_url: string | null;
}

function CanvasCard({ canvas }: { canvas: CanvasSummary }) {
  const rename = useMutation(api.canvases.renameMine);
  const remove = useMutation(api.canvases.deleteMine);
  const [editing, setEditing] = useState(false);

  return (
    <li className="canvas-card">
      <Link to={`/c/${canvas.canvas_id}`} className="canvas-card-link">
        {canvas.thumbnail_url ? (
          <img src={canvas.thumbnail_url} alt="" className="canvas-card-thumbnail" />
        ) : (
          <div className="canvas-card-thumbnail canvas-card-thumbnail-empty" />
        )}
        {!editing && <strong>{canvas.title}</strong>}
        <span className="canvas-card-status">
          <Badge tone="neutral">{canvas.kind}</Badge>
          <Badge tone={canvas.visibility === "public" ? "success" : "neutral"}>
            {canvas.visibility}
          </Badge>
          {canvas.visibility === "public" && canvas.public_slug && (
            <Badge tone="info">shared</Badge>
          )}
        </span>
      </Link>
      {editing ? (
        <RenameForm
          initial={canvas.title}
          label="Canvas title"
          onSave={(title) => rename({ canvasId: canvas.canvas_id, title })}
          onDone={() => setEditing(false)}
        />
      ) : (
        <div className="canvas-card-footer">
          {/* `updated_at` has always been in the summary payload and was
              never rendered — it is the only signal of which canvas an
              agent touched most recently. */}
          <span className="muted row-item-meta">{formatRelativeTime(canvas.updated_at)}</span>
          <div className="row-item-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Rename
            </button>
            <ConfirmButton
              description="Deletes this canvas and every version of it. Permanent."
              onConfirm={() => remove({ canvasId: canvas.canvas_id })}
            />
          </div>
        </div>
      )}
    </li>
  );
}

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
          <CanvasCard key={c.canvas_id} canvas={c} />
        ))}
      </ul>
    </div>
  );
}
