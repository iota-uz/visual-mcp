import "@visual-canvas/canvas/theme.css";
import {
  type CanvasDoc,
  CanvasDocSchema,
  layoutCanvas,
  mountViewport,
} from "@visual-canvas/canvas";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

// Mounts packages/canvas's framework-free viewport (pan/zoom/inspector/
// minimap/?node= deep-linking) directly against the fetched CanvasDoc —
// this is the client-side rendering path (PLAN.md Part 1 section 2/8),
// distinct from the worker's server-side render used for PNG/PDF export
// and for html/image/pdf-kind canvases (rendered via `entry_url` below).
function CanvasViewport({ doc }: { doc: CanvasDoc }) {
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
      <button type="button" onClick={toggle} disabled={busy}>
        {visibility === "public" ? "Make private" : "Publish"}
      </button>
      {visibility === "public" && publicSlug && (
        <>
          <span className="muted"> shared at /s/{publicSlug}</span>
          <button type="button" onClick={rotate} disabled={busy}>
            Rotate link
          </button>
        </>
      )}
    </div>
  );
}

function VersionHistory({ canvasId }: { canvasId: Id<"canvases"> }) {
  const versions = useQuery(api.canvases.listVersionsMine, { canvasId });

  if (versions === undefined) return <p className="muted">Loading version history…</p>;
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

export function CanvasPage() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const canvas = useQuery(
    api.canvases.getMine,
    canvasId ? { canvasId: canvasId as Id<"canvases"> } : "skip",
  );
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

  const workspace = useQuery(
    api.workspaces.getById,
    canvas ? { workspaceId: canvas.workspace_id } : "skip",
  );

  if (canvas === undefined) return <p>Loading…</p>;
  if (canvas === null) return <p>Canvas not found.</p>;

  return (
    <div className="canvas-page">
      <header className="canvas-page-header">
        <p>
          <Link to={workspace ? `/w/${workspace.slug}` : "/"}>← Workspace</Link>
        </p>
        <h1>{canvas.title}</h1>
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
          {!doc && !docError && <p>Loading canvas…</p>}
          {doc && <CanvasViewport doc={doc} />}
        </>
      ) : canvas.entry_url ? (
        canvas.kind === "image" ? (
          <img src={canvas.entry_url} alt={canvas.title} className="artifact-preview" />
        ) : (
          <iframe src={canvas.entry_url} title={canvas.title} className="artifact-preview-frame" />
        )
      ) : (
        <p>No render yet — ask Claude to render this canvas.</p>
      )}
    </div>
  );
}
