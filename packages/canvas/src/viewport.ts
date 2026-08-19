import type { PositionedCanvas, PositionedNode } from "./layout.js";
import { escapeHtml, renderCanvas } from "./render.js";
import { routeEdges } from "./router.js";
import type { IframeNode, Rect } from "./types.js";

const MIN_SCALE = 0.02;
const MAX_SCALE = 1.35;
const FIT_PADDING = 56;
const IFRAME_PREWARM_SCALE = 0.24;
const IFRAME_OVERSCAN_VIEWPORTS = 0.7;
const IFRAME_LOAD_IDLE_MS = 90;
const IFRAME_PREWARM_BATCH = 8;
const IFRAME_MAX_CONCURRENT = 2;
const IFRAME_LOAD_TIMEOUT_MS = 12_000;

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

type IframePosition = Pick<PositionedNode, "id" | "kind" | "x" | "y" | "w" | "h">;

/**
 * Chooses a bounded nearest-first batch of iframe screens around the camera.
 * The lower scale threshold starts warming screens shortly before they become
 * useful, while the batch limit prevents a camera jump from booting every
 * nearby screen runtime at once. Already-loaded screens are not part of this
 * budget: they remain resident for the lifetime of the viewport.
 */
export function iframePrewarmCandidates(
  nodes: readonly IframePosition[],
  view: ViewState,
  viewport: ViewportSize,
  limit = IFRAME_PREWARM_BATCH,
): string[] {
  if (view.scale < IFRAME_PREWARM_SCALE || limit <= 0) return [];
  const marginX = viewport.width * IFRAME_OVERSCAN_VIEWPORTS;
  const marginY = viewport.height * IFRAME_OVERSCAN_VIEWPORTS;
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;

  return nodes
    .filter((node) => node.kind === "iframe")
    .map((node) => {
      const left = view.x + node.x * view.scale;
      const top = view.y + node.y * view.scale;
      const right = left + node.w * view.scale;
      const bottom = top + node.h * view.scale;
      const visible = right >= 0 && bottom >= 0 && left <= viewport.width && top <= viewport.height;
      const nearby =
        right >= -marginX &&
        bottom >= -marginY &&
        left <= viewport.width + marginX &&
        top <= viewport.height + marginY;
      const dx = (left + right) / 2 - centerX;
      const dy = (top + bottom) / 2 - centerY;
      return { id: node.id, nearby, score: dx * dx + dy * dy + (visible ? -1e12 : 0) };
    })
    .filter((candidate) => candidate.nearby)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((candidate) => candidate.id);
}

/**
 * Screens close enough to the camera to keep doing runtime work. A resident
 * iframe remains visually painted while suspended, so fit-all can show every
 * loaded screen without also running every screen's animations and polling.
 */
export function iframeActiveCandidates(
  nodes: readonly IframePosition[],
  view: ViewState,
  viewport: ViewportSize,
): string[] {
  if (view.scale < IFRAME_PREWARM_SCALE) return [];
  const marginX = viewport.width * IFRAME_OVERSCAN_VIEWPORTS;
  const marginY = viewport.height * IFRAME_OVERSCAN_VIEWPORTS;
  return nodes
    .filter((node) => node.kind === "iframe")
    .filter((node) => {
      const left = view.x + node.x * view.scale;
      const top = view.y + node.y * view.scale;
      const right = left + node.w * view.scale;
      const bottom = top + node.h * view.scale;
      return (
        right >= -marginX &&
        bottom >= -marginY &&
        left <= viewport.width + marginX &&
        top <= viewport.height + marginY
      );
    })
    .map((node) => node.id);
}

