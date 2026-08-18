import { useMutation, useQuery } from "convex/react";
import {
  FileCode,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  type LucideIcon,
  Pencil,
} from "lucide-react";
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
import { CardGridSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { Button } from "../components/ui/Button";
import { RefChip } from "../components/ui/CopyableValue";
import { formatBytes } from "../lib/formatBytes";
import { formatRelativeTime } from "../lib/formatDate";

interface CanvasSummary {
  canvas_id: Id<"canvases">;
  slug: string;
  title: string;
  description?: string;
  kind: string;
  visibility: "private" | "public";
  public_slug?: string;
  updated_at: number;
  thumbnail_url: string | null;
}

// A canvas with no render has no thumbnail, and the placeholder used to be
// an empty grey rectangle — indistinguishable from a broken image. Say what
// the thing is instead.
const KIND_ICON: Record<string, LucideIcon> = {
  canvas: LayoutDashboard,
  html: FileCode,
  image: ImageIcon,
  pdf: FileText,
};

function CanvasCard({ canvas, workspaceSlug }: { canvas: CanvasSummary; workspaceSlug: string }) {
  const rename = useMutation(api.canvases.renameMine);
  const remove = useMutation(api.canvases.deleteMine);
  const { notify } = useToast();
  const [editing, setEditing] = useState(false);
  const KindIcon = KIND_ICON[canvas.kind] ?? FileCode;
  // The ref an agent addresses this canvas by. It was invisible everywhere,
  // so the one string you need to say back to Claude had to be guessed.
  const ref = `${workspaceSlug}/${canvas.slug}`;

  return (
    <li className="canvas-card">
      <Link to={`/c/${canvas.canvas_id}`} className="canvas-card-link">
        {canvas.thumbnail_url ? (
          <img src={canvas.thumbnail_url} alt="" className="canvas-card-thumbnail" />
        ) : (
          <div className="canvas-card-thumbnail canvas-card-thumbnail-empty">
            <KindIcon size={24} strokeWidth={1.5} aria-hidden="true" />
            <span>no render yet</span>
          </div>
        )}
        {!editing && <strong>{canvas.title}</strong>}
        {canvas.description && (
          <span className="canvas-card-description">{canvas.description}</span>
        )}
        <span className="canvas-card-status">
          <Badge tone="neutral">{canvas.kind}</Badge>
          {/* `public` and `shared` said the same thing twice. */}
          <Badge tone={canvas.visibility === "public" ? "success" : "neutral"}>
            {canvas.visibility}
          </Badge>
        </span>
      </Link>
      <RefChip refValue={ref} className="canvas-card-ref" />
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
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
              Rename
            </Button>
            <ConfirmButton
              description="Deletes this canvas and every version of it. Permanent."
              onConfirm={async () => {
                const result = await remove({ canvasId: canvas.canvas_id });
                notify({
                  message: `Deleted "${canvas.title}" — ${formatBytes(result.bytes_reclaimed)} freed.`,
                });
              }}
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
    // Was bare red error text while the structurally identical
    // canvas-not-found used an EmptyState. Same shape, same treatment.
    return (
      <EmptyState
        title={`No workspace at "${wsSlug}".`}
        hint={<Link to="/">Back to workspaces</Link>}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={workspace.name}
        subtitle={workspace.description}
        back={{ to: "/", label: "Workspaces" }}
      />

      {canvases === undefined && <CardGridSkeleton cards={3} />}
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
          <CanvasCard key={c.canvas_id} canvas={c} workspaceSlug={workspace.slug} />
        ))}
      </ul>
    </div>
  );
}
