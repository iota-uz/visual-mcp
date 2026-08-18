import { useMutation, useQuery } from "convex/react";
import {
  Compass,
  FileCode,
  FileText,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  type LucideIcon,
  Pencil,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
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
import { formatAbsoluteTime, formatRelativeTime } from "../lib/formatDate";
import { useDocumentTitle } from "../lib/useDocumentTitle";

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
  // A signed thumbnail URL can expire, and the storage object can go missing
  // — the placeholder existed for a canvas with *no* render, never for one
  // whose render failed to load, which came up as a broken-image icon.
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const KindIcon = KIND_ICON[canvas.kind] ?? FileCode;
  // The ref an agent addresses this canvas by. It was invisible everywhere,
  // so the one string you need to say back to Claude had to be guessed.
  const ref = `${workspaceSlug}/${canvas.slug}`;
  const showThumbnail = canvas.thumbnail_url && !thumbnailFailed;

  return (
    <li className={`canvas-card canvas-card-${canvas.kind}`}>
      <Link to={`/c/${canvas.canvas_id}`} className="canvas-card-link">
        <span className="canvas-card-frame">
          {showThumbnail ? (
            <img
              src={canvas.thumbnail_url ?? undefined}
              alt=""
              className="canvas-card-thumbnail"
              onError={() => setThumbnailFailed(true)}
            />
          ) : (
            <span className="canvas-card-thumbnail canvas-card-thumbnail-empty">
              <KindIcon size={24} strokeWidth={1.5} aria-hidden="true" />
              <span>{canvas.thumbnail_url ? "render unavailable" : "no render yet"}</span>
            </span>
          )}
          {/* Kind, tinted with the viewer's own lane colour, so it reads
              before it is read. It used to be a word in a row of its own. */}
          <span className="canvas-card-kind" title={canvas.kind}>
            <KindIcon size={13} strokeWidth={2} aria-hidden="true" />
            <span className="visually-hidden">{canvas.kind}</span>
          </span>
          {/* Only when public. "Private" is the state of nearly every card
              here, so printing it spent a row to say nothing. */}
          {canvas.visibility === "public" && (
            <span className="canvas-card-shared" title="Shared publicly">
              <Globe size={13} strokeWidth={2} aria-hidden="true" />
              <span className="visually-hidden">shared publicly</span>
            </span>
          )}
        </span>
        {!editing && <strong className="canvas-card-title">{canvas.title}</strong>}
        {/* `updated_at` is why anyone opens a page sorted by recency, and it
            was the smallest grey thing on the card, below everything. */}
        <span className="canvas-card-meta">
          <time
            dateTime={new Date(canvas.updated_at).toISOString()}
            title={formatAbsoluteTime(canvas.updated_at)}
          >
            {formatRelativeTime(canvas.updated_at)}
          </time>
        </span>
        {canvas.description && (
          <span className="canvas-card-description">{canvas.description}</span>
        )}
      </Link>
      {editing ? (
        <RenameForm
          initial={canvas.title}
          label="Canvas title"
          onSave={(title) => rename({ canvasId: canvas.canvas_id, title })}
          onDone={() => setEditing(false)}
        />
      ) : (
        // Revealed on hover or focus, via 0fr → 1fr, which animates without
        // anyone having to measure a height. Always in the tab order.
        <div className="canvas-card-reveal">
          <div className="canvas-card-reveal-inner">
            <RefChip refValue={ref} className="canvas-card-ref" />
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
        </div>
      )}
    </li>
  );
}

export function WorkspacePage() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const workspace = useQuery(api.workspaces.getBySlug, wsSlug ? { slug: wsSlug } : "skip");
  useDocumentTitle(workspace?.name);
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
        icon={Compass}
        title={`No workspace at "${wsSlug}".`}
        hint={<Link to="/">Back to workspaces</Link>}
      />
    );
  }

  const count = canvases?.length;

  return (
    <div className="page-stack">
      <PageHeader
        title={workspace.name}
        subtitle={
          <>
            {count !== undefined && (
              <>
                {count} {count === 1 ? "canvas" : "canvases"} · newest first
                {workspace.description && " · "}
              </>
            )}
            {workspace.description}
          </>
        }
        back={{ to: "/", label: "Workspaces" }}
        actions={<RefChip refValue={workspace.slug} className="workspace-ref" />}
      />

      {canvases === undefined && <CardGridSkeleton cards={3} />}
      {canvases?.length === 0 && (
        <EmptyState
          title="No canvases yet."
          hint={
            <>
              Point your agent at this workspace over MCP — see{" "}
              <Link to="/settings/tokens">MCP tokens</Link>.
            </>
          }
        />
      )}
      {/* Rendered only when it has cards: an empty grid is invisible but
          still a stack child, so it used to open a gap under the empty
          state it sat beneath. */}
      {canvases !== undefined && canvases.length > 0 && (
        <ul className="canvas-grid">
          {canvases.map((c) => (
            <CanvasCard key={c.canvas_id} canvas={c} workspaceSlug={workspace.slug} />
          ))}
        </ul>
      )}
    </div>
  );
}