export interface CameraGridStyle {
  size: number;
  x: number;
  y: number;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Projects the infinite world grid through the current camera with a stable LOD. */
export function cameraGridStyle(view: ViewState): CameraGridStyle {
  let worldGrid = 24;
  while (worldGrid * view.scale < 18) worldGrid *= 4;
  while (worldGrid > 24 && worldGrid * view.scale > 72) worldGrid /= 4;
  const size = worldGrid * view.scale;
  return {
    size,
    x: positiveModulo(view.x, size),
    y: positiveModulo(view.y, size),
  };
}

export interface ViewportOptions {
  container: HTMLElement;
  canvas: PositionedCanvas;
  initialScale?: number;
  onSelect?: (nodeId: string | null) => void;
  resolveIframeUrl?: (node: IframeNode) => string;
  editable?: boolean;
  onGeometryChange?: (nodeId: string, rect: Rect) => void | Promise<void>;
}

export interface ViewportController {
  fitAll(): void;
  resetView(): void;
  selectNode(id: string | null, focus?: boolean): void;
  zoomAt(clientX: number, clientY: number, factor: number): void;
  activateIframe(id: string): void;
  deactivateIframe(): void;
  /** Reconciles persisted rects without rebuilding the world or its iframes. */
  updateCanvas(canvas: PositionedCanvas): void;
  dispose(): void;
}

const INSPECTOR_SHELL = `<aside class="vc-inspector" aria-live="polite">
    <button type="button" class="vc-inspector-close" aria-label="Close">×</button>
    <span class="vc-inspector-eyebrow"></span>
    <h2 class="vc-inspector-title"></h2>
    <p class="vc-inspector-copy"></p>
    <div class="vc-inspector-points"></div>
  </aside>`;

const MINIMAP_SHELL = `<div class="vc-minimap">
    <div class="vc-minimap-nodes"></div>
    <i class="vc-minimap-viewport"></i>
  </div>`;

export function mountViewport(opts: ViewportOptions): ViewportController {
  const { container, canvas, onSelect } = opts;
  let liveCanvas = canvas;
  const rendered = renderCanvas(liveCanvas, {
    resolveIframeUrl: opts.resolveIframeUrl,
    editable: opts.editable,
  });

  container.classList.add("vc-viewport");
  container.tabIndex = 0;
  container.innerHTML = `${rendered.html}${MINIMAP_SHELL}${INSPECTOR_SHELL}`;

  function must(selector: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`vc-viewport: expected "${selector}" after render`);
    return el;
  }

  const world = must(".vc-world");
  const nodesRoot = must(".vc-nodes");
  const minimap = must(".vc-minimap");
  const minimapNodes = must(".vc-minimap-nodes");
  const minimapViewport = must(".vc-minimap-viewport");
  const inspector = must(".vc-inspector");
  const inspectorEyebrow = must(".vc-inspector-eyebrow");
  const inspectorTitle = must(".vc-inspector-title");
  const inspectorCopy = must(".vc-inspector-copy");
  const inspectorPoints = must(".vc-inspector-points");
  const inspectorClose = must(".vc-inspector-close");

  let nodeById = new Map(liveCanvas.nodes.map((n) => [n.id, n]));
  let activeIframeId: string | null = null;
  const view: ViewState = { x: 40, y: 40, scale: opts.initialScale ?? 0.6 };
  let miniScale = 1;
  let miniOffsetX = 0;
  let miniOffsetY = 0;
  let viewportRect = container.getBoundingClientRect();
  let viewFrame: number | null = null;
  let geometryFrame: number | null = null;
  let iframeSyncTimer: number | null = null;
  const pendingGeometryIds = new Set<string>();
  const iframeQueue: string[] = [];
  const queuedIframeIds = new Set<string>();
  // Resident is session-sticky: once an iframe has mounted, camera movement
  // never replaces its browsing context with a placeholder. This preserves
  // route, form and JS state while the lifecycle bridge suppresses offscreen
  // work.
  const residentIframeIds = new Set<string>();
  const loadingIframeIds = new Set<string>();
  const iframeLoadTimeouts = new Set<number>();

  function paintView(): void {
    viewFrame = null;
    world.style.transform = `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`;

    // The grid lives in screen space, so explicitly project a world-space
    // interval through the camera. The power-of-four LOD keeps dots legible
    // at fit-all scale without letting them appear pinned to the glass.
    const grid = cameraGridStyle(view);
    container.style.setProperty("--grid-size", `${grid.size}px`);
    container.style.setProperty("--grid-x", `${grid.x}px`);
    container.style.setProperty("--grid-y", `${grid.y}px`);
    updateMinimapViewport();
    scheduleIframeSync();
  }

