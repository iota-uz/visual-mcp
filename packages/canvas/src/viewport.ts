import type { PositionedCanvas, PositionedNode } from "./layout.js";
import { escapeHtml, renderCanvas } from "./render.js";

const LOD_THRESHOLD = 0.3;
const MIN_SCALE = 0.02;
const MAX_SCALE = 1.35;
const FIT_PADDING = 56;

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export interface ViewportOptions {
  container: HTMLElement;
  canvas: PositionedCanvas;
  initialScale?: number;
  onSelect?: (nodeId: string | null) => void;
}

export interface ViewportController {
  fitAll(): void;
  resetView(): void;
  selectNode(id: string | null, focus?: boolean): void;
  zoomAt(clientX: number, clientY: number, factor: number): void;
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
  const rendered = renderCanvas(canvas);

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

  const nodeById = new Map(canvas.nodes.map((n) => [n.id, n]));
  const view: ViewState = { x: 40, y: 40, scale: opts.initialScale ?? 0.6 };
  let miniScale = 1;
  let miniOffsetX = 0;
  let miniOffsetY = 0;

  function applyView(): void {
    world.style.transform = `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`;
    container.classList.toggle("is-lod", view.scale < LOD_THRESHOLD);
    updateMinimapViewport();
  }

  function clampScale(scale: number): number {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const worldX = (localX - view.x) / view.scale;
    const worldY = (localY - view.y) / view.scale;
    const nextScale = clampScale(view.scale * factor);
    view.x = localX - worldX * nextScale;
    view.y = localY - worldY * nextScale;
    view.scale = nextScale;
    applyView();
  }

  function frameBounds(bounds: { x: number; y: number; w: number; h: number }): void {
    const rect = container.getBoundingClientRect();
    const scale = clampScale(
      Math.min((rect.width - FIT_PADDING) / bounds.w, (rect.height - FIT_PADDING) / bounds.h),
    );
    view.scale = scale;
    view.x = (rect.width - bounds.w * scale) / 2 - bounds.x * scale;
    view.y = (rect.height - bounds.h * scale) / 2 - bounds.y * scale;
    applyView();
  }

  function fitAll(): void {
    frameBounds({ x: 0, y: 0, w: canvas.width, h: canvas.height });
  }

  function resetView(): void {
    view.x = 40;
    view.y = 40;
    view.scale = opts.initialScale ?? 0.6;
    applyView();
  }

  function focusNode(node: PositionedNode): void {
    const rect = container.getBoundingClientRect();
    const targetScale = Math.max(0.48, Math.min(0.78, view.scale));
    view.scale = targetScale;
    view.x = rect.width / 2 - (node.x + node.w / 2) * targetScale;
    view.y = rect.height / 2 - (node.y + node.h / 2) * targetScale;
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
      el.classList.toggle("dimmed", el.dataset.stage !== node.stage);
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

  function renderMinimap(): void {
    const rect = minimap.getBoundingClientRect();
    const innerW = Math.max(1, rect.width - 12);
    const innerH = Math.max(1, rect.height - 12);
    miniScale = Math.min(innerW / canvas.width, innerH / canvas.height);
    miniOffsetX = (rect.width - canvas.width * miniScale) / 2;
    miniOffsetY = (rect.height - canvas.height * miniScale) / 2;
    minimapNodes.innerHTML = canvas.nodes
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
    const rect = container.getBoundingClientRect();
    const worldX = -view.x / view.scale;
    const worldY = -view.y / view.scale;
    const visibleW = rect.width / view.scale;
    const visibleH = rect.height / view.scale;
    const vw = Math.max(8, visibleW * miniScale);
    const vh = Math.max(8, visibleH * miniScale);
    minimapViewport.style.left = `${miniOffsetX + worldX * miniScale}px`;
    minimapViewport.style.top = `${miniOffsetY + worldY * miniScale}px`;
    minimapViewport.style.width = `${vw}px`;
    minimapViewport.style.height = `${vh}px`;
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
  } | null = null;
  let pinchState: {
    startDistance: number;
    startScale: number;
    worldX: number;
    worldY: number;
  } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
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
      const rect = container.getBoundingClientRect();
      const localX = centerX - rect.left;
      const localY = centerY - rect.top;
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

    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
      nodeId: nodeElement?.dataset.nodeId ?? null,
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
      const rect = container.getBoundingClientRect();
      view.scale = nextScale;
      view.x = centerX - rect.left - pinchState.worldX * nextScale;
      view.y = centerY - rect.top - pinchState.worldY * nextScale;
      applyView();
      return;
    }
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) dragState.moved = true;
    if (!dragState.moved) return;
    view.x = dragState.originX + dx;
    view.y = dragState.originY + dy;
    applyView();
  }

  function onPointerUp(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    container.classList.remove("is-panning", "is-pinching");
    if (activePointers.size < 2) pinchState = null;
    const finishedDrag = dragState;
    dragState = null;
    if (!finishedDrag) return;
    if (!finishedDrag.moved) {
      selectNode(finishedDrag.nodeId, Boolean(finishedDrag.nodeId));
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
    else if (event.key === "Escape") selectNode(null);
  }

  function onMinimapPointerDown(event: PointerEvent): void {
    const rect = minimap.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - miniOffsetX) / miniScale;
    const worldY = (event.clientY - rect.top - miniOffsetY) / miniScale;
    const containerRect = container.getBoundingClientRect();
    view.x = containerRect.width / 2 - worldX * view.scale;
    view.y = containerRect.height / 2 - worldY * view.scale;
    applyView();
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("keydown", onKeyDown);
  minimap.addEventListener("pointerdown", onMinimapPointerDown);
  inspectorClose.addEventListener("click", () => selectNode(null));

  renderMinimap();
  fitAll();

  return {
    fitAll,
    resetView,
    selectNode,
    zoomAt,
    dispose() {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
      minimap.removeEventListener("pointerdown", onMinimapPointerDown);
    },
  };
}
