import "@visual-canvas/canvas/theme.css";
import { type PrototypeTarget, resolveCanvasPage } from "@visual-canvas/canvas";
import { useQuery } from "convex/react";
import { ArrowLeft, Expand, RotateCcw, Shrink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { mcpBaseUrl } from "../lib/mcpUrl";
import { presentHotspotBox } from "../lib/presentGeometry";
import { useIframeCapability } from "../lib/useIframeCapability";
import { CanvasViewport, useCanvasDocAndCss } from "./Canvas";

/*
 * How many visited frames stay mounted. Chosen to comfortably cover a
 * back-and-forth through a flow without keeping a whole prototype resident.
 */
const VISITED_LIMIT = 8;

function targetKey(target: PrototypeTarget) {
  return `${target.pageId}:${target.nodeId}`;
}

export function PresentPage({ publicView = false }: { publicView?: boolean }) {
  const { canvasId, slug } = useParams<{ canvasId: string; slug: string }>();
  const navigate = useNavigate();
  const signedCanvas = useQuery(
    api.canvases.getMine,
    !publicView && canvasId ? { canvasId: canvasId as Id<"canvases"> } : "skip",
  );
  const publicCanvas = useQuery(
    api.canvases.getPublic,
    publicView && slug ? { publicSlug: slug } : "skip",
  );
  const canvas = publicView ? publicCanvas : signedCanvas;
  const { file, docError, cssReady } = useCanvasDocAndCss(canvas);
  const [params, setParams] = useSearchParams();
  /*
   * Presentations are the long-lived surface: a demo runs well past the
   * ten-minute life of a capability token. This used to mint once, with no
   * renewal and no catch, so every frame quietly started 404ing part-way
   * through and a mint failure was an unhandled rejection. The shared hook
   * renews ahead of expiry and retries with backoff.
   */
  const {
    capability,
    error: capabilityError,
    retry: retryCapability,
  } = useIframeCapability({
    canvasId,
    enabled: !publicView && canvas?.kind === "canvas",
    revisions: canvas?.iframe_revisions ?? null,
  });
  const signedIframeBase = capability
    ? `${mcpBaseUrl(import.meta.env.VITE_CONVEX_URL as string | undefined)}/i/${capability.token}`
    : null;
  const [history, setHistory] = useState<PrototypeTarget[]>([]);
  const [visited, setVisited] = useState<PrototypeTarget[]>([]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const focusRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!file) return;
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const bounds = stage.getBoundingClientRect();
      setStageSize({ width: bounds.width, height: bounds.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [file]);

  const urlTarget = useMemo(() => {
    const pageId = params.get("page");
    const nodeId = params.get("node");
    return pageId && nodeId ? { pageId, nodeId } : null;
  }, [params]);
  const start = file?.prototype.start ?? null;
  const active = urlTarget ?? start;
  const activePage = file && active ? resolveCanvasPage(file, active.pageId) : null;
  const activeNode = activePage?.doc.nodes.find((node) => node.id === active?.nodeId) ?? null;

  useEffect(() => {
    if (!file || urlTarget || !start) return;
    setParams({ page: start.pageId, node: start.nodeId }, { replace: true });
  }, [file, setParams, start, urlTarget]);

  useEffect(() => {
    if (!active || !activeNode) return;
    setVisited((current) => {
      const key = targetKey(active);
      // Move-to-front rather than append-if-absent, so the cap below
      // evicts by *least recently seen* instead of by first visit.
      const rest = current.filter((target) => targetKey(target) !== key);
      /*
       * Every entry stays mounted so a revisit is instant — but they also
       * keep their iframes, and their JS, alive. Unbounded, a long demo
       * ends up running every screen it ever touched at once. The cap keeps
       * the recent ones warm and lets the rest reload on demand.
       */
      return [active, ...rest].slice(0, VISITED_LIMIT);
    });
    requestAnimationFrame(() => focusRef.current?.focus());
  }, [active, activeNode]);

  /*
   * `requestFullscreen()` used to be fire-and-forget, with a button that
   * permanently read "Enter fullscreen": once you were in, the control was
   * a lie and there was no way out of it from the UI. Tracking the real
   * state also catches the user pressing Esc or F11 themselves.
   */
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2600);
  }, []);
  useEffect(() => {
    showControls();
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, [showControls]);

  const go = useCallback(
    (target: PrototypeTarget, transition?: string) => {
      if (active) setHistory((current) => [...current, active]);
      const next = new URLSearchParams({ page: target.pageId, node: target.nodeId });
      if (transition) next.set("transition", transition);
      setParams(next);
    },
    [active, setParams],
  );

  const goBack = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setParams({ page: previous.pageId, node: previous.nodeId }, { replace: true });
  }, [history, setParams]);

  /*
   * Present registered no key handlers at all: a prototype could only be
   * driven by clicking hotspots with a mouse, there was no way back except
   * the on-screen button, and Escape did nothing — not even leave
   * fullscreen, which the browser only offers because it handles Esc
   * itself.
   *
   * Forward follows the *first* interaction on the current frame, which is
   * the same thing a click on its hotspot does, so arrow-key driving and
   * clicking never disagree about where "next" is.
   */
  const forward = useMemo(() => {
    if (!file || !active) return null;
    return (
      file.prototype.interactions.find(
        (interaction) => targetKey(interaction.source) === targetKey(active),
      ) ?? null
    );
  }, [file, active]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Never steal a key from a control the user is actually operating.
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        if (!forward) return;
        event.preventDefault();
        go(forward.destination, forward.transition);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp" || event.key === "Backspace") {
        event.preventDefault();
        goBack();
      } else if (event.key === "Escape") {
        // The browser owns Esc while fullscreen, so this only runs when we
        // are windowed — where it should leave the presentation entirely.
        if (document.fullscreenElement) return;
        event.preventDefault();
        navigate(publicView ? `/s/${slug}` : `/c/${canvasId}`);
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        toggleFullscreen();
      } else if (event.key === "Home") {
        event.preventDefault();
        setHistory([]);
        if (start) go(start);
      }
      showControls();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    forward,
    go,
    goBack,
    navigate,
    publicView,
    slug,
    canvasId,
    toggleFullscreen,
    start,
    showControls,
  ]);

  if (canvas === undefined || !cssReady) {
    return (
      <div className="present-loading">
        <LoadingState label="Opening prototype…" />
      </div>
    );
  }
  if (!canvas || !file || docError) {
    /*
     * A dead end until now: Present is a full-screen route with no chrome,
     * so a canvas that has no prototype — an html or image artifact, say —
     * left the viewer on a bare sentence with nothing to click and only the
     * browser's Back button to escape with.
     */
    return (
      <div className="present-loading">
        <EmptyState
          title={docError ?? "This prototype isn't available."}
          hint={canvas ? "This canvas has no prototype to present." : undefined}
          action={publicView ? undefined : <Link to={`/c/${canvasId}`}>Back to the canvas</Link>}
        />
      </div>
    );
  }
  if (!start || !active || !activePage || !activeNode) {
    return (
      <div className="present-loading">
        <EmptyState
          title="Prototype start isn't configured."
          hint={
            publicView ? undefined : (
              <Link to={`/c/${canvasId}?mode=prototype`}>Set a start frame in Prototype mode</Link>
            )
          }
        />
      </div>
    );
  }
  /*
   * Signed presentations read their frames through /i/:token, so mounting
   * before the mint lands would point every iframe at a bare relative path
   * and 404 it. Waiting is right; waiting *forever* was the bug.
   */
  const needsCapability = !publicView && canvas.kind === "canvas";
  if (needsCapability && capabilityError) {
    return (
      <div className="present-loading">
        <EmptyState
          title="Couldn’t get permission to load these screens."
          hint={capabilityError}
          action={
            <Button variant="secondary" onClick={retryCapability}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  if (needsCapability && !signedIframeBase) {
    return (
      <div className="present-loading">
        <LoadingState label="Opening prototype…" />
      </div>
    );
  }

  const interactions = file.prototype.interactions.filter(
    (interaction) => targetKey(interaction.source) === targetKey(active),
  );
  const iframeBaseUrl = publicView
    ? `${mcpBaseUrl(import.meta.env.VITE_CONVEX_URL as string | undefined)}/s/${slug}`
    : signedIframeBase;

  return (
    <main className="present-root" onMouseMove={showControls} onFocus={showControls}>
      <h1 ref={focusRef} tabIndex={-1} className="present-screen-title">
        {activeNode.caption.title}
      </h1>
      <div
        ref={stageRef}
        className="present-stage"
        data-transition={params.get("transition") ?? "instant"}
      >
        {visited.map((target) => {
          const page = resolveCanvasPage(file, target.pageId);
          const node = page.doc.nodes.find((candidate) => candidate.id === target.nodeId);
          if (!node) return null;
          const visible = targetKey(target) === targetKey(active);
          const isolatedDoc = {
            ...page.doc,
            world: { width: node.rect.w, height: node.rect.h },
            lanes: [],
            stages: [],
            labels: [],
            groups: [],
            edges: [],
            legend: undefined,
            nodes: [
              {
                ...node,
                laneId: undefined,
                stageId: undefined,
                rect: { ...node.rect, x: 0, y: 0 },
              },
            ],
          };
          return (
            <div
              key={targetKey(target)}
              className="present-screen"
              hidden={!visible}
              aria-hidden={!visible}
            >
              <CanvasViewport
                doc={isolatedDoc}
                iframeBaseUrl={iframeBaseUrl}
                version={canvas.version}
                immersive
                syncSelectionToUrl={false}
              />
            </div>
          );
        })}
        <div className="present-hotspots">
          {interactions.map((interaction) => {
            const destinationPage = resolveCanvasPage(file, interaction.destination.pageId);
            const destinationNode = destinationPage.doc.nodes.find(
              (node) => node.id === interaction.destination.nodeId,
            );
            const box = presentHotspotBox(activeNode, interaction.hotspot, stageSize);
            return (
              <button
                key={interaction.id}
                type="button"
                aria-label={`Open ${destinationNode?.caption.title ?? interaction.destination.nodeId}`}
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                }}
                onClick={() => go(interaction.destination, interaction.transition)}
              />
            );
          })}
        </div>
      </div>
      <nav
        className={`present-controls${controlsVisible ? "" : " is-hidden"}`}
        aria-label="Presentation controls"
      >
        <Link
          to={
            publicView ? `/s/${slug}?page=${active.pageId}` : `/c/${canvasId}?page=${active.pageId}`
          }
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to design
        </Link>
        <IconButton
          icon={ArrowLeft}
          label="Back in presentation"
          disabled={history.length === 0}
          onClick={goBack}
        />
        <IconButton
          icon={RotateCcw}
          label="Restart presentation"
          onClick={() => {
            setHistory([]);
            go(start);
          }}
        />
        <IconButton
          icon={fullscreen ? Shrink : Expand}
          label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={toggleFullscreen}
        />
        {/* The bare <Share2/> that used to sit here was a decorative icon
            with no button around it: it looked like a control and did
            nothing. Copying the link is the share action. */}
        <CopyButton value={window.location.href} label="Copy presentation link" />
        <span className="present-keys" aria-hidden="true">
          <kbd>←</kbd>
          <kbd>→</kbd>
          <kbd>F</kbd>
          <kbd>Esc</kbd>
        </span>
      </nav>
    </main>
  );
}
