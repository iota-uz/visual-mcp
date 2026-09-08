import { Copy, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { kindIcon } from "../lib/canvasKind";
import { writeClipboard } from "../lib/clipboard";
import { formatBytes } from "../lib/formatBytes";
import { formatRelativeTime } from "../lib/formatDate";
import { Badge } from "./Badge";
import { ConfirmButton } from "./ConfirmButton";
import { RenameForm } from "./RenameForm";
import { listRenderState, type StaticRenderState, StaticRenderStatus } from "./StaticRenderStatus";
import { useToast } from "./Toast";
import { Menu } from "./ui/Menu";

export interface CanvasCardRow {
  canvas_id: string;
  slug: string;
  title: string;
  description?: string;
  kind: string;
  visibility: "private" | "public";
  updated_at: number;
  thumbnail_url: string | null;
  static_render_status: StaticRenderState;
}

export interface CanvasCardProps {
  canvas: CanvasCardRow;
  /** For the `workspace/canvas` ref the ⋯ menu copies. */
  workspaceSlug: string;
  /** Omit both to render the card read-only — no ⋯ menu at all. */
  onRename?: (title: string) => Promise<unknown>;
  /** Hard purge. Resolves with what it reclaimed, for the toast. */
  onDelete?: () => Promise<{ bytes_reclaimed: number }>;
}

/*
 * One canvas, in a grid.
 *
 * The card is a `<li>` and not an `<a>`, because it carries a ⋯ menu, a
 * rename field and an armed confirmation, none of which may be nested in a
 * link. The title's link grows an overlay over the whole card instead
 * (`.card-hit`), so the card is one hit area with one accessible name and
 * the actions stay real buttons beside it.
 *
 * Until this existed there was no way to rename or delete a canvas from the
 * gallery at all: `canvases.renameMine` and `canvases.deleteMine` were only
 * reachable from inside the canvas you wanted to delete.
 */
export function CanvasCard({ canvas, workspaceSlug, onRename, onDelete }: CanvasCardProps) {
  const KindIcon = kindIcon(canvas.kind);
  // A signed thumbnail URL can expire and its storage object can go
  // missing, so "never rendered" and "the URL died" get the same honest
  // placeholder rather than a broken-image glyph.
  const [failed, setFailed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { notify } = useToast();
  const hasThumb = canvas.thumbnail_url && !failed;
  const canvasRef = `${workspaceSlug}/${canvas.slug}`;

  async function copyRef() {
    const failure = await writeClipboard(canvasRef);
    notify(
      failure
        ? { tone: "error", message: `Couldn't copy to the clipboard: ${failure}` }
        : { message: `Copied “${canvasRef}”.` },
    );
  }

  return (
    <li className={`canvas-card card-hit canvas-card-${canvas.kind}`}>
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
        {/* The chip is 22px square and always was: it is a mark over
            artwork, so it carries the icon and lets a screen reader read
            the word. It used to be handed the word itself, which spilled
            across the picture on every card. */}
        <span className="canvas-card-kind" title={canvas.kind}>
          <KindIcon size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="visually-hidden">{canvas.kind}</span>
        </span>
        <StaticRenderStatus state={listRenderState(canvas.static_render_status)} />
      </span>

      <div className="canvas-card-head">
        <div className="canvas-card-headings">
          <Link to={`/c/${canvas.canvas_id}`} className="canvas-card-link card-hit-link">
            <span className="canvas-card-title">{canvas.title}</span>
          </Link>
          <span className="canvas-card-meta">
            <time dateTime={new Date(canvas.updated_at).toISOString()}>
              {formatRelativeTime(canvas.updated_at)}
            </time>
            {canvas.visibility === "public" && <Badge tone="success">Shared</Badge>}
          </span>
        </div>
        {(onRename || onDelete) && (
          <Menu
            className="card-hit-actions"
            label={`Actions for ${canvas.title}`}
            items={[
              { id: "open", label: "Open", icon: ExternalLink, to: `/c/${canvas.canvas_id}` },
              { id: "copy", label: "Copy ref", icon: Copy, onSelect: () => void copyRef() },
              ...(onRename
                ? [
                    {
                      id: "rename",
                      label: "Rename",
                      icon: Pencil,
                      onSelect: () => setRenaming(true),
                    },
                  ]
                : []),
              ...(onDelete
                ? [
                    { id: "sep", separator: true as const },
                    {
                      id: "delete",
                      label: "Delete canvas…",
                      icon: Trash2,
                      danger: true,
                      onSelect: () => setConfirming(true),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>

      {canvas.description && <p className="canvas-card-description">{canvas.description}</p>}

      {renaming && onRename && (
        <RenameForm
          initial={canvas.title}
          label="Canvas title"
          onSave={onRename}
          onDone={() => setRenaming(false)}
        />
      )}
      {confirming && onDelete && (
        /* Already armed: choosing "Delete canvas…" in the menu was the
           first of the two decisions. */
        <ConfirmButton
          defaultArmed
          onDisarm={() => setConfirming(false)}
          confirmLabel="Delete canvas"
          busyLabel="Deleting…"
          description={`Deletes “${canvas.title}” and every version of it. Permanent.`}
          /* Failures are not caught here: ConfirmButton renders them in
             place, next to the thing that failed to delete. */
          onConfirm={async () => {
            const result = await onDelete();
            notify({
              message: `Deleted “${canvas.title}” — ${formatBytes(result.bytes_reclaimed)} freed.`,
            });
          }}
        />
      )}
    </li>
  );
}