  function applyView(): void {
    if (viewFrame === null) viewFrame = requestAnimationFrame(paintView);
  }

  function clampScale(scale: number): number {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const localX = clientX - viewportRect.left;
    const localY = clientY - viewportRect.top;
    const worldX = (localX - view.x) / view.scale;
    const worldY = (localY - view.y) / view.scale;
    const nextScale = clampScale(view.scale * factor);
    view.x = localX - worldX * nextScale;
    view.y = localY - worldY * nextScale;
    view.scale = nextScale;
    applyView();
  }

  function frameBounds(bounds: { x: number; y: number; w: number; h: number }): void {
    const scale = clampScale(
      Math.min(
        (viewportRect.width - FIT_PADDING) / bounds.w,
        (viewportRect.height - FIT_PADDING) / bounds.h,
      ),
    );
    view.scale = scale;
    view.x = (viewportRect.width - bounds.w * scale) / 2 - bounds.x * scale;
    view.y = (viewportRect.height - bounds.h * scale) / 2 - bounds.y * scale;
    applyView();
  }

  function fitAll(): void {
    frameBounds({ x: 0, y: 0, w: liveCanvas.width, h: liveCanvas.height });
  }

  function resetView(): void {
    view.x = 40;
    view.y = 40;
    view.scale = opts.initialScale ?? 0.6;
    applyView();
  }

  function focusNode(node: PositionedNode): void {
    const targetScale = Math.max(0.48, Math.min(0.78, view.scale));
    view.scale = targetScale;
    view.x = viewportRect.width / 2 - (node.x + node.w / 2) * targetScale;
    view.y = viewportRect.height / 2 - (node.y + node.h / 2) * targetScale;
    applyView();
  }

  function selectNode(id: string | null, focus = false): void {
    const node = id ? nodeById.get(id) : undefined;
    if (!node) {
      inspector.classList.remove("visible");
      for (const el of nodesRoot.querySelectorAll<HTMLElement>(".vc-node")) {
        el.classList.remove("selected", "dimmed");
      }
      onSelect?.(null);
      return;
    }
    for (const el of nodesRoot.querySelectorAll<HTMLElement>(".vc-node")) {
      el.classList.toggle("selected", el.dataset.nodeId === id);
      el.classList.toggle("dimmed", el.dataset.stage !== node.stageId);
    }
    inspectorEyebrow.textContent = node.inspector?.eyebrow ?? "";
    inspectorTitle.textContent = node.inspector?.title ?? node.caption.title;
    inspectorCopy.textContent = node.inspector?.copy ?? "";
    inspectorPoints.innerHTML = (node.inspector?.points ?? [])
      .slice(0, 4)
      .map(
        (point, i) =>
          `<div><b>${String(i + 1).padStart(2, "0")}</b><span>${escapeHtml(point)}</span></div>`,
      )
      .join("");
    inspector.classList.add("visible");
    if (focus) focusNode(node);
    onSelect?.(id);
  }

