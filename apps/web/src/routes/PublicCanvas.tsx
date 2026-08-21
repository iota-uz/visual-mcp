import { useQuery } from "convex/react";
import { Unplug } from "lucide-react";
import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/formatDate";
import { mcpBaseUrl } from "../lib/mcpUrl";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { CanvasViewport, useCanvasDocAndCss } from "./Canvas";

// The anonymous /s/:slug viewer (PLAN.md Part 1 section 1/8, decision #4):
// no <AuthGate>, no sign-in, reachable while logged out. Read-only — no
// PublishControl or VersionHistory, both of which require a session.
export function PublicCanvasPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const canvas = useQuery(api.canvases.getPublic, slug ? { publicSlug: slug } : "skip");
  const { page, doc, docError, cssReady } = useCanvasDocAndCss(canvas, searchParams.get("page"));
  useDocumentTitle(canvas?.title);

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
    // Deliberately not "no longer available": `getPublic` returns null for a
    // link that never existed, one that was replaced, and one whose canvas
    // was made private. Saying which of those happened would be a guess.
    return (
      <div className="canvas-page-full">
        <div className="canvas-page-loading">
          <EmptyState
            icon={Unplug}
            title="This link doesn't work."
            hint="It may have been replaced or made private. Ask whoever shared it for a current one."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-page-full">
      {/* One bar, not two. This used to be a wordmark on its own white
          strip with a floating title pill under it — two layers of chrome
          for one line of text, on the only surface outsiders ever see. */}
      <div className="canvas-command-bar canvas-command-bar-public">
        <span className="public-shell-brand">Visual Canvas</span>
        <div className="canvas-command-title">
          <span>{page ? `${canvas.title} · ${page.title}` : canvas.title}</span>
          {canvas.version !== undefined && <small>v{canvas.version}</small>}
        </div>
        {/* `updated_at` and `description` have always been in the payload
            and were rendered nowhere. */}
        <span className="public-shell-meta" title={formatAbsoluteTime(canvas.updated_at)}>
          <time dateTime={new Date(canvas.updated_at).toISOString()}>
            {formatRelativeTime(canvas.updated_at)}
          </time>
        </span>
        <CopyButton value={window.location.href} label="Copy link" />
      </div>

      {canvas.kind === "canvas" ? (
        <>
          {docError && <p className="error-text canvas-page-loading">{docError}</p>}
          {(!doc || !cssReady) && !docError && (
            <div className="canvas-page-loading">
              <LoadingState label="Loading canvas…" />
            </div>
          )}
          {doc && cssReady && (
            <CanvasViewport
              key={`${canvas.canvas_id}:${page?.id ?? "default"}`}
              doc={doc}
              iframeRevisions={canvas.iframe_revisions}
              version={canvas.version}
              iframeBaseUrl={`${mcpBaseUrl(import.meta.env.VITE_CONVEX_URL as string | undefined)}/s/${slug}`}
            />
          )}
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
