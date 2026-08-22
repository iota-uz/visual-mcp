import { groupBounds, type PositionedCanvas, type PositionedNode } from "./layout.js";
import { PHONE_FRAME, phoneFrameScale, phoneNodeHeightForWidth } from "./phone-frame.js";
import { escapeHtml, renderCanvas } from "./render.js";
import { routeEdges } from "./router.js";
import type { IframeNode, ImageNode, Rect } from "./types.js";

// A wide camera range supports both whole-system overviews and close visual
// inspection. At the limits, one canvas unit spans 0.5%–800% of a CSS pixel.
const MIN_SCALE = 0.005;
const MAX_SCALE = 8;
const FIT_GUTTER = 64;
const SINGLE_SCREEN_HEIGHT_RATIO = 0.8;
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

export interface CameraBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraFitOptions {
  gutter?: number;
  maxScale?: number;
  heightRatio?: number;
}

export type ViewportTool = "view" | "move";

export interface ViewportSize {
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

export function clampCanvasScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

/** Converts a screen-space point into the single canvas world coordinate system. */
export function screenToWorld(view: ViewState, point: { x: number; y: number }) {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  };
}

/** Converts a world point through the same camera used by rendering and input. */
export function worldToScreen(view: ViewState, point: { x: number; y: number }) {
  return {
    x: view.x + point.x * view.scale,
    y: view.y + point.y * view.scale,
  };
}

/** Returns a zoomed camera while keeping the chosen screen-space anchor stable. */
export function zoomCameraAt(
  view: ViewState,
  anchor: { x: number; y: number },
  nextScale: number,
): ViewState {
  const world = screenToWorld(view, anchor);
  const scale = clampCanvasScale(nextScale);
  return {
    x: anchor.x - world.x * scale,
    y: anchor.y - world.y * scale,
    scale,
  };
}

/** Deterministic centered fit shared by editor focus and Present. */
export function fitCameraToBounds(
  bounds: CameraBounds,
  viewport: ViewportSize,
  options: CameraFitOptions = {},
): ViewState {
  const gutter = options.gutter ?? FIT_GUTTER;
  const availableWidth = Math.max(1, viewport.width - gutter * 2);
  const availableHeight = Math.max(
    1,
    options.heightRatio
      ? Math.min(viewport.height * options.heightRatio, viewport.height - gutter * 2)
      : viewport.height - gutter * 2,
  );
  const scale = clampCanvasScale(
    Math.min(options.maxScale ?? 1, availableWidth / bounds.width, availableHeight / bounds.height),
  );
  return {
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
    scale,
  };
}

