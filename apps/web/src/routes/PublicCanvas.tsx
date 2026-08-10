import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { CanvasViewport, useCanvasDocAndCss } from "./Canvas";

// The anonymous /s/:slug viewer (PLAN.md Part 1 section 1/8, decision #4):
// no <AuthGate>, no sign-in, reachable while logged out. Read-only — no
// PublishControl or VersionHistory, both of which require a session.
export function PublicCanvasPage() {
  const { slug } = useParams<{ slug: string }>();
  const canvas = useQuery(api.canvases.getPublic, slug ? { publicSlug: slug } : "skip");
  const { doc, docError, cssReady } = useCanvasDocAndCss(canvas);

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
          <EmptyState title="This link is no longer available." />
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-page-full">
      <div className="canvas-floating-header">
        <PageHeader title={canvas.title} />
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
          <EmptyState title="No render yet." />
        </div>
      )}
    </div>
  );
}
