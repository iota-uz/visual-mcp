import { useMutation, useQuery } from "convex/react";
import { Compass, Pencil, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ConfirmButton } from "../components/ConfirmButton";
import { ConnectPanel } from "../components/ConnectPanel";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { RenameForm } from "../components/RenameForm";
import { ListSkeleton } from "../components/Skeleton";
import { toastError, useToast } from "../components/Toast";
import { Button } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { IconButton } from "../components/ui/IconButton";
import { TextInput } from "../components/ui/TextInput";
import { formatBytes } from "../lib/formatBytes";
import { useDebouncedValue } from "../lib/useDebouncedValue";

/** Backend cap on `searchNodes` — results are silently truncated at this. */
const SEARCH_LIMIT = 20;

/** Thumbnails in a workspace lane's strip. Four fits the row at any width. */
const LANE_PREVIEW = 4;

interface SearchResult {
  canvasId: string;
  canvasTitle: string;
  workspaceId: string;
  nodeId: string;
  nodeTitle: string;
  nodeEyebrow?: string;
}

function SearchResults({
  results,
  workspaceNames,
}: {
  results: SearchResult[] | undefined;
  workspaceNames: Map<string, string>;
}) {
  if (results === undefined) return <p className="muted">Searching…</p>;
  if (results.length === 0) {
    return <EmptyState title="No matches." hint="Search covers node text, not canvas titles." />;
  }
  return (
    <>
      <p className="muted node-search-count">
        {results.length === SEARCH_LIMIT
          ? `First ${SEARCH_LIMIT} matches`
          : `${results.length} ${results.length === 1 ? "match" : "matches"}`}
      </p>
      <ul className="card-list">
        {results.map((r) => (
          <li key={`${r.canvasId}:${r.nodeId}`} className="card-list-item">
            {/* `searchNodes` has always returned the workspace id and this
                page has always held the workspace list; the join is free,
                and without it two identically-titled nodes in different
                workspaces were indistinguishable. */}
            <span className="eyebrow">
              {workspaceNames.get(r.workspaceId) ?? "workspace"} / {r.canvasTitle}
            </span>
            <Link to={`/c/${r.canvasId}?node=${encodeURIComponent(r.nodeId)}`}>
              <strong>{r.nodeTitle}</strong>
              {r.nodeEyebrow && <span className="muted"> — {r.nodeEyebrow}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function NodeSearch({
  workspaceNames,
  children,
}: {
  workspaceNames: Map<string, string>;
  /** The workspace list, shown when nothing is being searched for. */
  children: React.ReactNode;
}) {
  // The query lives in the URL so a search survives a reload and Back
  // returns to it instead of dropping the user on a blank Home.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [term, setTerm] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  // Debounced: every keystroke used to open a fresh Convex subscription,
  // so typing "europrotocol" cost twelve full-text queries and rendered
  // twelve throwaway result sets.
  const query = useDebouncedValue(term.trim(), 250);
  const results = useQuery(api.canvases.searchNodes, query ? { query } : "skip");

  useEffect(() => {
    // Bail when the URL already says this — otherwise mount alone fires a
    // navigate, and so does every arrival via a `?q=` link.
    if (query === urlQuery) return;
    // `replace` so a search doesn't stack one history entry per debounce.
    setSearchParams(query ? { q: query } : {}, { replace: true });
  }, [query, urlQuery, setSearchParams]);

  function clear() {
    setTerm("");
    inputRef.current?.focus();
  }

  return (
    <>
      <div className="node-search">
        <TextInput
          id="node-search-input"
          label="Search canvas nodes"
          className="node-search-field"
          inputRef={inputRef}
          leadingIcon={Search}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") clear();
          }}
          placeholder="Search canvas nodes…"
          trailingSlot={
            term && (
              <IconButton
                icon={X}
                label="Clear search"
                iconSize={14}
                className="field-action"
                onClick={clear}
              />
            )
          }
        />
      </div>
      {/* Results *replace* the list rather than stacking above it. Stacked,
          searching left the whole unfiltered list sitting underneath the
          thing you were searching for. */}
      <div className="node-search-region" aria-live="polite">
        {query ? <SearchResults results={results} workspaceNames={workspaceNames} /> : children}
      </div>
    </>
  );
}

interface WorkspaceSummary {
  workspace_id: Id<"workspaces">;
  slug: string;
  name: string;
  description?: string;
}

function WorkspaceLane({ workspace }: { workspace: WorkspaceSummary }) {
  // `listMine` returns no canvas count, and convex/ is off-limits here, so
  // the count is derived client-side from the same query the workspace page
  // uses. Accurate (it already filters archived rows) at the cost of one
  // extra subscription per row; the alternative — printing nothing — would
  // also leave the delete confirmation unable to say what is being lost.
  const canvases = useQuery(api.canvases.listForWorkspace, {
    workspaceId: workspace.workspace_id,
  });
  const rename = useMutation(api.workspaces.renameMine);
  const remove = useMutation(api.workspaces.deleteMine);
  const { notify } = useToast();
  const [editing, setEditing] = useState(false);

  const count = canvases?.length;
  const recent = canvases?.slice(0, LANE_PREVIEW) ?? [];

  if (editing) {
    return (
      <li className="card-list-item">
        <RenameForm
          initial={workspace.name}
          label="Workspace name"
          onSave={(name) => rename({ workspaceId: workspace.workspace_id, name })}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="card-list-item workspace-lane">
      <div className="workspace-lane-head">
        <div className="workspace-lane-name">
          <Link to={`/w/${workspace.slug}`}>
            <strong>{workspace.name}</strong>
          </Link>
          {count !== undefined && (
            <span className="eyebrow workspace-lane-count">
              {count} {count === 1 ? "canvas" : "canvases"}
            </span>
          )}
        </div>
        {/* Dimmed until the row is hovered or something inside it is
            focused — never hidden, so they stay in the tab order and stay
            findable by anyone not using a pointer. */}
        <div className="row-item-actions workspace-lane-actions">
          <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
            Rename
          </Button>
          <ConfirmButton
            description={
              count === undefined
                ? "Deletes this workspace and every canvas in it. Permanent."
                : `Deletes this workspace and ${count} ${count === 1 ? "canvas" : "canvases"}. Permanent.`
            }
            onConfirm={async () => {
              // The mutation has always returned what it destroyed; the row
              // just vanished and never said so.
              const result = await remove({ workspaceId: workspace.workspace_id });
              notify({
                message: `Deleted "${workspace.name}" — ${result.canvases_deleted} ${
                  result.canvases_deleted === 1 ? "canvas" : "canvases"
                }, ${formatBytes(result.bytes_reclaimed)} freed.`,
              });
            }}
          />
        </div>
      </div>
      {workspace.description && (
        <p className="muted workspace-lane-note">{workspace.description}</p>
      )}
      {/* What is actually in here, without going in. */}
      {recent.length > 0 && (
        <ul className="workspace-lane-strip">
          {recent.map((c) => (
            <li key={c.canvas_id}>
              <Link to={`/c/${c.canvas_id}`} title={c.title}>
                {c.thumbnail_url ? (
                  <img src={c.thumbnail_url} alt="" />
                ) : (
                  <span className="workspace-lane-blank" />
                )}
                <span className="visually-hidden">{c.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function HomePage() {
  const workspaces = useQuery(api.workspaces.listMine, {});
  const createWorkspace = useMutation(api.workspaces.createMine);
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const newWorkspaceRef = useRef<HTMLInputElement>(null);

  // Focus follows the reveal. Via a ref rather than the autoFocus attribute:
  // autoFocus is announced badly by screen readers, and biome rejects it.
  useEffect(() => {
    if (addingWorkspace) newWorkspaceRef.current?.focus();
  }, [addingWorkspace]);

  const workspaceNames = new Map((workspaces ?? []).map((w) => [w.workspace_id as string, w.name]));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createWorkspace({ name: name.trim() });
      setName("");
      setAddingWorkspace(false);
    } catch (err: unknown) {
      notify(toastError(err, "Couldn't create the workspace"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page-stack">
      {/* The create form lives in the header, not in a band of its own above
          the list: with twenty workspaces it used to be below the fold, so
          the one action on the page was the one thing you had to scroll to
          find. Folded away because agents create almost all of these. */}
      <PageHeader
        title="Workspaces"
        actions={
          !addingWorkspace && (
            <Button variant="secondary" icon={Plus} onClick={() => setAddingWorkspace(true)}>
              New workspace
            </Button>
          )
        }
      />
      {addingWorkspace && (
        <form onSubmit={handleCreate} className="inline-form">
          <TextInput
            id="new-workspace-name"
            label="New workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAddingWorkspace(false);
            }}
            placeholder="New workspace name"
            disabled={creating}
            inputRef={newWorkspaceRef}
          />
          <Button type="submit" variant="primary" busy={creating} disabled={!name.trim()}>
            {creating ? "Creating…" : "Create"}
          </Button>
          <Button variant="ghost" onClick={() => setAddingWorkspace(false)} disabled={creating}>
            Cancel
          </Button>
        </form>
      )}
      <NodeSearch workspaceNames={workspaceNames}>
        {workspaces === undefined && <ListSkeleton rows={3} />}
        {workspaces?.length === 0 && (
          <EmptyState
            icon={Compass}
            title="No workspaces yet."
            hint="Create one above, or let an agent create it for you on its first save."
          />
        )}
        {/* Rendered only when it has rows: an empty <ul> is invisible but
            still counts as a stack child, so it used to add a gap between the
            empty state and the connect instructions. */}
        {workspaces !== undefined && workspaces.length > 0 && (
          <ul className="card-list">
            {workspaces.map((w) => (
              <WorkspaceLane key={w.workspace_id} workspace={w} />
            ))}
          </ul>
        )}
      </NodeSearch>
      {/* Connecting an agent is the only way canvases ever get created, so
          the instructions must stay reachable forever — they used to render
          only while the account had zero workspaces, which meant the moment
          you succeeded once they vanished and were never findable again.
          Open by default while there is nothing to look at, folded away
          once there is. */}
      {workspaces !== undefined && (
        <Disclosure
          className="connect-disclosure"
          summary="Connect an agent"
          open={workspaces.length === 0}
        >
          <ConnectPanel />
        </Disclosure>
      )}
    </div>
  );
}
