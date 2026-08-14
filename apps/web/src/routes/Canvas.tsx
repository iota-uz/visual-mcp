import "@visual-canvas/canvas/theme.css";
import {
  type CanvasDoc,
  CanvasDocSchema,
  layoutCanvas,
  mountViewport,
} from "@visual-canvas/canvas";
import { useMutation, useQuery } from "convex/react";
import { History, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ConfirmButton } from "../components/ConfirmButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RenameForm } from "../components/RenameForm";

// Mounts packages/canvas's framework-free viewport (pan/zoom/inspector/
// minimap/?node= deep-linking) directly against the fetched CanvasDoc —
// this is the client-side rendering path (PLAN.md Part 1 section 2/8),
// distinct from the worker's server-side render used for PNG/PDF export
// and for html/image/pdf-kind canvases (rendered via `entry_url` below).
export function CanvasViewport({ doc }: { doc: CanvasDoc }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setSearchParams = useSearchParams()[1];

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
        setSearchParams(nodeId ? { node: nodeId } : {}, { replace: true });
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
  }, [doc, setSearchParams]);

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
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await publish({
        canvasId,
        visibility: visibility === "public" ? "private" : "public",
      });
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      await rotateSlug({ canvasId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="publish-control">
      <button
        type="button"
        className={visibility === "public" ? "btn btn-secondary" : "btn btn-primary"}
        onClick={toggle}
        disabled={busy}
      >
        {visibility === "public" ? "Make private" : "Publish"}
      </button>
      {visibility === "public" && publicSlug && (
        <>
          <span className="muted">shared at /s/{publicSlug}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={rotate}
            disabled={busy}
          >
            Rotate link
          </button>
        </>
      )}
    </div>
  );
}

function RestoreButton({ canvasId, version }: { canvasId: Id<"canvases">; version: number }) {
  const restore = useMutation(api.canvases.restoreVersionMine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setBusy(true);
    setError(null);
    try {
      await restore({ canvasId, version });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={handleRestore}
        disabled={busy}
      >
        <History size={14} /> {busy ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="error-text">{error}</span>}
    </>
  );
}

// The rows used to be inert text: the backend has kept every version since
// v1, but a human could see them and not act on them. Restoring is
// non-destructive (it writes a new current version from an old one), so
// unlike delete it needs no armed confirmation — only the current version's
// row has no button, since restoring it would just churn history.
function VersionHistory({ canvasId }: { canvasId: Id<"canvases"> }) {
  const versions = useQuery(api.canvases.listVersionsMine, { canvasId });

  if (versions === undefined) return <LoadingState label="Loading version history…" />;
  if (versions.length === 0) return null;

  return (
    <details className="version-history">
      <summary>Version history ({versions.length})</summary>
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
    </details>
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

  useEffect(() => {
    setDoc(null);
    setDocError(null);
    if (canvas?.kind !== "canvas" || !canvas.doc_url) return;
    let cancelled = false;
    fetch(canvas.doc_url)
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
  }, [canvas]);

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
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const backTo = workspace ? `/w/${workspace.slug}` : "/";

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
          <EmptyState title="Canvas not found." />
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-page-full">
      <div className="canvas-floating-header">
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
          <PageHeader
            title={canvas.title}
            back={{ to: backTo, label: "Workspace" }}
            actions={
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} /> Rename
                </button>
                {/* Navigate in the same tick the delete resolves: `getMine`
                    is reactive and would otherwise flip to null under us and
                    flash "Canvas not found." */}
                <ConfirmButton
                  description="Deletes this canvas and every version of it. Permanent."
                  onConfirm={async () => {
                    await remove({ canvasId: canvas.canvas_id });
                    navigate(backTo);
                  }}
                />
              </>
            }
          />
        )}
        <PublishControl
          canvasId={canvas.canvas_id}
          visibility={canvas.visibility}
          publicSlug={canvas.public_slug}
        />
        <VersionHistory canvasId={canvas.canvas_id} />
      </div>

      {canvas.kind === "canvas" ? (
        <>
          {docError && <p className="error-text canvas-page-loading">{docError}</p>}
          {!doc && !docError && (
            <div className="canvas-page-loading">
              <LoadingState label="Loading canvas…" />
            </div>
          )}
          {doc && cssReady && <CanvasViewport doc={doc} />}
        </>
      ) : canvas.entry_url ? (
        <div className="canvas-artifact-full">
          {canvas.kind === "image" ? (
            <img src={canvas.entry_url} alt={canvas.title} className="artifact-preview" />
          ) : (
            <iframe
              src={canvas.entry_url}
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