/** The authored content bounds of a Page, excluding deliberate empty world space. */
export function canvasContentBounds(canvas: PositionedCanvas): CameraBounds {
  if (canvas.nodes.length === 0) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  const left = Math.min(...canvas.nodes.map((node) => node.x));
  const top = Math.min(...canvas.nodes.map((node) => node.y));
  const right = Math.max(...canvas.nodes.map((node) => node.x + node.w));
  const bottom = Math.max(...canvas.nodes.map((node) => node.y + node.h));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Default Page fit: a lone screen occupies 80% height; galleries use 64px gutters. */
export function fitPageCamera(canvas: PositionedCanvas, viewport: ViewportSize): ViewState {
  return fitCameraToBounds(canvasContentBounds(canvas), viewport, {
    heightRatio: canvas.nodes.length === 1 ? SINGLE_SCREEN_HEIGHT_RATIO : undefined,
  });
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
  initialView?: ViewState;
  onViewChange?: (view: ViewState) => void;
  fitOnResize?: boolean;
  onSelect?: (nodeId: string | null) => void;
  resolveIframeUrl?: (node: IframeNode) => string;
  resolveImageUrl?: (node: ImageNode) => string;
  resolveIframeIdentity?: (node: IframeNode) => string;
  editable?: boolean;
  onGeometryChange?: (nodeId: string, rect: Rect) => void | Promise<void>;
  onGroupMove?: (groupId: string, dx: number, dy: number) => void | Promise<void>;
  resolveElementRef?: (nodeId: string) => string | undefined;
  onCopyElementRef?: (refId: string) => void | Promise<void>;
}

export interface ViewportUpdateOptions {
  resolveIframeUrl?: (node: IframeNode) => string;
  resolveImageUrl?: (node: ImageNode) => string;
  resolveIframeIdentity?: (node: IframeNode) => string;
}

export interface ViewportController {
  fitAll(): void;
  fitSelection(): void;
  resetView(): void;
  selectNode(id: string | null, focus?: boolean): void;
  zoomAt(clientX: number, clientY: number, factor: number): void;
  activateIframe(id: string): void;
  deactivateIframe(): void;
  setTool(tool: ViewportTool): void;
  getTool(): ViewportTool;
  getView(): ViewState;
  /** Reconciles a reactive CanvasDoc update without rebuilding the camera or stable iframes. */
  updateCanvas(canvas: PositionedCanvas, options?: ViewportUpdateOptions): void;
  dispose(): void;
}

const INSPECTOR_SHELL = `<aside class="vc-inspector" aria-live="polite">
    <button type="button" class="vc-inspector-close" aria-label="Close">×</button>
    <span class="vc-inspector-eyebrow"></span>
    <h2 class="vc-inspector-title"></h2>
    <p class="vc-inspector-copy"></p>
    <div class="vc-inspector-points"></div>
    <div class="vc-inspector-ref" hidden>
      <span class="vc-inspector-ref-label">Element ref</span>
      <div class="vc-inspector-ref-row">
        <code class="vc-inspector-ref-value"></code>
        <button type="button" class="vc-inspector-ref-copy">Copy</button>
      </div>
    </div>
  </aside>`;

const MINIMAP_SHELL = `<div class="vc-minimap">
    <div class="vc-minimap-nodes"></div>
    <i class="vc-minimap-viewport"></i>
  </div>`;

function toolbarShell(editable: boolean): string {
  return `<div class="vc-toolbar" role="toolbar" aria-label="Canvas tools">
    <div class="vc-tool-group">
      <button type="button" class="vc-tool" data-tool="view" aria-label="View tool" aria-pressed="true" title="View (V)"><span>View</span><kbd>V</kbd></button>
      <button type="button" class="vc-tool" data-tool="move" aria-label="Move tool" aria-pressed="false" title="Move selected node (M)"${editable ? "" : " disabled"}><span>Move</span><kbd>M</kbd></button>
    </div>
    <div class="vc-zoom-control" aria-label="Canvas zoom">
      <button type="button" class="vc-zoom-step" data-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>
      <details class="vc-zoom-menu">
        <summary aria-label="Zoom options"><span class="vc-zoom-value">100%</span><span aria-hidden="true">▾</span></summary>
        <div class="vc-zoom-options">
          <button type="button" data-zoom-action="fit-page"><span>Fit Page</span><kbd>⇧1</kbd></button>
          <button type="button" data-zoom-action="fit-selection"><span>Fit Selection</span><kbd>⇧2</kbd></button>
          <button type="button" data-zoom-action="100"><span>100%</span></button>
          <button type="button" data-zoom-action="200"><span>200%</span></button>
        </div>
      </details>
      <button type="button" class="vc-zoom-step" data-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
    </div>
    <span class="vc-tool-status visually-hidden" role="status" aria-live="polite">View tool</span>
  </div>`;
}

export function mountViewport(opts: ViewportOptions): ViewportController {
  const { container, canvas, onSelect } = opts;
  let liveCanvas = canvas;
  let liveResolveIframeUrl = opts.resolveIframeUrl;
  let liveResolveImageUrl = opts.resolveImageUrl;
  let liveResolveIframeIdentity = opts.resolveIframeIdentity;
  const rendered = renderCanvas(liveCanvas, {
    resolveIframeUrl: liveResolveIframeUrl,
    resolveImageUrl: liveResolveImageUrl,
    editable: opts.editable,
  });

  container.classList.add("vc-viewport");
  container.tabIndex = 0;
  container.innerHTML = `${rendered.html}${MINIMAP_SHELL}${INSPECTOR_SHELL}${toolbarShell(Boolean(opts.editable))}`;

  function must(selector: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`vc-viewport: expected "${selector}" after render`);
    return el;
  }

  const world = must(".vc-world");
  const groupsRoot = must(".vc-groups");
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
  const inspectorRef = must(".vc-inspector-ref");
  const inspectorRefValue = must(".vc-inspector-ref-value");
  const inspectorRefCopy = must(".vc-inspector-ref-copy");
  const toolbar = must(".vc-toolbar");
  const toolStatus = must(".vc-tool-status");
  const zoomValue = must(".vc-zoom-value");

  let nodeById = new Map(liveCanvas.nodes.map((n) => [n.id, n]));
  let groupById = new Map(liveCanvas.groups.map((group) => [group.id, group]));
  let activeIframeId: string | null = null;
  let selectedNodeId: string | null = null;
  let selectedGroupId: string | null = null;
  let activeTool: ViewportTool = "view";
  const view: ViewState = opts.initialView
    ? { ...opts.initialView, scale: clampCanvasScale(opts.initialView.scale) }
    : { x: 40, y: 40, scale: opts.initialScale ?? 0.6 };
  let miniScale = 1;
  let miniOffsetX = 0;
  let miniOffsetY = 0;
  let viewportRect = container.getBoundingClientRect();
  let viewFrame: number | null = null;
  let geometryFrame: number | null = null;
  let iframeSyncTimer: number | null = null;
  let fitAnimationTimer: number | null = null;
  const pendingGeometryIds = new Set<string>();
  const iframeQueue: string[] = [];
  const queuedIframeIds = new Set<string>();
  // Resident is session-sticky: once an iframe has mounted, camera movement
  // never replaces its browsing context with a placeholder. This preserves
  // route, form and JS state while the lifecycle bridge suppresses offscreen
  // work.
  const residentIframeIds = new Set<string>();
  const loadingIframeIds = new Set<string>();
  const iframeLoadTimeouts = new Map<string, number>();

  function paintView(): void {
    viewFrame = null;
    world.style.transform = `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`;
    world.style.setProperty("--vc-camera-scale", String(view.scale));
    world.style.setProperty(
      "--vc-camera-inverse",
      String(Math.min(20, Math.max(0.125, 1 / view.scale))),
    );
    container.dataset.zoom = view.scale < 0.24 ? "low" : view.scale > 1.5 ? "high" : "normal";
    zoomValue.textContent = `${Math.round(view.scale * 100)}%`;

    // The grid lives in screen space, so explicitly project a world-space
    // interval through the camera. The power-of-four LOD keeps dots legible
    // at fit-all scale without letting them appear pinned to the glass.
    const grid = cameraGridStyle(view);
    container.style.setProperty("--grid-size", `${grid.size}px`);
    container.style.setProperty("--grid-x", `${grid.x}px`);
    container.style.setProperty("--grid-y", `${grid.y}px`);
    updateMinimapViewport();
    scheduleIframeSync();
    opts.onViewChange?.({ ...view });
  }

  function applyView(): void {
    if (viewFrame === null) viewFrame = requestAnimationFrame(paintView);
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const localX = clientX - viewportRect.left;
    const localY = clientY - viewportRect.top;
    Object.assign(view, zoomCameraAt(view, { x: localX, y: localY }, view.scale * factor));
    container.classList.remove("is-camera-animating");
    applyView();
  }

  function setView(next: ViewState, animate = false): void {
    if (fitAnimationTimer !== null) {
      window.clearTimeout(fitAnimationTimer);
      fitAnimationTimer = null;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    container.classList.toggle("is-camera-animating", animate && !reduceMotion);
    if (animate && !reduceMotion) {
      fitAnimationTimer = window.setTimeout(() => {
        container.classList.remove("is-camera-animating");
        fitAnimationTimer = null;
      }, 190);
    }
    Object.assign(view, next);
    applyView();
  }

  function fitAll(): void {
    setView(fitPageCamera(liveCanvas, viewportRect), true);
  }

  function fitSelection(): void {
    const group = selectedGroupId ? groupById.get(selectedGroupId) : undefined;
    if (group) {
      setView(
        fitCameraToBounds(
          { x: group.x, y: group.y, width: group.w, height: group.h },
          viewportRect,
        ),
        true,
      );
      return;
    }
    const node = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
    if (!node) {
      fitAll();
      return;
    }
    setView(
      fitCameraToBounds({ x: node.x, y: node.y, width: node.w, height: node.h }, viewportRect),
      true,
    );
  }

  function resetView(): void {
    setView(zoomCameraAt(view, { x: viewportRect.width / 2, y: viewportRect.height / 2 }, 1), true);
  }

  function focusNode(node: PositionedNode): void {
    setView(
      fitCameraToBounds({ x: node.x, y: node.y, width: node.w, height: node.h }, viewportRect),
      true,
    );
  }

  function selectNode(id: string | null, focus = false): void {
    const node = id ? nodeById.get(id) : undefined;
    if (!node) {
      selectedNodeId = null;
      selectedGroupId = null;
      for (const el of groupsRoot.querySelectorAll<HTMLElement>(".vc-group"))
        el.classList.remove("selected");
      inspector.classList.remove("visible");
      for (const el of nodesRoot.querySelectorAll<HTMLElement>(".vc-node")) {
        el.classList.remove("selected", "dimmed");
      }
      onSelect?.(null);
      return;
    }
    selectedNodeId = id;
    selectedGroupId = null;
    for (const el of groupsRoot.querySelectorAll<HTMLElement>(".vc-group"))
      el.classList.remove("selected");
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
    const refId = opts.resolveElementRef?.(node.id);
    inspectorRef.hidden = !refId;
    inspectorRefValue.textContent = refId ?? "";
    inspector.classList.add("visible");
    if (focus) focusNode(node);
    onSelect?.(id);
  }

  function selectGroup(id: string | null): void {
    const group = id ? groupById.get(id) : undefined;
    if (!group) {
      selectNode(null);
      return;
    }
    selectedNodeId = null;
    selectedGroupId = id;
    inspector.classList.remove("visible");
    for (const el of nodesRoot.querySelectorAll<HTMLElement>(".vc-node"))
      el.classList.remove("selected", "dimmed");
    for (const el of groupsRoot.querySelectorAll<HTMLElement>(".vc-group"))
      el.classList.toggle("selected", el.dataset.groupId === id);
    onSelect?.(null);
  }

  function paintToolState(announce = false): void {
    const current = activeTool;
    container.dataset.tool = current;
    container.classList.toggle("is-tool-view", current === "view");
    container.classList.toggle("is-tool-move", current === "move");
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === current));
    }
    if (announce) {
      toolStatus.textContent = `${current[0]?.toUpperCase()}${current.slice(1)} tool`;
    }
  }

  function setTool(tool: ViewportTool): void {
    activeTool = tool === "move" && !opts.editable ? "view" : tool;
    paintToolState(true);
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
      const owner = nodesRoot.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
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
      if (iframeLoadTimeouts.get(id) === timeout) iframeLoadTimeouts.delete(id);
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
    iframeLoadTimeouts.set(id, timeout);
    placeholder.replaceWith(iframe, loading);
  }

  function syncIframeLoading(): void {
    iframeSyncTimer = null;
    const candidates = iframePrewarmCandidates(liveCanvas.nodes, view, viewportRect);
    const active = new Set(iframeActiveCandidates(liveCanvas.nodes, view, viewportRect));
    if (activeIframeId) active.add(activeIframeId);
    for (const id of residentIframeIds) {
      const owner = nodesRoot.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
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
      if (node.frame.kind === "phone") {
        el.querySelector<HTMLElement>(".vc-phone-shell")?.style.setProperty(
          "--vc-phone-scale",
          String(phoneFrameScale(node.w, node.h)),
        );
        return;
      }
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

  function updateGroupElement(groupId: string): void {
    const group = groupById.get(groupId);
    if (!group) return;
    const bounds = groupBounds(group, [...nodeById.values()]);
    Object.assign(group, bounds);
    const el = groupsRoot.querySelector<HTMLElement>(`[data-group-id="${CSS.escape(groupId)}"]`);
    if (!el) return;
    el.style.left = `${bounds.x}px`;
    el.style.top = `${bounds.y}px`;
    el.style.width = `${bounds.w}px`;
    el.style.height = `${bounds.h}px`;
  }

  function updateEdgeGeometry(): void {
    for (const routed of routeEdges(liveCanvas)) {
      const edge = world.querySelector<SVGGElement>(
        `.vc-edge[data-edge-id="${CSS.escape(routed.edge.id)}"]`,
      );
      for (const path of edge?.querySelectorAll<SVGPathElement>(".vc-edge-halo, .vc-edge-line") ??
        []) {
        path.setAttribute("d", routed.d);
      }
      const junctionPoints = [routed.junctionPoint, routed.mergePoint].filter(
        (point) => point !== undefined,
      );
      const junctions = edge?.querySelectorAll<SVGCircleElement>(".vc-edge-junction") ?? [];
      junctions.forEach((junction, index) => {
        const point = junctionPoints[index];
        if (!point) return;
        junction.setAttribute("cx", String(point.x));
        junction.setAttribute("cy", String(point.y));
      });
      const label = edge?.querySelector<SVGTextElement>(".vc-edge-label");
      if (label) {
        label.setAttribute("x", String(routed.labelPoint.x));
        label.setAttribute("y", String(routed.labelPoint.y));
      }
    }
  }

  function paintGeometry(): void {
    geometryFrame = null;
    const changedIds = new Set(pendingGeometryIds);
    for (const id of pendingGeometryIds) {
      const node = nodeById.get(id);
      if (node) updateNodeElement(node);
    }
    pendingGeometryIds.clear();
    for (const group of liveCanvas.groups) {
      if (group.nodeIds.some((id) => changedIds.has(id))) updateGroupElement(group.id);
    }
    updateEdgeGeometry();
  }

  function scheduleGeometry(id: string): void {
    pendingGeometryIds.add(id);
    if (geometryFrame === null) geometryFrame = requestAnimationFrame(paintGeometry);
  }

  function iframeRuntimeIdentity(node: PositionedNode): string | null {
    if (node.kind !== "iframe") return null;
    return JSON.stringify({
      viewport: node.viewport,
      frameKind: node.frame.kind,
      sandbox: node.sandbox,
      permissions: node.permissions,
    });
  }

  function iframeContentIdentity(
    node: PositionedNode,
    resolveIdentity: ((node: IframeNode) => string) | undefined,
  ): string | null {
    if (node.kind !== "iframe") return null;
    return (
      resolveIdentity?.(node) ??
      JSON.stringify({ entrypoint: node.source.entrypoint, route: node.source.route ?? "" })
    );
  }

  /**
   * Reconciles the declarative world around stable iframe owners. Moving an
   * iframe in the DOM can recreate its browsing context in browsers, so a
   * screen whose source/security identity did not change keeps its exact
   * existing `.vc-node` element. Lanes, stages, labels, native nodes and SVG
   * routes are cheap and are replaced from the new declarative render.
   */
  function reconcileCanvasDom(
    nextCanvas: PositionedCanvas,
    nextResolveIframeUrl: ((node: IframeNode) => string) | undefined,
    nextResolveImageUrl: ((node: ImageNode) => string) | undefined,
    nextResolveIframeIdentity: ((node: IframeNode) => string) | undefined,
  ): void {
    const scratch = document.createElement("div");
    scratch.innerHTML = renderCanvas(nextCanvas, {
      resolveIframeUrl: nextResolveIframeUrl,
      resolveImageUrl: nextResolveImageUrl,
      editable: opts.editable,
    }).html;
    const nextWorld = scratch.querySelector<HTMLElement>(".vc-world");
    const nextNodesRoot = nextWorld?.querySelector<HTMLElement>(".vc-nodes");
    if (!nextWorld || !nextNodesRoot) throw new Error("Unable to render reactive canvas update");

    for (const selector of [
      ".vc-lanes",
      ".vc-stages",
      ".vc-labels",
      ".vc-groups",
      ".vc-edges",
    ] as const) {
      const current = world.querySelector<HTMLElement>(selector);
      const next = nextWorld.querySelector<HTMLElement>(selector);
      if (current && next) {
        if (selector === ".vc-groups") current.replaceChildren(...next.childNodes);
        else current.replaceWith(next);
      }
    }

    const previousById = new Map(liveCanvas.nodes.map((node) => [node.id, node]));
    const nextById = new Map(nextCanvas.nodes.map((node) => [node.id, node]));
    const selectedId = nodesRoot.querySelector<HTMLElement>(".vc-node.selected")?.dataset.nodeId;
    const nextElements = new Map(
      [...nextNodesRoot.querySelectorAll<HTMLElement>(".vc-node")].map((element) => [
        element.dataset.nodeId ?? "",
        element,
      ]),
    );

    for (const [id, nextNode] of nextById) {
      const currentElement = nodesRoot.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(id)}"]`,
      );
      const nextElement = nextElements.get(id);
      if (!nextElement) continue;
      const previousNode = previousById.get(id);
      const canKeepIframe =
        currentElement &&
        previousNode?.kind === "iframe" &&
        nextNode.kind === "iframe" &&
        iframeRuntimeIdentity(previousNode) === iframeRuntimeIdentity(nextNode) &&
        iframeContentIdentity(previousNode, liveResolveIframeIdentity) ===
          iframeContentIdentity(nextNode, nextResolveIframeIdentity);

      if (canKeepIframe && currentElement) {
        const stateClasses = ["selected", "dimmed", "iframe-active"].filter((name) =>
          currentElement.classList.contains(name),
        );
        currentElement.className = nextElement.className;
        currentElement.classList.add(...stateClasses);
        currentElement.setAttribute("style", nextElement.getAttribute("style") ?? "");
        currentElement.dataset.lane = nextElement.dataset.lane ?? "";
        currentElement.dataset.stage = nextElement.dataset.stage ?? "";
        const currentCaption = currentElement.querySelector(".vc-caption");
        const nextCaption = nextElement.querySelector(".vc-caption");
        if (currentCaption && nextCaption) currentCaption.replaceWith(nextCaption);
        const currentStatus = currentElement.querySelector(".vc-phone-status");
        const nextStatus = nextElement.querySelector(".vc-phone-status");
        if (currentStatus && nextStatus) currentStatus.replaceWith(nextStatus);
        continue;
      }

      if (currentElement) {
        if (activeIframeId === id) deactivateIframe();
        const timeout = iframeLoadTimeouts.get(id);
        if (timeout !== undefined) window.clearTimeout(timeout);
        iframeLoadTimeouts.delete(id);
        residentIframeIds.delete(id);
        loadingIframeIds.delete(id);
        queuedIframeIds.delete(id);
        currentElement.replaceWith(nextElement);
      } else {
        nodesRoot.append(nextElement);
      }
    }

    for (const current of [...nodesRoot.querySelectorAll<HTMLElement>(".vc-node")]) {
      const id = current.dataset.nodeId;
      if (!id || nextById.has(id)) continue;
      if (activeIframeId === id) deactivateIframe();
      const timeout = iframeLoadTimeouts.get(id);
      if (timeout !== undefined) window.clearTimeout(timeout);
      iframeLoadTimeouts.delete(id);
      residentIframeIds.delete(id);
      loadingIframeIds.delete(id);
      queuedIframeIds.delete(id);
      current.remove();
    }

    const currentLegend = container.querySelector<HTMLElement>(":scope > .vc-legend");
    const nextLegend = scratch.querySelector<HTMLElement>(":scope > .vc-legend");
    if (currentLegend && nextLegend) currentLegend.replaceWith(nextLegend);
    else if (currentLegend) currentLegend.remove();
    else if (nextLegend) container.insertBefore(nextLegend, minimap);

    nodeById = nextById;
    if (selectedId && nextById.has(selectedId)) selectNode(selectedId, false);
    else if (selectedId) selectNode(null);
    if (selectedGroupId && nextCanvas.groups.some((group) => group.id === selectedGroupId)) {
      const selected = world.querySelector<HTMLElement>(
        `.vc-group[data-group-id="${CSS.escape(selectedGroupId)}"]`,
      );
      selected?.classList.add("selected");
    } else if (selectedGroupId) selectedGroupId = null;
  }

  function updateCanvas(nextCanvas: PositionedCanvas, options?: ViewportUpdateOptions): void {
    const nextResolveIframeUrl = options?.resolveIframeUrl ?? liveResolveIframeUrl;
    const nextResolveImageUrl = options?.resolveImageUrl ?? liveResolveImageUrl;
    const nextResolveIframeIdentity = options?.resolveIframeIdentity ?? liveResolveIframeIdentity;
    // Keep the node being manipulated under the pointer even if a remote
    // version lands mid-drag. The subsequent optimistic save is based on the
    // newest Convex version and becomes the next reactive update.
    if (dragState?.nodeId && dragState.mode !== "camera") {
      const local = nodeById.get(dragState.nodeId);
      const incoming = nextCanvas.nodes.find((node) => node.id === dragState?.nodeId);
      if (local && incoming) {
        Object.assign(incoming.rect, local.rect);
        Object.assign(incoming, { x: local.x, y: local.y, w: local.w, h: local.h });
      }
    }
    if (dragState?.groupId && dragState.mode === "move") {
      const group = groupById.get(dragState.groupId);
      for (const id of group?.nodeIds ?? []) {
        const local = nodeById.get(id);
        const incoming = nextCanvas.nodes.find((node) => node.id === id);
        if (local && incoming) {
          Object.assign(incoming.rect, local.rect);
          Object.assign(incoming, { x: local.x, y: local.y, w: local.w, h: local.h });
        }
      }
    }
    reconcileCanvasDom(
      nextCanvas,
      nextResolveIframeUrl,
      nextResolveImageUrl,
      nextResolveIframeIdentity,
    );
    liveResolveIframeUrl = nextResolveIframeUrl;
    liveResolveImageUrl = nextResolveImageUrl;
    liveResolveIframeIdentity = nextResolveIframeIdentity;
    liveCanvas = nextCanvas;
    nodeById = new Map(nextCanvas.nodes.map((node) => [node.id, node]));
    groupById = new Map(nextCanvas.groups.map((group) => [group.id, group]));
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

  // --- camera movement / pinch-zoom (pointer events cover mouse + touch + pen) ---
  const activePointers = new Map<number, { x: number; y: number }>();
  let dragState: {
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    nodeId: string | null;
    groupId: string | null;
    mode: "camera" | "move" | "resize";
    originRect?: Rect;
    originMemberRects?: Map<string, Rect>;
  } | null = null;
  let pinchState: {
    startDistance: number;
    startScale: number;
    worldX: number;
    worldY: number;
  } | null = null;
  let lastClick: { nodeId: string; at: number } | null = null;

  function clearDragClasses(): void {
    container.classList.remove("is-panning", "is-pinching", "is-moving-node");
  }

  function cancelDrag(): void {
    if (dragState?.groupId && dragState.originMemberRects) {
      for (const [id, rect] of dragState.originMemberRects) {
        const node = nodeById.get(id);
        if (!node) continue;
        Object.assign(node.rect, rect);
        Object.assign(node, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        scheduleGeometry(id);
      }
    }
    if (dragState?.nodeId && dragState.originRect && dragState.mode !== "camera") {
      const node = nodeById.get(dragState.nodeId);
      if (node) {
        Object.assign(node.rect, dragState.originRect);
        Object.assign(node, {
          x: dragState.originRect.x,
          y: dragState.originRect.y,
          w: dragState.originRect.w,
          h: dragState.originRect.h,
        });
        scheduleGeometry(node.id);
      }
    }
    dragState = null;
    activePointers.clear();
    pinchState = null;
    clearDragClasses();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".vc-node.iframe-active iframe")) return;
    if (target.closest("input, button, a, summary, details")) return;
    event.preventDefault();
    container.focus({ preventScroll: true });
    const nodeElement = target.closest<HTMLElement>(".vc-node");
    const groupElement = target.closest<HTMLElement>(".vc-group");
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
    const groupId = nodeId ? null : (groupElement?.dataset.groupId ?? null);
    const group = groupId ? groupById.get(groupId) : undefined;
    // `pointerdown.preventDefault()` intentionally suppresses the browser's
    // compatibility mouse events so inactive iframes cannot steal a drag.
    // Activate on the second pointer-down as well as pointer-up; this keeps
    // double-click reliable even when the native `dblclick` event is not
    // emitted after pointer capture.
    if (nodeId && lastClick?.nodeId === nodeId && Date.now() - lastClick.at < 500) {
      if (node) focusNode(node);
      activateIframe(nodeId);
    }
    const tool = activeTool;
    const selected = nodeId !== null && nodeId === selectedNodeId;
    const groupSelected = groupId !== null && groupId === selectedGroupId;
    const mode =
      tool === "move" && opts.editable && selected && node && target.closest(".vc-resize-handle")
        ? "resize"
        : tool === "move" && opts.editable && selected && node
          ? "move"
          : tool === "move" && opts.editable && groupSelected && group
            ? "move"
            : "camera";
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
      nodeId,
      groupId,
      mode,
      originRect: node?.rect ? { ...node.rect } : undefined,
      originMemberRects: group
        ? new Map(
            group.nodeIds.flatMap((id) => {
              const member = nodeById.get(id);
              return member ? [[id, { ...member.rect }] as const] : [];
            }),
          )
        : undefined,
    };
    container.classList.add(mode === "camera" ? "is-panning" : "is-moving-node");
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
      const nextScale = clampCanvasScale(
        (pinchState.startScale * distance) / pinchState.startDistance,
      );
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
    if (dragState.mode === "camera") {
      view.x = dragState.originX + dx;
      view.y = dragState.originY + dy;
      applyView();
    } else if (dragState.groupId && dragState.originMemberRects) {
      const wx = dx / view.scale;
      const wy = dy / view.scale;
      for (const [id, origin] of dragState.originMemberRects) {
        const node = nodeById.get(id);
        if (!node) continue;
        const next = { ...origin, x: origin.x + wx, y: origin.y + wy };
        Object.assign(node.rect, next);
        Object.assign(node, { x: next.x, y: next.y, w: next.w, h: next.h });
        scheduleGeometry(id);
      }
    } else {
      if (!dragState.nodeId || !dragState.originRect) return;
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
          : node.kind === "iframe" && node.frame.kind === "phone"
            ? (() => {
                const widthFromX = Math.max(80, dragState.originRect.w + wx);
                const widthFromY = Math.max(
                  80,
                  ((Math.max(80, dragState.originRect.h + wy) - PHONE_FRAME.captionHeight) *
                    PHONE_FRAME.width) /
                    PHONE_FRAME.height,
                );
                const width = Math.abs(wx) >= Math.abs(wy) ? widthFromX : widthFromY;
                return {
                  ...dragState.originRect,
                  w: width,
                  h: phoneNodeHeightForWidth(width),
                };
              })()
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
    clearDragClasses();
    if (activePointers.size < 2) pinchState = null;
    const finishedDrag = dragState;
    dragState = null;
    scheduleIframeSync(0);
    if (!finishedDrag) return;
    if (finishedDrag.moved && finishedDrag.mode !== "camera" && finishedDrag.nodeId) {
      const node = nodeById.get(finishedDrag.nodeId);
      if (node) void opts.onGeometryChange?.(node.id, { ...node.rect });
    }
    if (
      finishedDrag.moved &&
      finishedDrag.mode === "move" &&
      finishedDrag.groupId &&
      finishedDrag.originMemberRects
    ) {
      const first = finishedDrag.originMemberRects.entries().next().value as
        | [string, Rect]
        | undefined;
      const node = first ? nodeById.get(first[0]) : undefined;
      if (first && node)
        void opts.onGroupMove?.(
          finishedDrag.groupId,
          node.rect.x - first[1].x,
          node.rect.y - first[1].y,
        );
    }
    if (!finishedDrag.moved) {
      // Selection must not recenter between the two clicks of a double-click;
      // doing so moves the target before the second click and prevents iframe activation.
      if (finishedDrag.groupId) selectGroup(finishedDrag.groupId);
      else selectNode(finishedDrag.nodeId, false);
      if (finishedDrag.nodeId) {
        const now = Date.now();
        if (lastClick?.nodeId === finishedDrag.nodeId && now - lastClick.at < 500)
          activateIframe(finishedDrag.nodeId);
        lastClick = { nodeId: finishedDrag.nodeId, at: now };
      } else lastClick = null;
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    cancelDrag();
    scheduleIframeSync(0);
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
    const target = event.target as HTMLElement | null;
    if (
      target?.matches("input, textarea, select, button, a, [contenteditable='true']") ||
      target?.isContentEditable
    )
      return;
    if (event.key === "v" || event.key === "V") setTool("view");
    else if ((event.key === "m" || event.key === "M") && opts.editable) setTool("move");
    else if (event.shiftKey && (event.code === "Digit1" || event.key === "1")) {
      event.preventDefault();
      fitAll();
    } else if (event.shiftKey && (event.code === "Digit2" || event.key === "2")) {
      event.preventDefault();
      fitSelection();
    } else if (event.key === "0") fitAll();
    else if (event.key === "r" || event.key === "R") resetView();
    else if (event.key === "Escape") {
      cancelDrag();
      setTool("view");
      deactivateIframe();
      selectNode(null);
    } else if (event.key === "Enter") {
      const selected = nodesRoot.querySelector<HTMLElement>(".vc-node.selected")?.dataset.nodeId;
      if (selected) activateIframe(selected);
    }
  }

  function onWindowBlur(): void {
    cancelDrag();
  }

  function onToolbarClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
    if (button && !button.disabled) {
      const tool = button.dataset.tool;
      if (tool === "view" || tool === "move") setTool(tool);
    }
    const zoomStep = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-zoom]");
    if (zoomStep) {
      const factor = zoomStep.dataset.zoom === "in" ? 1.2 : 1 / 1.2;
      zoomAt(
        viewportRect.left + viewportRect.width / 2,
        viewportRect.top + viewportRect.height / 2,
        factor,
      );
    }
    const zoomAction = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-zoom-action]",
    );
    if (zoomAction) {
      if (zoomAction.dataset.zoomAction === "fit-page") fitAll();
      else if (zoomAction.dataset.zoomAction === "fit-selection") fitSelection();
      else {
        const scale = zoomAction.dataset.zoomAction === "200" ? 2 : 1;
        setView(
          zoomCameraAt(view, { x: viewportRect.width / 2, y: viewportRect.height / 2 }, scale),
          true,
        );
      }
      zoomAction.closest<HTMLDetailsElement>("details")?.removeAttribute("open");
    }
    container.focus({ preventScroll: true });
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

  function onInspectorRefCopy(): void {
    const refId = inspectorRefValue.textContent;
    if (refId) void opts.onCopyElementRef?.(refId);
  }

  function onNodesDoubleClick(event: MouseEvent): void {
    const id = (event.target as HTMLElement).closest<HTMLElement>(".vc-node")?.dataset.nodeId;
    const node = id ? nodeById.get(id) : undefined;
    if (node) {
      focusNode(node);
      activateIframe(node.id);
    }
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
    if (event.data?.type === "visual-canvas:escape" && owner?.dataset.nodeId === activeIframeId) {
      cancelDrag();
      setTool("view");
      deactivateIframe();
      selectNode(null);
    }
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
          if (opts.fitOnResize) setView(fitPageCamera(liveCanvas, viewportRect));
          else applyView();
        });

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("keydown", onKeyDown);
  window.addEventListener("blur", onWindowBlur);
  toolbar.addEventListener("click", onToolbarClick);
  minimap.addEventListener("pointerdown", onMinimapPointerDown);
  inspectorClose.addEventListener("click", onInspectorClose);
  inspectorRefCopy.addEventListener("click", onInspectorRefCopy);
  nodesRoot.addEventListener("dblclick", onNodesDoubleClick);
  nodesRoot.addEventListener("click", onNodesClick);
  window.addEventListener("message", onWindowMessage);
  resizeObserver?.observe(container);

  renderMinimap();
  paintToolState();
  if (opts.initialView) applyView();
  else fitAll();

  return {
    fitAll,
    fitSelection,
    resetView,
    selectNode,
    zoomAt,
    activateIframe,
    deactivateIframe,
    setTool,
    getTool: () => activeTool,
    getView: () => ({ ...view }),
    updateCanvas,
    dispose() {
      if (viewFrame !== null) cancelAnimationFrame(viewFrame);
      if (geometryFrame !== null) cancelAnimationFrame(geometryFrame);
      if (iframeSyncTimer !== null) window.clearTimeout(iframeSyncTimer);
      if (fitAnimationTimer !== null) window.clearTimeout(fitAnimationTimer);
      for (const timeout of iframeLoadTimeouts.values()) window.clearTimeout(timeout);
      resizeObserver?.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onWindowBlur);
      toolbar.removeEventListener("click", onToolbarClick);
      minimap.removeEventListener("pointerdown", onMinimapPointerDown);
      inspectorClose.removeEventListener("click", onInspectorClose);
      inspectorRefCopy.removeEventListener("click", onInspectorRefCopy);
      nodesRoot.removeEventListener("dblclick", onNodesDoubleClick);
      nodesRoot.removeEventListener("click", onNodesClick);
      window.removeEventListener("message", onWindowMessage);
    },
  };
}
