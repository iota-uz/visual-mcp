import { useQuery } from "convex/react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { CanvasViewport, useCanvasDocAndCss } from "./Canvas";

// The anonymous /s/:slug viewer (PLAN.md Part 1 section 1/8, decision #4):
// no <AuthGate>, no sign-in, reachable while logged out. Read-only — no
// PublishControl or VersionHistory, both of which require a session.
export function PublicCanvasPage() {
  const { slug } = useParams<{ slug: string }>();
  const canvas = useQuery(api.canvases.getPublic, slug ? { publicSlug: slug } : "skip");
  const { doc, docError, cssReady } = useCanvasDocAndCss(canvas);

  /*
   * html/pdf artifacts are handed to the browser as the page rather than
   * framed inside this shell. Agent-authored HTML routinely measures itself
   * at parse time; inside a cross-origin iframe those measurements come back
   * zero and the page computes a degenerate layout, so it paints nothing
   * until some later interaction forces a repaint. Verified in production:
   * the same artifact renders instantly as a top-level document, and an
   * unrelated page in the same iframe renders instantly too — the artifact
   * is the variable, and it is not ours to fix. `kind: "canvas"` is rendered
   * client-side on this origin (nothing to redirect to) and images are a
   * plain <img>, so both keep the branded shell.
   */
  const redirectTo =
    canvas && (canvas.kind === "html" || canvas.kind === "pdf")
      ? (canvas.entry_public_url ?? canvas.entry_url)
      : null;

  useEffect(() => {
    if (redirectTo) window.location.replace(redirectTo);
  }, [redirectTo]);

  if (redirectTo) {
    return (
      <div className="canvas-page-full">
        <div className="canvas-page-loading">
          <LoadingState label="Opening…" />
        </div>
      </div>
    );
  }

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
      <div className="canvas-command-bar canvas-command-bar-public">
        <div className="canvas-command-title">
          <span>{canvas.title}</span>
          {canvas.version !== undefined && <small>v{canvas.version}</small>}
        </div>
      </div>

      {canvas.kind === "canvas" ? (
        <>
          {docError && <p className="error-text canvas-page-loading">{docError}</p>}
          {(!doc || !cssReady) && !docError && (
            <div className="canvas-page-loading">
              <LoadingState label="Loading canvas…" />
            </div>
          )}
          {doc && cssReady && <CanvasViewport doc={doc} />}
        </>
      ) : canvas.entry_url ? (
        // Only `image` reaches here — html/pdf redirected above, and this
        // page has no iframe left by design.
        <div className="canvas-artifact-full">
          <img src={canvas.entry_url} alt={canvas.title} className="artifact-preview" />
        </div>
      ) : (
        <div className="canvas-page-loading">
          <EmptyState title="No render yet." />
        </div>
      )}
    </div>
  );
}