  function deactivateIframe(): void {
    if (!activeIframeId) return;
    const el = nodesRoot.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(activeIframeId)}"]`,
    );
    el?.classList.remove("iframe-active");
    el?.querySelector<HTMLIFrameElement>("iframe")?.blur();
    activeIframeId = null;
    scheduleIframeSync(0);
    container.focus({ preventScroll: true });
  }

  function activateIframe(id: string): void {
    const node = nodeById.get(id);
    if (node?.kind !== "iframe") return;
    deactivateIframe();
    const el = nodesRoot.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
    if (el && !residentIframeIds.has(id)) ensureIframeLoaded(el);
    if (el) setIframeLifecycle(el, "active");
    el?.classList.add("iframe-active");
    activeIframeId = id;
    el?.querySelector<HTMLIFrameElement>("iframe")?.focus({ preventScroll: true });
  }

  function renderMinimap(): void {
    const rect = minimap.getBoundingClientRect();
    const innerW = Math.max(1, rect.width - 12);
    const innerH = Math.max(1, rect.height - 12);
    miniScale = Math.min(innerW / liveCanvas.width, innerH / liveCanvas.height);
    miniOffsetX = (rect.width - liveCanvas.width * miniScale) / 2;
    miniOffsetY = (rect.height - liveCanvas.height * miniScale) / 2;
    minimapNodes.innerHTML = liveCanvas.nodes
      .map((node) => {
        const w = Math.max(2, node.w * miniScale);
        const h = Math.max(2, node.h * miniScale);
        return `<i class="vc-minimap-node" style="left:${miniOffsetX + node.x * miniScale}px;top:${miniOffsetY + node.y * miniScale}px;width:${w}px;height:${h}px"></i>`;
      })
      .join("");
    updateMinimapViewport();
  }

  function updateMinimapViewport(): void {
    if (!miniScale) return;
    const worldX = -view.x / view.scale;
    const worldY = -view.y / view.scale;
    const visibleW = viewportRect.width / view.scale;
    const visibleH = viewportRect.height / view.scale;
    const vw = Math.max(8, visibleW * miniScale);
    const vh = Math.max(8, visibleH * miniScale);
    minimapViewport.style.left = `${miniOffsetX + worldX * miniScale}px`;
    minimapViewport.style.top = `${miniOffsetY + worldY * miniScale}px`;
    minimapViewport.style.width = `${vw}px`;
    minimapViewport.style.height = `${vh}px`;
  }

  function setIframeLifecycle(owner: HTMLElement, state: "active" | "suspended"): void {
    if (owner.dataset.iframeLifecycle === state) return;
    owner.dataset.iframeLifecycle = state;
    owner.querySelector<HTMLIFrameElement>("iframe")?.contentWindow?.postMessage(
      {
        type: "visual-canvas:lifecycle",
        state: state === "active" ? "resume" : "suspend",
      },
      "*",
    );
  }

  function pumpIframeQueue(): void {
    while (loadingIframeIds.size < IFRAME_MAX_CONCURRENT && iframeQueue.length) {
      const id = iframeQueue.shift();
      if (!id) break;
      queuedIframeIds.delete(id);
      if (residentIframeIds.has(id)) continue;
      const owner = nodesRoot.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(id)}"]`,
      );
      if (owner) ensureIframeLoaded(owner);
    }
  }

  function ensureIframeLoaded(owner: HTMLElement): void {
    const placeholder = owner.querySelector<HTMLElement>(".vc-iframe-placeholder[data-src]");
    const source = placeholder?.dataset.src;
    if (!placeholder || !source) return;
    const id = owner.dataset.nodeId;
    if (!id) return;
    const iframe = document.createElement("iframe");
    iframe.tabIndex = -1;
    // The scheduler already bounds and prioritizes requests, so native lazy
    // loading would only add an unpredictable second delay here.
    iframe.loading = "eager";
    iframe.src = source;
    iframe.setAttribute("sandbox", placeholder.dataset.sandbox ?? "");
    iframe.setAttribute("allow", placeholder.dataset.allow ?? "");
    iframe.referrerPolicy = "no-referrer";
    iframe.dataset.entrypoint = placeholder.dataset.entrypoint ?? "";
    const loading = document.createElement("div");
    loading.className = "vc-iframe-loading";
    loading.setAttribute("aria-hidden", "true");
    residentIframeIds.add(id);
    loadingIframeIds.add(id);
    owner.dataset.iframeLoadState = "loading";
    owner.dataset.iframeLifecycle = "active";

    let settled = false;
    const finish = (state: "loaded" | "error" | "timeout") => {
      if (settled) return;
      settled = true;
      loadingIframeIds.delete(id);
      owner.dataset.iframeLoadState = state;
      if (state !== "loaded") loading.remove();
      window.clearTimeout(timeout);
      iframeLoadTimeouts.delete(timeout);
      if (state === "loaded") scheduleIframeSync(0);
      pumpIframeQueue();
    };
    iframe.addEventListener("load", () => finish("loaded"), { once: true });
    iframe.addEventListener("error", () => finish("error"), { once: true });
    const timeout = window.setTimeout(() => {
      owner.dataset.iframeReadiness = "partial";
      owner.dataset.iframeReadinessDetail = "iframe load timed out";
      finish("timeout");
    }, IFRAME_LOAD_TIMEOUT_MS);
    iframeLoadTimeouts.add(timeout);
    placeholder.replaceWith(iframe, loading);
  }

  function syncIframeLoading(): void {
    iframeSyncTimer = null;
    const candidates = iframePrewarmCandidates(liveCanvas.nodes, view, viewportRect);
    const active = new Set(iframeActiveCandidates(liveCanvas.nodes, view, viewportRect));
    if (activeIframeId) active.add(activeIframeId);
    for (const id of residentIframeIds) {
      const owner = nodesRoot.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(id)}"]`,
      );
      if (owner) setIframeLifecycle(owner, active.has(id) ? "active" : "suspended");
    }
    const missing = candidates.filter(
      (id) => !residentIframeIds.has(id) && !loadingIframeIds.has(id),
    );

    iframeQueue.length = 0;
    queuedIframeIds.clear();
    for (const id of missing) {
      iframeQueue.push(id);
      queuedIframeIds.add(id);
    }
    pumpIframeQueue();
  }

  function scheduleIframeSync(delay = IFRAME_LOAD_IDLE_MS): void {
    if (iframeSyncTimer !== null) window.clearTimeout(iframeSyncTimer);
    iframeSyncTimer = window.setTimeout(syncIframeLoading, delay);
  }

  function updateNodeElement(node: PositionedNode): void {
    const el = nodesRoot.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
    if (!el) return;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.w}px`;
    el.style.height = `${node.h}px`;
    if (node.kind === "iframe") {
      const scale = Math.min(
        node.w / node.viewport.width,
        Math.max(1, node.h - 47) / node.viewport.height,
      );
      el.querySelector<HTMLElement>(".vc-iframe-clip")?.style.setProperty(
        "--vc-iframe-scale",
        String(scale),
      );
    }
  }

  function updateEdgeGeometry(): void {
    for (const routed of routeEdges(liveCanvas)) {
      const edge = world.querySelector<SVGGElement>(
        `.vc-edge[data-edge-id="${CSS.escape(routed.edge.id)}"]`,
      );
      edge?.querySelector<SVGPathElement>("path")?.setAttribute("d", routed.d);
      const label = edge?.querySelector<SVGTextElement>(".vc-edge-label");
      if (label) {
        label.setAttribute("x", String(routed.labelPoint.x));
        label.setAttribute("y", String(routed.labelPoint.y));
      }
    }
  }

  function paintGeometry(): void {
    geometryFrame = null;
    for (const id of pendingGeometryIds) {
      const node = nodeById.get(id);
      if (node) updateNodeElement(node);
    }
    pendingGeometryIds.clear();
    updateEdgeGeometry();
  }

  function scheduleGeometry(id: string): void {
    pendingGeometryIds.add(id);
    if (geometryFrame === null) geometryFrame = requestAnimationFrame(paintGeometry);
  }

  function updateCanvas(nextCanvas: PositionedCanvas): void {
    liveCanvas = nextCanvas;
    nodeById = new Map(nextCanvas.nodes.map((node) => [node.id, node]));
    for (const node of nextCanvas.nodes) updateNodeElement(node);
    world.style.width = `${nextCanvas.width}px`;
    world.style.height = `${nextCanvas.height}px`;
    const edges = world.querySelector<SVGSVGElement>(".vc-edges");
    edges?.setAttribute("width", String(nextCanvas.width));
    edges?.setAttribute("height", String(nextCanvas.height));
    updateEdgeGeometry();
    renderMinimap();
    scheduleIframeSync(0);
  }

  // --- pan / pinch-zoom (pointer events cover mouse + touch + pen in one path) ---
  const activePointers = new Map<number, { x: number; y: number }>();
  let dragState: {
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    nodeId: string | null;
    mode: "pan" | "move" | "resize";
    originRect?: Rect;
  } | null = null;
  let pinchState: {
    startDistance: number;
    startScale: number;
    worldX: number;
    worldY: number;
  } | null = null;
  let lastClick: { nodeId: string; at: number } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".vc-node.iframe-active iframe")) return;
    if (target.closest("input, button, a, summary, details")) return;
    event.preventDefault();
    const nodeElement = target.closest<HTMLElement>(".vc-node");
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    container.setPointerCapture(event.pointerId);

    if (activePointers.size >= 2) {
      const points = [...activePointers.values()].slice(0, 2);
      const [p0, p1] = points as [{ x: number; y: number }, { x: number; y: number }];
      const centerX = (p0.x + p1.x) / 2;
      const centerY = (p0.y + p1.y) / 2;
      const localX = centerX - viewportRect.left;
      const localY = centerY - viewportRect.top;
      pinchState = {
        startDistance: Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y)),
        startScale: view.scale,
        worldX: (localX - view.x) / view.scale,
        worldY: (localY - view.y) / view.scale,
      };
      dragState = null;
      container.classList.add("is-panning", "is-pinching");
      return;
    }

    const nodeId = nodeElement?.dataset.nodeId ?? null;
    const node = nodeId ? nodeById.get(nodeId) : undefined;
    // `pointerdown.preventDefault()` intentionally suppresses the browser's
    // compatibility mouse events so inactive iframes cannot steal a drag.
    // Activate on the second pointer-down as well as pointer-up; this keeps
    // double-click reliable even when the native `dblclick` event is not
    // emitted after pointer capture.
    if (nodeId && lastClick?.nodeId === nodeId && Date.now() - lastClick.at < 500) {
      activateIframe(nodeId);
    }
    const mode =
      opts.editable && node && target.closest(".vc-resize-handle")
        ? "resize"
        : opts.editable && node
          ? "move"
          : "pan";
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
      nodeId,
      mode,
      originRect: node?.rect ? { ...node.rect } : undefined,
    };
    container.classList.add("is-panning");
  }

  function onPointerMove(event: PointerEvent): void {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinchState && activePointers.size >= 2) {
      event.preventDefault();
      const points = [...activePointers.values()].slice(0, 2);
      const [p0, p1] = points as [{ x: number; y: number }, { x: number; y: number }];
      const centerX = (p0.x + p1.x) / 2;
      const centerY = (p0.y + p1.y) / 2;
      const distance = Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y));
      const nextScale = clampScale((pinchState.startScale * distance) / pinchState.startDistance);
      view.scale = nextScale;
      view.x = centerX - viewportRect.left - pinchState.worldX * nextScale;
      view.y = centerY - viewportRect.top - pinchState.worldY * nextScale;
      applyView();
      return;
    }
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) dragState.moved = true;
    if (!dragState.moved) return;
    if (dragState.mode === "pan" || !dragState.nodeId || !dragState.originRect) {
      view.x = dragState.originX + dx;
      view.y = dragState.originY + dy;
      applyView();
    } else {
      const node = nodeById.get(dragState.nodeId);
      if (!node) return;
      const wx = dx / view.scale;
      const wy = dy / view.scale;
      const next =
        dragState.mode === "move"
          ? {
              ...dragState.originRect,
              x: dragState.originRect.x + wx,
              y: dragState.originRect.y + wy,
            }
          : {
              ...dragState.originRect,
              w: Math.max(80, dragState.originRect.w + wx),
              h: Math.max(80, dragState.originRect.h + wy),
            };
      Object.assign(node.rect, next, {});
      Object.assign(node, { x: next.x, y: next.y, w: next.w, h: next.h });
      scheduleGeometry(node.id);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    container.classList.remove("is-panning", "is-pinching");
    if (activePointers.size < 2) pinchState = null;
    const finishedDrag = dragState;
    dragState = null;
    scheduleIframeSync(0);
    if (!finishedDrag) return;
    if (finishedDrag.moved && finishedDrag.mode !== "pan" && finishedDrag.nodeId) {
      const node = nodeById.get(finishedDrag.nodeId);
      if (node) void opts.onGeometryChange?.(node.id, { ...node.rect });
    }
    if (!finishedDrag.moved) {
      // Selection must not recenter between the two clicks of a double-click;
      // doing so moves the target before the second click and prevents iframe activation.
      selectNode(finishedDrag.nodeId, false);
      if (finishedDrag.nodeId) {
        const now = Date.now();
        if (lastClick?.nodeId === finishedDrag.nodeId && now - lastClick.at < 500)
          activateIframe(finishedDrag.nodeId);
        lastClick = { nodeId: finishedDrag.nodeId, at: now };
      } else lastClick = null;
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.01);
      zoomAt(event.clientX, event.clientY, factor);
    } else {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
      applyView();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "0") fitAll();
    else if (event.key === "r" || event.key === "R") resetView();
    else if (event.key === "Escape") {
      deactivateIframe();
      selectNode(null);
    } else if (event.key === "Enter") {
      const selected = nodesRoot.querySelector<HTMLElement>(".vc-node.selected")?.dataset.nodeId;
      if (selected) activateIframe(selected);
    }
  }

  function onMinimapPointerDown(event: PointerEvent): void {
    const rect = minimap.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - miniOffsetX) / miniScale;
    const worldY = (event.clientY - rect.top - miniOffsetY) / miniScale;
    view.x = viewportRect.width / 2 - worldX * view.scale;
    view.y = viewportRect.height / 2 - worldY * view.scale;
    applyView();
  }

  function onInspectorClose(): void {
    selectNode(null);
  }

  function onNodesDoubleClick(event: MouseEvent): void {
    const id = (event.target as HTMLElement).closest<HTMLElement>(".vc-node")?.dataset.nodeId;
    if (id) activateIframe(id);
  }

  function onNodesClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest(".vc-iframe-exit")) {
      event.stopPropagation();
      deactivateIframe();
    }
  }

  function onWindowMessage(event: MessageEvent): void {
    const iframe = [...nodesRoot.querySelectorAll<HTMLIFrameElement>("iframe")].find(
      (candidate) => candidate.contentWindow === event.source,
    );
    if (!iframe) return;
    const owner = iframe.closest<HTMLElement>(".vc-node");
    if (event.data?.type === "visual-canvas:escape" && owner?.dataset.nodeId === activeIframeId)
      deactivateIframe();
    if (
      event.data?.type === "visual-canvas:readiness" &&
      ["ready", "partial", "failed"].includes(event.data.state)
    ) {
      owner?.querySelector(".vc-iframe-loading")?.remove();
      owner?.setAttribute("data-iframe-readiness", event.data.state);
      owner?.setAttribute(
        "data-iframe-readiness-detail",
        typeof event.data.detail === "string" ? event.data.detail : "",
      );
    }
  }

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          viewportRect = container.getBoundingClientRect();
          renderMinimap();
          applyView();
        });

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("keydown", onKeyDown);
  minimap.addEventListener("pointerdown", onMinimapPointerDown);
  inspectorClose.addEventListener("click", onInspectorClose);
  nodesRoot.addEventListener("dblclick", onNodesDoubleClick);
  nodesRoot.addEventListener("click", onNodesClick);
  window.addEventListener("message", onWindowMessage);
  resizeObserver?.observe(container);

  renderMinimap();
  fitAll();

  return {
    fitAll,
    resetView,
    selectNode,
    zoomAt,
    activateIframe,
    deactivateIframe,
    updateCanvas,
    dispose() {
      if (viewFrame !== null) cancelAnimationFrame(viewFrame);
      if (geometryFrame !== null) cancelAnimationFrame(geometryFrame);
      if (iframeSyncTimer !== null) window.clearTimeout(iframeSyncTimer);
      for (const timeout of iframeLoadTimeouts) window.clearTimeout(timeout);
      resizeObserver?.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
      minimap.removeEventListener("pointerdown", onMinimapPointerDown);
      inspectorClose.removeEventListener("click", onInspectorClose);
      nodesRoot.removeEventListener("dblclick", onNodesDoubleClick);
      nodesRoot.removeEventListener("click", onNodesClick);
      window.removeEventListener("message", onWindowMessage);
    },
  };
}
