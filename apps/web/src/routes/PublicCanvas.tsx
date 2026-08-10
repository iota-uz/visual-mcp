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

  if (canvas === undefined) return <LoadingState />;
  if (canvas === null) return <EmptyState title="This link is no longer available." />;

  return (
    <div className="canvas-page">
      <PageHeader title={canvas.title} />

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
        <EmptyState title="No render yet." />
      )}
    </div>
  );
}
