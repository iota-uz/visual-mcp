import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { CanvasViewport, useCanvasDocAndCss } from "./Canvas";

// The anonymous /s/:slug viewer (PLAN.md Part 1 section 1/8, decision #4):
// no <AuthGate>, no sign-in, reachable while logged out. Read-only — no
// PublishControl or VersionHistory, both of which require a session.
export function PublicCanvasPage() {
  const { slug } = useParams<{ slug: string }>();
  const canvas = useQuery(api.canvases.getPublic, slug ? { publicSlug: slug } : "skip");
  const { doc, docError, cssReady } = useCanvasDocAndCss(canvas);

  if (canvas === undefined) return <p>Loading…</p>;
  if (canvas === null) return <p>This link is no longer available.</p>;

  return (
    <div className="canvas-page">
      <header className="canvas-page-header">
        <h1>{canvas.title}</h1>
      </header>

      {canvas.kind === "canvas" ? (
        <>
          {docError && <p className="error-text">{docError}</p>}
          {!doc && !docError && <p>Loading canvas…</p>}
          {doc && cssReady && <CanvasViewport doc={doc} />}
        </>
      ) : canvas.entry_url ? (
        canvas.kind === "image" ? (
          <img src={canvas.entry_url} alt={canvas.title} className="artifact-preview" />
        ) : (
          <iframe src={canvas.entry_url} title={canvas.title} className="artifact-preview-frame" />
        )
      ) : (
        <p>No render yet.</p>
      )}
    </div>
  );
}
