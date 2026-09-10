import { useMutation, useQuery } from "convex/react";
import { Images, LayoutDashboard, Search, Unplug, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CanvasCard, type CanvasCardRow } from "../components/CanvasCard";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { CardGridSkeleton } from "../components/Skeleton";
import { Button, ButtonLink } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Select, TextInput } from "../components/ui/TextInput";
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

interface GalleryCanvas extends CanvasCardRow {
  canvas_id: Id<"canvases">;
}

type Sort = "updated" | "title" | "kind";

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title A–Z" },
  { value: "kind", label: "Kind" },
];

/*
 * Filter and sort are client-side on purpose: `listForWorkspace` already
 * returns the whole list to render it, so a server round trip would buy
 * nothing and cost a debounce. That is the opposite of Home's `?q=` search,
 * which crosses workspaces and does have to ask the backend.
 */
function arrange(canvases: GalleryCanvas[], filter: string, sort: Sort): GalleryCanvas[] {
  const needle = filter.trim().toLowerCase();
  const matched = needle
    ? canvases.filter((canvas) =>
        [canvas.title, canvas.description ?? "", canvas.slug, canvas.kind].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      )
    : canvases;
  return [...matched].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "kind") return a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title);
    return b.updated_at - a.updated_at;
  });
}

export function WorkspacePage() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const workspace = useQuery(api.workspaces.getBySlug, wsSlug ? { slug: wsSlug } : "skip");
  const canvases = useQuery(
    api.canvases.listForWorkspace,
    workspace ? { workspaceId: workspace.workspace_id } : "skip",
  ) as GalleryCanvas[] | undefined;
  const rename = useMutation(api.canvases.renameMine);
  const renameWorkspace = useMutation(api.workspaces.renameMine);
  const remove = useMutation(api.canvases.deleteMine);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  useDocumentTitle(workspace?.name);

  const shown = useMemo(() => arrange(canvases ?? [], filter, sort), [canvases, filter, sort]);
  const count = canvases?.length ?? 0;
  const crumbs = [{ to: "/", label: "Workspaces" }];

  if (workspace === null) {
    // Still inside the page shell: an address that resolves to nothing is
    // exactly where you need the way out to be on screen.
    return (
      <div className="page-stack">
        <PageHeader title={wsSlug ?? "Workspace"} crumbs={crumbs} />
        <EmptyState
          icon={Unplug}
          title="No workspace at this address."
          hint={<Link to="/">Back to workspaces</Link>}
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={workspace?.name ?? wsSlug ?? "Workspace"}
        crumbs={crumbs}
        onRename={
          workspace
            ? (name) => renameWorkspace({ workspaceId: workspace.workspace_id, name })
            : undefined
        }
        renameLabel="Workspace name"
        // Falls back to the count so the header is never a lone title on a
        // workspace nobody wrote a description for.
        subtitle={
          workspace?.description ??
          (canvases ? `${count} ${count === 1 ? "canvas" : "canvases"}` : undefined)
        }
        actions={
          wsSlug ? (
            <>
              <ButtonLink to={`/w/${wsSlug}/videos`} variant="secondary">
                Video Studio
              </ButtonLink>
              <ButtonLink to={`/w/${wsSlug}/assets`} variant="secondary" icon={Images}>
                Assets
              </ButtonLink>
            </>
          ) : undefined
        }
      />
      {count > 1 && (
        <div className="list-toolbar">
          <TextInput
            id="canvas-filter"
            label="Filter canvases"
            className="list-toolbar-search"
            leadingIcon={Search}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setFilter("");
            }}
            placeholder="Filter canvases…"
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
          <div className="list-toolbar-controls">
            <Select
              id="canvas-sort"
              label="Sort canvases"
              options={SORTS}
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            />
          </div>
        </div>
      )}
      {canvases === undefined ? (
        <CardGridSkeleton cards={6} />
      ) : count === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No canvases here yet."
          hint="Ask your agent to save one into this workspace over MCP."
          action={
            wsSlug ? (
              <ButtonLink to={`/w/${wsSlug}/assets`} variant="ghost" icon={Images}>
                Browse assets
              </ButtonLink>
            ) : undefined
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Search}
          title={`No canvases match “${filter.trim()}”.`}
          action={
            <Button variant="ghost" onClick={() => setFilter("")}>
              Show all canvases
            </Button>
          }
        />
      ) : (
        <ul className="card-grid">
          {shown.map((canvas) => (
            <CanvasCard
              key={canvas.canvas_id}
              canvas={canvas}
              workspaceSlug={wsSlug ?? ""}
              onRename={(title) => rename({ canvasId: canvas.canvas_id, title })}
              onDelete={() => remove({ canvasId: canvas.canvas_id })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
