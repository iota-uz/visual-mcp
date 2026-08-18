import "@visual-canvas/canvas/theme.css";
import {
  type CanvasDoc,
  CanvasDocSchema,
  layoutCanvas,
  mountViewport,
} from "@visual-canvas/canvas";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, History, Info, Lock, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ConfirmButton } from "../components/ConfirmButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { RenameForm } from "../components/RenameForm";
import { toastError, useToast } from "../components/Toast";
import { Button, ButtonLink } from "../components/ui/Button";
import { CopyableValue } from "../components/ui/CopyableValue";
import { Disclosure } from "../components/ui/Disclosure";
import { Drawer } from "../components/ui/Drawer";
import { IconButton, IconLink } from "../components/ui/IconButton";
import { SectionHeader } from "../components/ui/SectionHeader";
import { formatBytes } from "../lib/formatBytes";
import { formatRelativeTime } from "../lib/formatDate";

// Mounts packages/canvas's framework-free viewport (pan/zoom/inspector/
// minimap/?node= deep-linking) directly against the fetched CanvasDoc —
// this is the client-side rendering path (PLAN.md Part 1 section 2/8),
// distinct from the worker's server-side render used for PNG/PDF export
// and for html/image/pdf-kind canvases (rendered via `entry_url` below).
export function CanvasViewport({ doc }: { doc: CanvasDoc }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setSearchParams = useSearchParams()[1];
  /*
   * Held in a ref, and deliberately out of the effect's dep array below.
   * react-router rebuilds `setSearchParams` whenever `location.search`
   * changes — which is exactly what `onSelect` does — so having it as a dep
   * meant every node click disposed the viewport, rebuilt the DOM and
   * re-ran fitAll(). Clicking a node, or clicking empty space to deselect,
   * threw away whatever the user had panned and zoomed to.
   */
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let positioned: ReturnType<typeof layoutCanvas>;
    try {
      positioned = layoutCanvas(doc);
    } catch (err) {
      container.textContent = `Layout error: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    const controller = mountViewport({
      container,
      canvas: positioned,
      onSelect: (nodeId) => {
        /*
         * `replace`, not push. Selection is view state, not navigation: the
         * URL exists so a selected node can be linked and reloaded, and the
         * viewport has no listener for the reverse direction, so a pushed
         * entry would rewind the URL while leaving the node visibly
         * selected — and 15 node clicks would cost 15 Backs to leave the
         * page. Escape (handled inside the viewport) is the deselect.
         */
        setSearchParamsRef.current(nodeId ? { node: nodeId } : {}, { replace: true });
      },
    });
    controller.fitAll();

    // Read the deep-linked node directly from the URL rather than the
    // reactive `useSearchParams` value on purpose — this effect should only
    // re-run when `doc` changes, not on every node selection (which also
    // updates the URL's search params via setSearchParams above).
    const initialNode = new URLSearchParams(window.location.search).get("node");
    if (initialNode) controller.selectNode(initialNode, true);

    return () => controller.dispose();
  }, [doc]);

  return <div ref={containerRef} className="vc-viewport-host" />;
}

function PublishControl({
  canvasId,
  visibility,
  publicSlug,
}: {
  canvasId: Id<"canvases">;
  visibility: "private" | "public";
  publicSlug: string | undefined;
}) {
  const publish = useMutation(api.canvases.publishMine);
  const rotateSlug = useMutation(api.canvases.rotateMySlug);
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const shareUrl = publicSlug ? `${window.location.origin}/s/${publicSlug}` : null;

  async function publishNow() {
    setBusy(true);
    try {
      await publish({ canvasId, visibility: "public" });
      notify({ message: "Published — the share link is live." });
    } catch (err: unknown) {
      notify(toastError(err, "Couldn't publish"));
    } finally {
      setBusy(false);
    }
  }

  // Unpublishing and rotating both kill every link already in circulation,
  // instantly and with no way back — so both arm first, same as a delete.
  async function unpublish() {
    await publish({ canvasId, visibility: "private" });
    notify({ message: "Now private — the old share link no longer resolves." });
  }

  async function rotate() {
    await rotateSlug({ canvasId });
    notify({ message: "New share link generated — the old one is dead." });
  }

  return (
    <div className="publish-control">
      {visibility === "public" ? (
        <ConfirmButton
          label="Make private"
          confirmLabel="Really make private?"
          busyLabel="Updating…"
          tone="warning"
          icon={Lock}
          description="Every link you have shared stops working."
          onConfirm={unpublish}
        />
      ) : (
        <Button variant="primary" onClick={publishNow} busy={busy}>
          {busy ? "Publishing…" : "Publish"}
        </Button>
      )}
      {visibility === "public" && shareUrl && (
        <>
          {/* The whole point of publishing is handing someone a URL. This
              used to be dead muted text printing a *relative* path, so the
              one thing a human came here for had to be retyped by hand. */}
          <CopyableValue
            className="share-link-row"
            as="link"
            value={shareUrl}
            copyLabel="Copy link"
          />
          <ConfirmButton
            label="Rotate link"
            confirmLabel="Really rotate?"
            busyLabel="Rotating…"
            tone="warning"
            icon={RefreshCw}
            description="Mints a new link and permanently breaks the current one."
            onConfirm={rotate}
          />
        </>
      )}
    </div>
  );
}

function RestoreButton({ canvasId, version }: { canvasId: Id<"canvases">; version: number }) {
  const restore = useMutation(api.canvases.restoreVersionMine);
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setBusy(true);
    setError(null);
    try {
      await restore({ canvasId, version });
      // Restoring just re-points `currentVersionId` — nothing is destroyed
      // and no new version is minted — so without this the only signal is
      // the document quietly changing underneath you.
      notify({ message: `v${version} is now the current version.` });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" icon={History} onClick={handleRestore} busy={busy}>
        {busy ? "Restoring…" : "Restore"}
      </Button>
      {error && <span className="error-text">{error}</span>}
    </>
  );
}

// The rows used to be inert text: the backend has kept every version since
// v1, but a human could see them and not act on them. Restoring is
// non-destructive — `restoreVersion` only re-points `currentVersionId` at an
// existing version, minting nothing and discarding nothing — so unlike delete
// it needs no armed confirmation. Only the current version's row has no
// button, since restoring it would be a no-op.
function VersionHistory({ canvasId }: { canvasId: Id<"canvases"> }) {
  const versions = useQuery(api.canvases.listVersionsMine, { canvasId });

  if (versions === undefined) return <LoadingState label="Loading version history…" />;
  if (versions.length === 0) return null;

  return (
    <Disclosure className="version-history" summary={`Version history (${versions.length})`}>
      <ul className="card-list">
        {versions.map((v) => (
          <li key={v.versionId} className="card-list-item">
            <div>
              <strong>
                v{v.version}
                {v.isCurrent && " (current)"}
              </strong>
              {v.note && <span className="muted"> — {v.note}</span>}
              <span className="muted">
                {" "}
                · {new Date(v.createdAt).toLocaleString()}
                {v.createdByEmail && ` · ${v.createdByEmail}`}
              </span>
            </div>
            {!v.isCurrent && (
              <div className="row-item-actions">
                <RestoreButton canvasId={canvasId} version={v.version} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

interface FetchableCanvas {
  kind: string;
  doc_url: string | null;
  css_url: string | null;
}

// Shared by CanvasPage (signed-in) and PublicCanvasPage (anonymous
// /s/:slug) — both resolve a canvas summary first, then need this same
// doc-fetch-and-validate plus compiled-Tailwind-CSS-injection sequence.
export function useCanvasDocAndCss(canvas: FetchableCanvas | null | undefined) {
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  // Keyed on the two fields the fetch actually depends on, not the whole
  // `canvas` object: Convex hands back a fresh object on *any* field change,
  // so renaming or publishing used to blank the doc, flash "Loading canvas…"
  // full-screen, refetch, and remount the viewport — losing your pan/zoom.
  const kind = canvas?.kind;
  const docUrl = canvas?.doc_url ?? null;

  useEffect(() => {
    setDoc(null);
    setDocError(null);
    if (kind !== "canvas" || !docUrl) return;
    let cancelled = false;
    fetch(docUrl)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const parsed = CanvasDocSchema.safeParse(json);
        if (!parsed.success) {
          setDocError(`Stored document failed validation: ${parsed.error.message}`);
          return;
        }
        setDoc(parsed.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDocError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, docUrl]);

  // Compiled Tailwind CSS for the doc's HTML nodes (PLAN.md section 2) —
  // injected as a page-level <style> tag before the viewport mounts, so
  // Tailwind-classed node mockups aren't unstyled on first paint. `cssReady`
  // starts false so mounting waits for either the fetch to land or for
  // there being nothing to fetch, rather than racing it.
  const [cssReady, setCssReady] = useState(false);
  useEffect(() => {
    setCssReady(false);
    if (!canvas?.css_url) {
      setCssReady(true);
      return;
    }
    let cancelled = false;
    let styleEl: HTMLStyleElement | null = null;
    fetch(canvas.css_url)
      .then((res) => res.text())
      .then((css) => {
        if (cancelled) return;
        styleEl = document.createElement("style");
        styleEl.setAttribute("data-vc-node-css", "");
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
        setCssReady(true);
      })
      .catch(() => {
        if (!cancelled) setCssReady(true);
      });
    return () => {
      cancelled = true;
      styleEl?.remove();
    };
  }, [canvas?.css_url]);

  return { doc, docError, cssReady };
}

export function CanvasPage() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const canvas = useQuery(
    api.canvases.getMine,
    canvasId ? { canvasId: canvasId as Id<"canvases"> } : "skip",
  );
  const { doc, docError, cssReady } = useCanvasDocAndCss(canvas);

  const workspace = useQuery(
    api.workspaces.getById,
    canvas ? { workspaceId: canvas.workspace_id } : "skip",
  );

  const rename = useMutation(api.canvases.renameMine);
  const remove = useMutation(api.canvases.deleteMine);
  const { notify } = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Labelled with the workspace's real name once it resolves. It used to
  // always read "Workspace" and point at "/" until the query landed — so an
  // early click sent you Home, and a fast delete navigated there too.
  const backTo = workspace ? `/w/${workspace.slug}` : "/";
  const backLabel = workspace ? workspace.name : "Workspaces";

  // HTML/PDF/image artifacts own their viewport, including any controls in
  // their top edge. Mark that mode on the app root so global navigation can
  // move to the lower-left utility cluster instead of covering the artifact.
  useEffect(() => {
    const isArtifact = canvas?.kind !== undefined && canvas.kind !== "canvas";
    document.documentElement.classList.toggle("is-artifact-canvas-view", isArtifact);
    return () => document.documentElement.classList.remove("is-artifact-canvas-view");
  }, [canvas?.kind]);

  if (canvas === undefined) {
    return (
      <div className="canvas-page-full">
        <div className="canvas-page-loading">
          <LoadingState />
        </div>
      </div>
    );
  }
  if (canvas === null) {
    return (
      <div className="canvas-page-full">
        <div className="canvas-page-loading">
          <EmptyState title="Canvas not found." hint={<Link to="/">Back to workspaces</Link>} />
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-page-full">
      {canvas.kind === "canvas" ? (
        <div className="canvas-command-bar">
          <IconLink
            to={backTo}
            icon={ArrowLeft}
            label={`Back to ${backLabel}`}
            className="canvas-command-back"
          />
          <div className="canvas-command-title">
            <span>{canvas.title}</span>
            {canvas.version !== undefined && <small>v{canvas.version}</small>}
          </div>
          <IconButton
            icon={Info}
            label="Open canvas details"
            text="Details"
            iconSize={17}
            className="canvas-command-details"
            onClick={() => setDetailsOpen(true)}
            aria-expanded={detailsOpen}
            aria-controls="canvas-details"
          />
        </div>
      ) : (
        <IconButton
          icon={Info}
          label="Open canvas details"
          text="Details"
          iconSize={18}
          className="canvas-artifact-details-trigger"
          onClick={() => setDetailsOpen(true)}
          aria-expanded={detailsOpen}
          aria-controls="canvas-details"
        />
      )}

      <Drawer
        id="canvas-details"
        className="canvas-details"
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Canvas details"
        closeLabel="Close canvas details"
      >
        {/* The rename form replaces the header rather than nesting inside
            it: PageHeader's title is an <h1>, which may only contain
            phrasing content — a <form> in there is invalid markup. */}
        {editing ? (
          <RenameForm
            initial={canvas.title}
            label="Canvas title"
            onSave={(title) => rename({ canvasId: canvas.canvas_id, title })}
            onDone={() => setEditing(false)}
          />
        ) : (
          <SectionHeader
            as="h3"
            title={canvas.title}
            back={{ to: backTo, label: backLabel }}
            /* Which version am I looking at, and when did an agent last
               touch it? Both were already in the payload; you had to expand
               the version history to learn either. */
            subtitle={
              <>
                {canvas.version !== undefined && `v${canvas.version} · `}
                {formatRelativeTime(canvas.updated_at)}
                {canvas.description && ` · ${canvas.description}`}
              </>
            }
            actions={
              <>
                {canvas.kind !== "canvas" && canvas.entry_url && (
                  // Guaranteed path to the artifact. The in-page preview can
                  // legitimately come up blank (see the iframe note below),
                  // and without this the user is simply stuck.
                  <ButtonLink
                    href={canvas.entry_public_url ?? canvas.entry_url}
                    variant="ghost"
                    size="sm"
                    icon={ExternalLink}
                  >
                    Open
                  </ButtonLink>
                )}
                <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
                  Rename
                </Button>
                {/* Navigate in the same tick the delete resolves: `getMine`
                    is reactive and would otherwise flip to null under us and
                    flash "Canvas not found." */}
                <ConfirmButton
                  description="Deletes this canvas and every version of it. Permanent."
                  onConfirm={async () => {
                    const result = await remove({ canvasId: canvas.canvas_id });
                    navigate(backTo);
                    notify({
                      message: `Deleted "${canvas.title}" — ${formatBytes(result.bytes_reclaimed)} freed.`,
                    });
                  }}
                />
              </>
            }
          />
        )}
        {canvas.kind !== "canvas" && canvas.entry_url && (
          // Verified live: agent-authored HTML that measures itself at parse
          // time computes a degenerate layout inside a cross-origin frame and
          // comes up blank here, while the same URL renders instantly at top
          // level. Nothing in this app can fix someone else's document, so
          // say so and point at Open.
          <p className="canvas-preview-hint">
            The preview is a live frame — some artifacts only lay out correctly at top level. If it
            looks blank, use <strong>Open</strong>.
          </p>
        )}
        <PublishControl
          canvasId={canvas.canvas_id}
          visibility={canvas.visibility}
          publicSlug={canvas.public_slug}
        />
        <VersionHistory canvasId={canvas.canvas_id} />
      </Drawer>
      {canvas.kind === "canvas" ? (
        <>
          {docError && <p className="error-text canvas-page-loading">{docError}</p>}
          {/* `!doc` alone left a genuinely blank page in the window where
              the doc had landed but its compiled CSS had not: the loading
              text was gone and the viewport had not mounted yet. */}
          {(!doc || !cssReady) && !docError && (
            <div className="canvas-page-loading">
              <LoadingState label="Loading canvas…" />
            </div>
          )}
          {doc && cssReady && <CanvasViewport doc={doc} />}
        </>
      ) : canvas.entry_url ? (
        <div
          className={`canvas-artifact-full${
            canvas.kind === "image" ? "" : " canvas-artifact-full-embedded"
          }`}
        >
          {canvas.kind === "image" ? (
            <img src={canvas.entry_url} alt={canvas.title} className="artifact-preview" />
          ) : (
            // The preview is a convenience, not a guarantee: agent-authored
            // HTML that measures itself at parse time lays out to nothing
            // inside a cross-origin frame. `entry_public_url` (the /s/ path)
            // is preferred because a page's own relative refs — ../assets/x —
            // only resolve when it is served under its canvas; it is null for
            // private canvases, which is why the escape hatch sits next to it.
            <iframe
              src={canvas.entry_public_url ?? canvas.entry_url}
              title={canvas.title}
              className="artifact-preview-frame"
            />
          )}
        </div>
      ) : (
        <div className="canvas-page-loading">
          <EmptyState title="No render yet." hint="Ask Claude to render this canvas." />
        </div>
      )}
    </div>
  );
}
