import { useQuery } from "convex/react";
import { Images, Unplug } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { CardGridSkeleton } from "../components/Skeleton";
import { ButtonLink } from "../components/ui/Button";
import { RefChip } from "../components/ui/CopyableValue";
import { kindIcon } from "../lib/canvasKind";
import { formatRelativeTime } from "../lib/formatDate";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/*
 * The workspace's canvases.
 *
 * PLAN.md's route table has always described `/w/:wsSlug` as the canvas
 * grid, but the route rendered the asset library instead: clicking a
 * workspace in the sidebar showed you its *images*, and the canvas
 * viewer's "Back to {workspace}" landed in the same wrong place. The
 * gallery's stylesheet (patterns/canvas-card.css) and its skeleton
 * (CardGridSkeleton) were still in the build, rendered by nothing.
 *
 * Assets keep their own page, one level down at `/w/:wsSlug/assets`.
 */

interface GalleryCanvas {
  canvas_id: string;
  slug: string;
  title: string;
  description?: string;
  kind: string;
  visibility: "private" | "public";
  updated_at: number;
  thumbnail_url: string | null;
}

function CanvasCard({ canvas, workspaceSlug }: { canvas: GalleryCanvas; workspaceSlug: string }) {
  const KindIcon = kindIcon(canvas.kind);
  // A signed thumbnail URL can expire and its storage object can go
  // missing, so "never rendered" and "the URL died" get the same honest
  // placeholder rather than a broken-image glyph.
  const [failed, setFailed] = useState(false);
  const hasThumb = canvas.thumbnail_url && !failed;

  return (
    <li className={`canvas-card canvas-card-${canvas.kind}`}>
      <Link to={`/c/${canvas.canvas_id}`} className="canvas-card-link">
        <span className="canvas-card-frame">
          {hasThumb ? (
            <img
              src={canvas.thumbnail_url as string}
              alt=""
              className="canvas-card-thumbnail"
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="canvas-card-thumbnail canvas-card-thumbnail-empty">
              <KindIcon size={20} strokeWidth={1.5} aria-hidden="true" />
              No render yet
            </span>
          )}
          <span className="canvas-card-kind">{canvas.kind}</span>
          {canvas.visibility === "public" && <span className="canvas-card-shared">Shared</span>}
        </span>
        <span className="canvas-card-title">{canvas.title}</span>
        <span className="canvas-card-meta">
          <time dateTime={new Date(canvas.updated_at).toISOString()}>
            {formatRelativeTime(canvas.updated_at)}
          </time>
        </span>
        {canvas.description && (
          <span className="canvas-card-description">{canvas.description}</span>
        )}
      </Link>
      {/* Outside the anchor: a copy button nested in a link is neither a
          link nor a button to a screen reader, and steals the click. */}
      <div className="canvas-card-reveal">
        <div className="canvas-card-reveal-inner">
          <RefChip className="canvas-card-ref" refValue={`${workspaceSlug}/${canvas.slug}`} />
        </div>
      </div>
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
  useDocumentTitle(workspace?.name);

  if (workspace === null) {
    return (
      <EmptyState
        icon={Unplug}
        title="No workspace at this address."
        hint={<Link to="/">Back to workspaces</Link>}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={workspace?.name ?? wsSlug ?? "Workspace"}
        subtitle={workspace?.description}
        actions={
          wsSlug ? (
            <ButtonLink to={`/w/${wsSlug}/assets`} variant="secondary" icon={Images}>
              Assets
            </ButtonLink>
          ) : undefined
        }
      />
      {canvases === undefined ? (
        <CardGridSkeleton cards={6} />
      ) : canvases.length === 0 ? (
        <EmptyState
          title="No canvases here yet."
          hint="Ask your agent to save one into this workspace over MCP."
        />
      ) : (
        <ul className="canvas-grid">
          {(canvases as GalleryCanvas[]).map((canvas) => (
            <CanvasCard key={canvas.canvas_id} canvas={canvas} workspaceSlug={wsSlug ?? ""} />
          ))}
        </ul>
      )}
    </>
  );
}
