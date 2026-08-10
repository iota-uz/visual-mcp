import "@visual-canvas/canvas/theme.css";
import {
  type CanvasDoc,
  CanvasDocSchema,
  layoutCanvas,
  mountViewport,
} from "@visual-canvas/canvas";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";

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

  if (canvas === undefined) return <LoadingState />;
  if (canvas === null) return <EmptyState title="Canvas not found." />;

  return (
    <div className="canvas-page">
      <header className="canvas-page-header">
        <PageHeader
          title={canvas.title}
          back={{ to: workspace ? `/w/${workspace.slug}` : "/", label: "Workspace" }}
        />
        <PublishControl
          canvasId={canvas.canvas_id}
          visibility={canvas.visibility}
          publicSlug={canvas.public_slug}
        />
        <VersionHistory canvasId={canvas.canvas_id} />
      </header>

      {canvas.kind === "canvas" ? (
        <>
          {docError && <p className="error-text">{docError}</p>}
          {!doc && !docError && <LoadingState label="Loading canvas…" />}
          {doc && cssReady && <CanvasViewport doc={doc} />}
        </>
      ) : canvas.entry_url ? (
        canvas.kind === "image" ? (
          <img src={canvas.entry_url} alt={canvas.title} className="artifact-preview" />
        ) : (
          <iframe src={canvas.entry_url} title={canvas.title} className="artifact-preview-frame" />
        )
      ) : (
        <EmptyState title="No render yet." hint="Ask Claude to render this canvas." />
      )}
    </div>
  );
}
