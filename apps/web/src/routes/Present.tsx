import "@visual-canvas/canvas/theme.css";
import { type PrototypeTarget, resolveCanvasPage } from "@visual-canvas/canvas";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Expand, RotateCcw, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { IconButton } from "../components/ui/IconButton";
import { mcpBaseUrl } from "../lib/mcpUrl";
import { presentHotspotBox } from "../lib/presentGeometry";
import { CanvasViewport, useCanvasDocAndCss } from "./Canvas";

function targetKey(target: PrototypeTarget) {
  return `${target.pageId}:${target.nodeId}`;
}

export function PresentPage({ publicView = false }: { publicView?: boolean }) {
  const { canvasId, slug } = useParams<{ canvasId: string; slug: string }>();
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
  const mintCapability = useMutation(api.canvases.mintIframeCapabilityMine);
  const [signedIframeBase, setSignedIframeBase] = useState<string | null>(null);
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
    setVisited((current) =>
      current.some((target) => targetKey(target) === targetKey(active))
        ? current
        : [...current, active],
    );
    requestAnimationFrame(() => focusRef.current?.focus());
  }, [active, activeNode]);

  useEffect(() => {
    if (publicView || !canvasId || canvas?.kind !== "canvas") return;
    let cancelled = false;
    void mintCapability({ canvasId: canvasId as Id<"canvases"> }).then(({ token }) => {
      if (!cancelled)
        setSignedIframeBase(
          `${mcpBaseUrl(import.meta.env.VITE_CONVEX_URL as string | undefined)}/i/${token}`,
        );
    });
    return () => {
      cancelled = true;
    };
  }, [canvas?.kind, canvasId, mintCapability, publicView]);

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

  function go(target: PrototypeTarget) {
    if (active) setHistory((current) => [...current, active]);
    setParams({ page: target.pageId, node: target.nodeId });
  }

  function goBack() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setParams({ page: previous.pageId, node: previous.nodeId }, { replace: true });
  }

  if (canvas === undefined || !cssReady) {
    return (
      <div className="present-loading">
        <LoadingState label="Opening prototype…" />
      </div>
    );
  }
  if (!canvas || !file || docError) {
    return (
      <div className="present-loading">
        <EmptyState title={docError ?? "This prototype isn't available."} />
      </div>
    );
  }
  if (!start || !active || !activePage || !activeNode) {
    return (
      <div className="present-loading">
        <EmptyState
          title="Prototype start isn't configured."
          hint="Set a start frame in Prototype mode."
        />
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
                onClick={() => {
                  const next = new URLSearchParams();
                  next.set("page", interaction.destination.pageId);
                  next.set("node", interaction.destination.nodeId);
                  next.set("transition", interaction.transition);
                  if (active) setHistory((current) => [...current, active]);
                  setParams(next);
                }}
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
          icon={Expand}
          label="Enter fullscreen"
          onClick={() => void document.documentElement.requestFullscreen()}
        />
        <CopyButton value={window.location.href} label="Copy presentation link" />
        <Share2 size={15} aria-hidden="true" />
      </nav>
    </main>
  );
}
