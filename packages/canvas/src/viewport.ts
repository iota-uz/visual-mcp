import { groupBounds, type PositionedCanvas, type PositionedNode } from "./layout.js";
import {
  DEVICE_CAPTION_HEIGHT,
  deviceFrameScale,
  deviceShellSize,
} from "./device-frame.js";
import { PHONE_FRAME, phoneFrameScale } from "./phone-frame.js";
import { escapeHtml, renderCanvas } from "./render.js";
import { routeEdges } from "./router.js";
import type { CanvasNode, IframeNode, ImageNode, Point, Rect } from "./types.js";

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

/*
 * How much of the content has to stay on screen. `view.x/y` used to be
 * clamped nowhere at all, so a fast trackpad flick could throw the world
 * into empty infinity with no visual feedback and no way back except a
 * fit shortcut the user had no reason to know about.
 */
const PAN_KEEP_VISIBLE = 96;

/* Slack between the CSS camera transition and the timer that clears the
   class driving it; the duration itself comes from --vc-duration-camera. */
const CAMERA_TIMER_SLACK_MS = 10;

/*
 * Alignment snapping. The threshold is in screen pixels, not world units:
 * how close two things look is what decides whether they should line up,
 * and at 25% zoom a world-unit threshold would snap things that are
 * visibly far apart.
 */
const SNAP_THRESHOLD_PX = 6;

/*
 * Momentum. Sampled over a short window so a flick reads as intent and a
 * slow reposition does not drift after the finger lifts.
 */
const FLICK_SAMPLE_MS = 90;
const FLICK_MIN_SPEED = 0.08; // px/ms — below this the pan just stops
const FLICK_MAX_SPEED = 4; // px/ms — caps a violent flick
const FLICK_DECAY = 0.94; // per 16ms frame
const FLICK_STOP_SPEED = 0.015;

/*
 * The canonical zoom ladder, shared by the toolbar buttons and the
 * keyboard. Wheel and pinch deliberately stay continuous — snapping a
 * live gesture to rungs feels broken — but a discrete press should land
 * on a round, recognisable number rather than multiplying by 1.2 forever.
 */
const ZOOM_LADDER = [
  0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8,
] as const;

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

/**
 * "comment" is only reachable when the app passes comment options: the
 * public share page and Present mount the same viewport and have no comment
 * surface to draft into.
 */
export type ViewportTool = "view" | "move" | "comment";

/**
 * One pin on the canvas. A node comment carries the node *id*, resolved
 * against the live document every paint — a marker whose node has been
 * deleted simply does not draw, and the thread stays readable in the app's
 * own panel rather than floating over empty space.
 */
export interface CommentMarker {
  id: string;
  nodeId?: string;
  point?: Point;
  status: "open" | "completed" | "resolved";
  /** Shown on the pin, so a thread with a conversation reads as one. */
  replies?: number;
}

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

/**
 * Returns the next rung of the canonical zoom ladder above or below
 * `scale`. Used by the toolbar's ± and by keyboard zoom so repeated
 * presses walk round numbers instead of compounding a factor.
 */
export function nextLadderScale(scale: number, direction: 1 | -1): number {
  // A hair of tolerance so a camera sitting on 1 from a fit does not
  // "step" to 1 again because of float drift.
  const epsilon = scale * 1e-6;
  if (direction > 0) {
    const up = ZOOM_LADDER.find((rung) => rung > scale + epsilon);
    return clampCanvasScale(up ?? MAX_SCALE);
  }
  const down = [...ZOOM_LADDER].reverse().find((rung) => rung < scale - epsilon);
  return clampCanvasScale(down ?? MIN_SCALE);
}

const RESIZE_DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number];

/** The smallest a node may be dragged to, in world units. */
const MIN_NODE_SIDE = 80;

function asResizeDirection(value: string | undefined): ResizeDirection | undefined {
  return RESIZE_DIRECTIONS.find((direction) => direction === value);
}

/**
 * Applies a pointer delta to one rect from one handle.
 *
 * Nodes used to carry a single south-east handle, so a resize could only
 * ever grow down and right and repositioning a node's top edge meant
 * resizing it and then moving it back. Dragging a west or north handle
 * moves the opposite edge instead, which is what every direct-manipulation
 * editor does and what the eight handles now promise.
 *
 * `aspect` is a device shell — the phone, or one of the built-in
 * device/browser presets. Its screen is a fixed content area, so the height
 * always derives from the width and the axis with the larger travel wins.
 */
export interface FrameAspect {
  /** Shell width at scale 1. */
  width: number;
  /** Shell height at scale 1, caption excluded. */
  height: number;
  /** The node caption band, which sits above the shell and does not scale. */
  captionHeight: number;
}

/** The shell a node must stay proportional to, or null if it resizes freely. */
export function frameAspectFor(node: CanvasNode): FrameAspect | null {
  if (node.kind !== "iframe") return null;
  if (node.frame.kind === "phone") {
    return {
      width: PHONE_FRAME.width,
      height: PHONE_FRAME.height,
      captionHeight: PHONE_FRAME.captionHeight,
    };
  }
  if (node.frame.kind === "device") {
    const shell = deviceShellSize(node.frame.preset, node.viewport.height);
    return { width: shell.width, height: shell.height, captionHeight: DEVICE_CAPTION_HEIGHT };
  }
  return null;
}

function nodeHeightForWidth(aspect: FrameAspect, width: number): number {
  return aspect.captionHeight + (width / aspect.width) * aspect.height;
}

export function resizeRect(
  origin: Rect,
  from: ResizeDirection,
  wx: number,
  wy: number,
  aspect: FrameAspect | null = null,
): Rect {
  const west = from.includes("w");
  const north = from.includes("n");
  const horizontal = west || from.includes("e");
  const vertical = north || from.includes("s");

  if (aspect) {
    const fromX = horizontal ? origin.w + (west ? -wx : wx) : Number.NaN;
    const fromY = vertical
      ? ((Math.max(MIN_NODE_SIDE, origin.h + (north ? -wy : wy)) - aspect.captionHeight) *
          aspect.width) /
        aspect.height
      : Number.NaN;
    const preferX = !vertical || (horizontal && Math.abs(wx) >= Math.abs(wy));
    const width = Math.max(MIN_NODE_SIDE, preferX ? fromX : fromY);
    const height = nodeHeightForWidth(aspect, width);
    return {
      x: west ? origin.x + origin.w - width : origin.x,
      y: north ? origin.y + origin.h - height : origin.y,
      w: width,
      h: height,
    };
  }

  const w = horizontal ? Math.max(MIN_NODE_SIDE, origin.w + (west ? -wx : wx)) : origin.w;
  const h = vertical ? Math.max(MIN_NODE_SIDE, origin.h + (north ? -wy : wy)) : origin.h;
  // Anchoring on the far edge rather than adding the raw delta is what keeps
  // the opposite side still once the minimum size has been reached.
  return {
    x: west ? origin.x + origin.w - w : origin.x,
    y: north ? origin.y + origin.h - h : origin.y,
    w,
    h,
  };
}

/** One alignment line the drag is currently holding, in world units. */
export interface AlignmentGuide {
  axis: "x" | "y";
  /** World coordinate of the line itself. */
  at: number;
  /** Extent along the other axis, so the line spans only what it relates. */
  from: number;
  to: number;
}

export interface SnapResult {
  /** World-unit correction to add to the dragged rect. */
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
}

/**
 * Snaps a dragged rect to the edges and centres of the rects around it.
 *
 * Both the left/centre/right and top/middle/bottom of the moving rect are
 * candidates against the same three lines on every neighbour, which is what
 * makes "centre this under that" and "line these two up" the same gesture.
 * Only the closest line per axis wins, and only inside `threshold` — given
 * in *world* units by the caller, who converts from screen pixels so the
 * behaviour is the same at every zoom.
 *
 * Ties are broken toward the smaller correction, then toward the earlier
 * candidate, so a rect equidistant from two neighbours does not flicker
 * between them as the pointer moves.
 */
export function snapRectToNeighbours(
  rect: Rect,
  neighbours: readonly Rect[],
  threshold: number,
): SnapResult {
  if (threshold <= 0 || neighbours.length === 0) return { dx: 0, dy: 0, guides: [] };

  function axisSnap(
    movingSpan: readonly [number, number],
    otherSpan: readonly [number, number],
    pick: (r: Rect) => readonly [number, number, number, number, number],
  ): { delta: number; guides: AlignmentGuide[] } {
    const [mLow, mHigh] = movingSpan;
    const moving = [mLow, (mLow + mHigh) / 2, mHigh];
    let best: { delta: number; at: number } | null = null;
    for (const neighbour of neighbours) {
      const [nLow, nCentre, nHigh] = pick(neighbour);
      for (const line of [nLow, nCentre, nHigh]) {
        for (const edge of moving) {
          const delta = line - edge;
          if (Math.abs(delta) > threshold) continue;
          if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9) best = { delta, at: line };
        }
      }
    }
    if (!best) return { delta: 0, guides: [] };
    // The line spans everything it is currently aligning, so a guide that
    // reaches three nodes visibly says so.
    const winner = best;
    let from = otherSpan[0];
    let to = otherSpan[1];
    for (const neighbour of neighbours) {
      const [nLow, nCentre, nHigh, oLow, oHigh] = pick(neighbour);
      if (![nLow, nCentre, nHigh].some((line) => Math.abs(line - winner.at) < 1e-6)) continue;
      from = Math.min(from, oLow);
      to = Math.max(to, oHigh);
    }
    return { delta: winner.delta, guides: [{ axis: "x", at: winner.at, from, to }] };
  }

  const x = axisSnap(
    [rect.x, rect.x + rect.w],
    [rect.y, rect.y + rect.h],
    (r) => [r.x, r.x + r.w / 2, r.x + r.w, r.y, r.y + r.h] as const,
  );
  const y = axisSnap(
    [rect.y, rect.y + rect.h],
    [rect.x, rect.x + rect.w],
    (r) => [r.y, r.y + r.h / 2, r.y + r.h, r.x, r.x + r.w] as const,
  );
  return {
    dx: x.delta,
    dy: y.delta,
    guides: [...x.guides, ...y.guides.map((guide) => ({ ...guide, axis: "y" as const }))],
  };
}

/**
 * Keeps the camera somewhere the content can still be found.
 *
 * The world stays effectively infinite — this only refuses positions where
 * less than `keepVisible` pixels of the content rect would remain inside
 * the viewport on either axis. The permitted range is always non-empty
 * (its width is `viewport + content - 2·keepVisible + …`, which grows with
 * the content), so this can never fight a legitimate pan; it only catches
 * the overshoot.
 */
export function clampCameraToBounds(
  view: ViewState,
  bounds: CameraBounds,
  viewport: ViewportSize,
  keepVisible = PAN_KEEP_VISIBLE,
): ViewState {
  const slackX = Math.min(keepVisible, viewport.width / 2, bounds.width * view.scale);
  const slackY = Math.min(keepVisible, viewport.height / 2, bounds.height * view.scale);
  const left = bounds.x * view.scale;
  const right = (bounds.x + bounds.width) * view.scale;
  const top = bounds.y * view.scale;
  const bottom = (bounds.y + bounds.height) * view.scale;
  return {
    x: Math.min(viewport.width - slackX - left, Math.max(slackX - right, view.x)),
    y: Math.min(viewport.height - slackY - top, Math.max(slackY - bottom, view.y)),
    scale: view.scale,
  };
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

/*
 * The chrome a stage or a lane draws outside its own rect, in world units.
 * A stage header is absolutely positioned at `top: -30px` and a lane label
 * sits 20px inside its left edge; neither is inside the rect the layout
 * reports, so a fit that only measured rects cropped both.
 */
const STAGE_HEADER_OVERHANG = 34;
const LANE_LABEL_INSET = 24;

/**
 * The authored content bounds of a Page, excluding deliberate empty world
 * space.
 *
 * Nodes alone were not enough. Lanes and stages are content — they are what
 * a swimlane diagram *is* — and their labels hang outside the rects, so
 * Fit Page on the app's flagship document type left the lane names clipped
 * to single letters at the left edge and the stage headers sliced off the
 * top. Lanes contribute their vertical extent and their label gutter but
 * not their width: a lane is authored to span the whole world, and letting
 * that drive the fit is exactly the empty space this is meant to exclude.
 */
export function canvasContentBounds(canvas: PositionedCanvas): CameraBounds {
  if (canvas.nodes.length === 0) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  let left = Math.min(...canvas.nodes.map((node) => node.x));
  let top = Math.min(...canvas.nodes.map((node) => node.y));
  let right = Math.max(...canvas.nodes.map((node) => node.x + node.w));
  let bottom = Math.max(...canvas.nodes.map((node) => node.y + node.h));
  for (const stage of canvas.stages) {
    left = Math.min(left, stage.rect.x);
    top = Math.min(top, stage.rect.y - STAGE_HEADER_OVERHANG);
    right = Math.max(right, stage.rect.x + stage.rect.w);
    bottom = Math.max(bottom, stage.rect.y + stage.rect.h);
  }
  for (const lane of canvas.lanes) {
    left = Math.min(left, lane.rect.x + LANE_LABEL_INSET);
    top = Math.min(top, lane.rect.y);
    bottom = Math.max(bottom, lane.rect.y + lane.rect.h);
  }
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
  /** Every change to the multi-selection, including clears. */
  onSelectionChange?: (nodeIds: string[]) => void;
  /**
   * Per-canvas iframe load progress, so the surrounding app can report
   * "N of M screens loaded" and surface failures. Fires on every load,
   * failure, retry and reactive canvas replacement.
   */
  onIframeStateChange?: (state: { total: number; loaded: number; failed: string[] }) => void;
  resolveIframeUrl?: (node: IframeNode) => string;
  resolveImageUrl?: (node: ImageNode) => string;
  resolveIframeIdentity?: (node: IframeNode) => string;
  editable?: boolean;
  /**
   * One node moved or resized. `previous` is the rect the gesture started
   * from — the app needs it to offer a session-local undo, and it is the
   * only place that value still exists once the drag has ended.
   */
  onGeometryChange?: (nodeId: string, rect: Rect, previous: Rect) => void | Promise<void>;
  onGroupMove?: (groupId: string, dx: number, dy: number) => void | Promise<void>;
  /** A multi-selection dragged or nudged as one gesture; persist it as one write. */
  onNodesMove?: (nodeIds: string[], dx: number, dy: number) => void | Promise<void>;
  /**
   * Delete/Backspace on a selection. The engine does not remove anything
   * itself: deletion needs a confirmation and a durable write, both of which
   * belong to the app, which then feeds the result back through updateCanvas.
   */
  onDeleteNodes?: (nodeIds: string[]) => void | Promise<void>;
  resolveElementRef?: (nodeId: string) => string | undefined;
  onCopyElementRef?: (refId: string) => void | Promise<void>;
  /**
   * Comment pins to draw. Passing this (with `onCommentDraft`) is what turns
   * the whole feature on: the Comment tool, its button and the markers all
   * stay out of the DOM otherwise.
   */
  comments?: readonly CommentMarker[];
  /** A pin was clicked — open that thread. */
  onCommentActivate?: (commentId: string) => void;
  /** The Comment tool was used on a node, or on empty page space. */
  onCommentDraft?: (anchor: { nodeId?: string; point: Point }) => void;
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
  /** Replaces the whole multi-selection; unknown ids are ignored. */
  setSelection(ids: readonly string[], focus?: boolean): void;
  getSelection(): string[];
  zoomAt(clientX: number, clientY: number, factor: number): void;
  activateIframe(id: string): void;
  deactivateIframe(): void;
  setTool(tool: ViewportTool): void;
  getTool(): ViewportTool;
  /** Replaces the comment pins; positions follow the live document. */
  setComments(markers: readonly CommentMarker[]): void;
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

/*
 * Half the viewport's shortcuts appeared in no UI at all: the toolbar shows
 * V, M, ⇧1 and ⇧2, while 0, R, Escape, Enter and the zoom keys were
 * discoverable only by reading the source. `?` opens this.
 */
const SHORTCUT_HELP_SHELL = `<div class="vc-shortcut-help" hidden role="dialog" aria-modal="false" aria-label="Keyboard shortcuts">
    <div class="vc-shortcut-help-head">
      <strong>Keyboard</strong>
      <button type="button" class="vc-shortcut-help-close" aria-label="Close keyboard shortcuts">×</button>
    </div>
    <dl>
      <div><dt>View tool</dt><dd><kbd>V</kbd></dd></div>
      <div><dt>Move tool</dt><dd><kbd>M</kbd></dd></div>
      <div class="vc-shortcut-comment" hidden><dt>Comment tool</dt><dd><kbd>C</kbd></dd></div>
      <div><dt>Fit page</dt><dd><kbd>⇧1</kbd> <kbd>0</kbd></dd></div>
      <div><dt>Fit selection</dt><dd><kbd>⇧2</kbd></dd></div>
      <div><dt>Zoom to 100%</dt><dd><kbd>⇧0</kbd> <kbd>R</kbd></dd></div>
      <div><dt>Zoom in / out</dt><dd><kbd>+</kbd> <kbd>−</kbd></dd></div>
      <div><dt>Zoom to pointer</dt><dd><kbd>⌘</kbd> <span aria-hidden="true">+</span> scroll</dd></div>
      <div><dt>Nudge selection</dt><dd><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> <span aria-hidden="true">·</span> <kbd>⇧</kbd> ×10</dd></div>
      <div><dt>Select several</dt><dd>drag on empty canvas <span aria-hidden="true">·</span> <kbd>⇧</kbd> click</dd></div>
      <div><dt>Delete selection</dt><dd><kbd>Delete</kbd></dd></div>
      <div><dt>Undo / redo</dt><dd><kbd>⌘Z</kbd> <kbd>⌘⇧Z</kbd></dd></div>
      <div><dt>Open screen</dt><dd><kbd>Enter</kbd> or double-click</dd></div>
      <div><dt>Deselect / exit</dt><dd><kbd>Esc</kbd></dd></div>
      <div><dt>This panel</dt><dd><kbd>?</kbd></dd></div>
    </dl>
  </div>`;

/*
 * A Page with no nodes used to render as a bare dot grid: indistinguishable
 * from a canvas whose camera had wandered off into empty space, which is
 * exactly the confusion the pan clamp was added to prevent.
 */
/*
 * Alignment guides live outside `.vc-world`, in screen space. Inside it
 * they would be wiped by every re-render — the world element is replaced
 * wholesale — and would need the camera-inverse dance to stay hairline.
 */
const GUIDES_SHELL = `<div class="vc-guides" aria-hidden="true"></div>`;
/*
 * Pins live in screen space beside the guides, and for the same reason: the
 * world element is replaced on every re-render, and a pin has to stay the
 * same size at every zoom rather than shrink with the document.
 */
const COMMENTS_SHELL = `<div class="vc-comments" hidden></div>`;
/** Screen-space offset between pins that resolve to the same anchor. */
const COMMENT_PIN_STACK = 16;
const MARQUEE_SHELL = `<div class="vc-marquee" hidden aria-hidden="true"></div>`;
/*
 * A multi-selection has nothing to put in the inspector — there is no single
 * node to describe — but it still needs to say how much is selected and
 * offer the one destructive action, since Delete is a key a touch device
 * does not have.
 */
const MULTISELECT_SHELL = `<div class="vc-multiselect" hidden role="status">
    <span class="vc-multiselect-count"></span>
    <button type="button" class="vc-multiselect-delete">Delete</button>
  </div>`;

const EMPTY_SHELL = `<div class="vc-empty" hidden>
    <p class="vc-empty-title">This page is empty.</p>
    <p class="vc-empty-hint">Ask your agent to add screens or nodes to it.</p>
  </div>`;

const MINIMAP_SHELL = `<div class="vc-minimap">
    <div class="vc-minimap-nodes"></div>
    <i class="vc-minimap-viewport"></i>
  </div>`;

function toolbarShell(editable: boolean, comments: boolean): string {
  return `<div class="vc-toolbar" role="toolbar" aria-label="Canvas tools">
    <div class="vc-tool-group">
      <button type="button" class="vc-tool" data-tool="view" aria-label="View tool" aria-pressed="true" title="View (V)"><span>View</span><kbd>V</kbd></button>
      <button type="button" class="vc-tool" data-tool="move" aria-label="Move tool" aria-pressed="false" title="Move selected node (M)"${editable ? "" : " disabled"}><span>Move</span><kbd>M</kbd></button>
      ${comments ? `<button type="button" class="vc-tool" data-tool="comment" aria-label="Comment tool" aria-pressed="false" title="Comment (C)"><span>Comment</span><kbd>C</kbd></button>` : ""}
    </div>
    <div class="vc-zoom-control" aria-label="Canvas zoom">
      <button type="button" class="vc-zoom-step" data-zoom="out" aria-label="Zoom out" title="Zoom out (−)">−</button>
      <input class="vc-zoom-value" type="text" inputmode="numeric" aria-label="Zoom level, in percent" value="100%" size="5" />
      <details class="vc-zoom-menu">
        <summary aria-label="Zoom options"><span aria-hidden="true">▾</span></summary>
        <div class="vc-zoom-options">
          <button type="button" data-zoom-action="fit-page"><span>Fit Page</span><kbd>⇧1</kbd></button>
          <button type="button" data-zoom-action="fit-selection"><span>Fit Selection</span><kbd>⇧2</kbd></button>
          <button type="button" data-zoom-action="100"><span>100%</span><kbd>⇧0</kbd></button>
          <button type="button" data-zoom-action="200"><span>200%</span></button>
        </div>
      </details>
      <button type="button" class="vc-zoom-step" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
    </div>
    <button type="button" class="vc-tool vc-help-toggle" data-help="toggle" aria-label="Keyboard shortcuts" aria-expanded="false" title="Keyboard shortcuts (?)"><span aria-hidden="true">?</span></button>
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
  const commentsEnabled = typeof opts.onCommentDraft === "function";
  container.innerHTML = `${rendered.html}${GUIDES_SHELL}${COMMENTS_SHELL}${MARQUEE_SHELL}${MULTISELECT_SHELL}${MINIMAP_SHELL}${INSPECTOR_SHELL}${toolbarShell(Boolean(opts.editable), commentsEnabled)}${SHORTCUT_HELP_SHELL}${EMPTY_SHELL}`;

  function must(selector: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`vc-viewport: expected "${selector}" after render`);
    return el;
  }

  const world = must(".vc-world");
  const guidesLayer = must(".vc-guides");
  const commentsLayer = must(".vc-comments");
  const marqueeLayer = must(".vc-marquee");
  const multiselectPanel = must(".vc-multiselect");
  const multiselectCount = must(".vc-multiselect-count");
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
  const zoomValue = must(".vc-zoom-value") as HTMLInputElement;
  const shortcutHelp = must(".vc-shortcut-help");
  const helpToggle = must(".vc-help-toggle");
  const shortcutHelpClose = must(".vc-shortcut-help-close");
  const emptyState = must(".vc-empty");

  let nodeById = new Map(liveCanvas.nodes.map((n) => [n.id, n]));
  let groupById = new Map(liveCanvas.groups.map((group) => [group.id, group]));
  let activeIframeId: string | null = null;
  /*
   * `selection` is the whole set a human has picked; `selectedNodeId` is the
   * one node the inspector, resize handles and Enter act on — the last one
   * clicked. Keeping both means every single-selection behaviour is
   * unchanged while a marquee can still address five nodes at once.
   */
  const selection = new Set<string>();
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
  let flickFrame: number | null = null;
  let flickSample: { x: number; y: number; at: number } | null = null;
  let flickVelocity: { x: number; y: number } | null = null;
  /*
   * Content bounds drive the pan clamp and are recomputed on every camera
   * move, so they are cached and invalidated rather than folded over every
   * node each frame — at the 1000-node schema cap that is the difference
   * between a free clamp and a measurable one.
   */
  let contentBoundsCache: CameraBounds | null = null;
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

  let commentMarkers: readonly CommentMarker[] = opts.comments ?? [];
  const commentElements = new Map<string, HTMLElement>();

  /**
   * One element per marker, rebuilt only when the set changes; positions are
   * a per-frame style write in `positionComments`. A marker whose node is
   * gone resolves to nothing and is simply not drawn.
   */
  function rebuildComments(): void {
    if (!commentsEnabled) return;
    commentElements.clear();
    commentsLayer.replaceChildren(
      ...commentMarkers.map((marker) => {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "vc-comment-marker";
        pin.dataset.commentId = marker.id;
        pin.dataset.status = marker.status;
        const replies = marker.replies ?? 0;
        pin.textContent = replies > 0 ? String(replies + 1) : "";
        pin.setAttribute(
          "aria-label",
          `${marker.status} comment${replies > 0 ? `, ${replies} replies` : ""}`,
        );
        commentElements.set(marker.id, pin);
        return pin;
      }),
    );
    commentsLayer.toggleAttribute("hidden", commentMarkers.length === 0);
    positionComments();
  }

  function positionComments(): void {
    if (!commentsEnabled || commentMarkers.length === 0) return;
    // Two comments on the same node share an anchor, and one pin sitting
    // exactly on another reads as a single thread. They fan out instead.
    const stacked = new Map<string, number>();
    for (const marker of commentMarkers) {
      const pin = commentElements.get(marker.id);
      if (!pin) continue;
      const node = marker.nodeId ? nodeById.get(marker.nodeId) : undefined;
      const anchor = node
        ? { x: node.x + node.w, y: node.y }
        : marker.nodeId
          ? null
          : (marker.point ?? null);
      if (!anchor) {
        pin.hidden = true;
        continue;
      }
      const key = `${Math.round(anchor.x)}:${Math.round(anchor.y)}`;
      const index = stacked.get(key) ?? 0;
      stacked.set(key, index + 1);
      pin.hidden = false;
      pin.style.transform = `translate(${anchor.x * view.scale + view.x + index * COMMENT_PIN_STACK}px, ${anchor.y * view.scale + view.y}px)`;
    }
  }

  function paintView(): void {
    viewFrame = null;
    world.style.transform = `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`;
    world.style.setProperty("--vc-camera-scale", String(view.scale));
    world.style.setProperty(
      "--vc-camera-inverse",
      String(Math.min(20, Math.max(0.125, 1 / view.scale))),
    );
    container.dataset.zoom = view.scale < 0.24 ? "low" : view.scale > 1.5 ? "high" : "normal";
    // Never fight the user mid-edit: the field is an input now, and
    // rewriting it under a cursor would make typing a percentage
    // impossible.
    if (document.activeElement !== zoomValue) {
      zoomValue.value = `${Math.round(view.scale * 100)}%`;
    }

    // The grid lives in screen space, so explicitly project a world-space
    // interval through the camera. The power-of-four LOD keeps dots legible
    // at fit-all scale without letting them appear pinned to the glass.
    const grid = cameraGridStyle(view);
    container.style.setProperty("--grid-size", `${grid.size}px`);
    container.style.setProperty("--grid-x", `${grid.x}px`);
    container.style.setProperty("--grid-y", `${grid.y}px`);
    updateMinimapViewport();
    positionComments();
    scheduleIframeSync();
    opts.onViewChange?.({ ...view });
  }

  function applyView(): void {
    if (viewFrame === null) viewFrame = requestAnimationFrame(paintView);
  }

  function contentBounds(): CameraBounds {
    if (!contentBoundsCache) contentBoundsCache = canvasContentBounds(liveCanvas);
    return contentBoundsCache;
  }

  /**
   * Applies the pan clamp in place. Every free camera move — drag, wheel,
   * pinch, minimap, momentum — goes through this; fits and resets compute
   * a centred camera and are already in range.
   */
  function clampPan(): void {
    Object.assign(view, clampCameraToBounds(view, contentBounds(), viewportRect));
  }

  function stopFlick(): void {
    if (flickFrame !== null) cancelAnimationFrame(flickFrame);
    flickFrame = null;
  }

  /**
   * Momentum after a pan flick. Deliberately not a physics engine: a fixed
   * per-frame decay, normalised to 16 ms so it behaves the same on a 120 Hz
   * display, and it dies the moment the clamp refuses to move any further
   * so a flick into the void does not keep burning frames.
   */
  function startFlick(vx: number, vy: number): void {
    stopFlick();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const speed = Math.hypot(vx, vy);
    if (speed < FLICK_MIN_SPEED) return;
    const capped = Math.min(1, FLICK_MAX_SPEED / speed);
    let dx = vx * capped;
    let dy = vy * capped;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      const decay = FLICK_DECAY ** (elapsed / 16);
      const beforeX = view.x;
      const beforeY = view.y;
      view.x += dx * elapsed;
      view.y += dy * elapsed;
      clampPan();
      applyView();
      const moved = Math.abs(view.x - beforeX) + Math.abs(view.y - beforeY);
      dx *= decay;
      dy *= decay;
      if (moved < 0.1 || Math.hypot(dx, dy) < FLICK_STOP_SPEED) {
        flickFrame = null;
        scheduleIframeSync(0);
        return;
      }
      flickFrame = requestAnimationFrame(step);
    };
    flickFrame = requestAnimationFrame(step);
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    zoomTo(view.scale * factor, clientX - viewportRect.left, clientY - viewportRect.top);
  }

  /** Anchored absolute zoom. `zoomAt` is the relative-factor wrapper. */
  function zoomTo(nextScale: number, localX: number, localY: number, animate = false): void {
    const target = zoomCameraAt(view, { x: localX, y: localY }, nextScale);
    if (animate) {
      setView(clampCameraToBounds(target, contentBounds(), viewportRect), true);
      return;
    }
    Object.assign(view, target);
    clampPan();
    container.classList.remove("is-camera-animating");
    applyView();
  }

  /*
   * How long to hold `is-camera-animating` before dropping it. The class
   * turns on a CSS transition, so the timer has to outlive that transition
   * or the camera snaps mid-flight — which is why this used to be a second
   * hardcoded 190ms sitting next to theme.css's 180ms, maintained by hand.
   * Read the token instead; the slack is the only number left here.
   */
  function cameraAnimationMs(): number {
    const raw = window.getComputedStyle(container).getPropertyValue("--vc-duration-camera").trim();
    const value = Number.parseFloat(raw);
    const ms = Number.isFinite(value) ? (raw.endsWith("ms") ? value : value * 1000) : 180;
    return ms + CAMERA_TIMER_SLACK_MS;
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
      }, cameraAnimationMs());
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

  /**
   * One discrete zoom press: walks the canonical ladder and anchors at the
   * viewport centre, which is the only anchor a keyboard press has. The
   * button used to multiply by 1.2 forever, so a few presses left you at
   * 86% or 149% — numbers no one asked for.
   */
  /**
   * Arrow-key nudge for the Move tool. 1px, or 10 with Shift — the
   * convention every design tool uses, and the only way to place a node
   * precisely without fighting the pointer at low zoom.
   *
   * Returns false when there is nothing to nudge, so the caller can let the
   * key fall through to whatever else arrows might mean.
   */
  function nudgeSelection(dx: number, dy: number): boolean {
    if (activeTool !== "move" || !opts.editable) return false;

    const group = selectedGroupId ? groupById.get(selectedGroupId) : undefined;
    if (group) {
      const origin = new Map<string, Rect>();
      for (const id of group.nodeIds) {
        const node = nodeById.get(id);
        if (!node) continue;
        origin.set(id, { ...node.rect });
        const next = { ...node.rect, x: node.rect.x + dx, y: node.rect.y + dy };
        Object.assign(node.rect, next);
        Object.assign(node, { x: next.x, y: next.y, w: next.w, h: next.h });
        scheduleGeometry(id);
      }
      if (origin.size === 0) return false;
      void opts.onGroupMove?.(group.id, dx, dy);
      return true;
    }

    if (selection.size === 0) return false;
    const moved: string[] = [];
    for (const id of selection) {
      const node = nodeById.get(id);
      if (!node) continue;
      const next = { ...node.rect, x: node.rect.x + dx, y: node.rect.y + dy };
      Object.assign(node.rect, next);
      Object.assign(node, { x: next.x, y: next.y, w: next.w, h: next.h });
      scheduleGeometry(id);
      moved.push(id);
    }
    if (moved.length === 0) return false;
    // One write for the whole set, the same as a drag: nudging four nodes
    // must not race four saves against each other.
    if (moved.length > 1) void opts.onNodesMove?.(moved, dx, dy);
    else {
      const node = nodeById.get(moved[0] as string);
      if (node)
        void opts.onGeometryChange?.(node.id, { ...node.rect }, {
          ...node.rect,
          x: node.rect.x - dx,
          y: node.rect.y - dy,
        });
    }
    return true;
  }

  /** Delete/Backspace and the multi-selection panel's button both land here. */
  function requestDelete(): void {
    if (!opts.editable || selection.size === 0) return;
    void opts.onDeleteNodes?.([...selection]);
  }

  function stepZoom(direction: 1 | -1): void {
    stopFlick();
    zoomTo(
      nextLadderScale(view.scale, direction),
      viewportRect.width / 2,
      viewportRect.height / 2,
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

  /**
   * Paints whatever `selection` currently holds.
   *
   * Dimming is a "focus this stage" affordance and only makes sense for a
   * single node: with several picked, there is no one stage to focus, and
   * fading everything else would hide exactly the context the user is
   * arranging against.
   */
  function paintSelection(): void {
    const primary = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
    const focusStage = selection.size === 1 ? (primary?.stageId ?? "") : "";
    for (const el of nodesRoot.querySelectorAll<HTMLElement>(".vc-node")) {
      const id = el.dataset.nodeId ?? "";
      const isSelected = selection.has(id);
      el.classList.toggle("selected", isSelected);
      el.classList.toggle("primary", isSelected && id === selectedNodeId);
      el.classList.toggle(
        "dimmed",
        !isSelected && focusStage !== "" && (el.dataset.stage ?? "") !== focusStage,
      );
    }
    const multiple = selection.size > 1;
    multiselectPanel.hidden = !multiple;
    multiselectCount.textContent = multiple ? `${selection.size} nodes selected` : "";
    if (multiple || !primary) inspector.classList.remove("visible");
    if (!multiple && primary) {
      inspectorEyebrow.textContent = primary.inspector?.eyebrow ?? "";
      inspectorTitle.textContent = primary.inspector?.title ?? primary.caption.title;
      inspectorCopy.textContent = primary.inspector?.copy ?? "";
      inspectorPoints.innerHTML = (primary.inspector?.points ?? [])
        .slice(0, 4)
        .map(
          (point, i) =>
            `<div><b>${String(i + 1).padStart(2, "0")}</b><span>${escapeHtml(point)}</span></div>`,
        )
        .join("");
      const refId = opts.resolveElementRef?.(primary.id);
      inspectorRef.hidden = !refId;
      inspectorRefValue.textContent = refId ?? "";
      inspector.classList.add("visible");
    }
    opts.onSelectionChange?.([...selection]);
  }

  /** Replaces the whole selection. `primary` defaults to the last id given. */
  function setSelection(ids: readonly string[], focus = false): void {
    selection.clear();
    for (const id of ids) if (nodeById.has(id)) selection.add(id);
    const primaryId = [...selection].at(-1) ?? null;
    selectedNodeId = primaryId;
    if (selection.size > 0) {
      selectedGroupId = null;
      for (const el of groupsRoot.querySelectorAll<HTMLElement>(".vc-group"))
        el.classList.remove("selected");
    }
    paintSelection();
    const node = primaryId ? nodeById.get(primaryId) : undefined;
    if (focus && node) focusNode(node);
    onSelect?.(selection.size === 1 ? primaryId : null);
  }

  /** Shift-click: add a node to the set, or take it back out. */
  function toggleSelection(id: string): void {
    if (!nodeById.has(id)) return;
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection([...next]);
  }

  function selectNode(id: string | null, focus = false): void {
    if (!id || !nodeById.has(id)) {
      selection.clear();
      selectedNodeId = null;
      selectedGroupId = null;
      for (const el of groupsRoot.querySelectorAll<HTMLElement>(".vc-group"))
        el.classList.remove("selected");
      paintSelection();
      onSelect?.(null);
      return;
    }
    setSelection([id], focus);
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
    container.classList.toggle("is-tool-comment", current === "comment");
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === current));
    }
    if (announce) {
      toolStatus.textContent = `${current[0]?.toUpperCase()}${current.slice(1)} tool`;
    }
  }

  function setTool(tool: ViewportTool): void {
    const unavailable =
      (tool === "move" && !opts.editable) || (tool === "comment" && !commentsEnabled);
    activeTool = unavailable ? "view" : tool;
    paintToolState(true);
  }

  function setComments(markers: readonly CommentMarker[]): void {
    commentMarkers = markers;
    rebuildComments();
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

  function paintEmptyState(): void {
    emptyState.toggleAttribute("hidden", liveCanvas.nodes.length > 0);
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

  /*
   * Image nodes render as a plain <img> so the same markup works under the
   * public artifact CSP, which forbids inline handlers. In the SPA we can
   * attach real listeners, so the skeleton and the failure panel only ever
   * appear where something is actually driving them.
   */
  function trackImageStates(): void {
    for (const img of nodesRoot.querySelectorAll<HTMLImageElement>(".vc-image-viewport img")) {
      if (img.dataset.vcTracked) continue;
      img.dataset.vcTracked = "1";
      const owner = img.parentElement;
      if (!owner) continue;
      const settle = (state: "loaded" | "error") => {
        owner.dataset.imageState = state;
      };
      // A cached image can already be complete before this runs, in which
      // case no event is ever coming.
      if (img.complete) {
        settle(img.naturalWidth > 0 ? "loaded" : "error");
        continue;
      }
      owner.dataset.imageState = "loading";
      img.addEventListener("load", () => settle("loaded"), { once: true });
      img.addEventListener("error", () => settle("error"), { once: true });
    }
  }

  function iframeFailureNotice(state: "error" | "timeout"): HTMLElement {
    const notice = document.createElement("div");
    notice.className = "vc-iframe-failure";
    notice.dataset.failure = state;
    const message =
      state === "timeout"
        ? "This screen took too long to load."
        : "This screen couldn't be loaded.";
    notice.innerHTML = `<p class="vc-iframe-failure-text">${escapeHtml(message)}</p><button type="button" class="vc-iframe-retry">Retry</button>`;
    return notice;
  }

  /** Re-mounts one failed screen from scratch, back through the queue. */
  function retryIframe(owner: HTMLElement): void {
    const id = owner.dataset.nodeId;
    if (!id) return;
    const node = nodeById.get(id);
    if (node?.kind !== "iframe") return;
    owner.querySelector(".vc-iframe-failure")?.remove();
    owner.querySelector("iframe")?.remove();
    residentIframeIds.delete(id);
    loadingIframeIds.delete(id);
    delete owner.dataset.iframeLoadState;
    delete owner.dataset.iframeReadiness;
    delete owner.dataset.iframeReadinessDetail;
    // Rebuild the placeholder the loader consumes, so the retry takes the
    // exact same path a first load does — including the skeleton.
    const viewportEl = owner.querySelector<HTMLElement>(".vc-iframe-viewport");
    if (!viewportEl) return;
    const placeholder = document.createElement("div");
    placeholder.className = "vc-iframe-placeholder";
    placeholder.dataset.src =
      liveResolveIframeUrl?.(node) ?? `${node.source.entrypoint}${node.source.route ?? ""}`;
    placeholder.dataset.sandbox = node.sandbox.join(" ");
    placeholder.dataset.allow = node.permissions
      .map((permission) => `${permission} 'none'`)
      .join("; ");
    placeholder.dataset.entrypoint = node.source.entrypoint;
    placeholder.innerHTML = "<span>Loading screen</span>";
    viewportEl.appendChild(placeholder);
    reportIframeState();
    ensureIframeLoaded(owner);
  }

  /*
   * Per-screen load state used to terminate at a DOM data-attribute read
   * only by CSS, so the page around the canvas could not say "4 of 12
   * screens loaded, 2 failed" — or even know that anything had failed.
   */
  function reportIframeState(): void {
    if (!opts.onIframeStateChange) return;
    const iframeNodes = liveCanvas.nodes.filter((node) => node.kind === "iframe");
    let loaded = 0;
    const failed: string[] = [];
    for (const node of iframeNodes) {
      const owner = nodesRoot.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
      const state = owner?.dataset.iframeLoadState;
      if (state === "loaded") loaded += 1;
      else if (state === "error" || state === "timeout") failed.push(node.id);
    }
    opts.onIframeStateChange({ total: iframeNodes.length, loaded, failed });
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
      if (state !== "loaded") {
        /*
         * A failed screen used to be a blank white rectangle under a
         * caption: the shimmer was removed, a data-attribute was written,
         * and nothing in the CSS or the UI ever read it. Now it says what
         * happened and offers the only useful action.
         */
        loading.replaceWith(iframeFailureNotice(state));
      }
      window.clearTimeout(timeout);
      if (iframeLoadTimeouts.get(id) === timeout) iframeLoadTimeouts.delete(id);
      if (state === "loaded") scheduleIframeSync(0);
      reportIframeState();
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
      if (node.frame.kind === "device") {
        el.querySelector<HTMLElement>(".vc-device-shell")?.style.setProperty(
          "--vc-device-scale",
          String(deviceFrameScale(node.frame.preset, node.w, node.h, node.viewport.height)),
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
    // Moving or resizing a node changes what the pan clamp is clamping to.
    contentBoundsCache = null;
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
    const selectedId = selectedNodeId;
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
    /*
     * A reactive update can delete what was selected — most obviously the
     * user's own deletion coming back from the server. Keep whatever
     * survived and drop the rest, rather than clearing the whole set.
     */
    const survivors = [...selection].filter((id) => nextById.has(id));
    if (survivors.length > 0) {
      // setSelection treats the last id as primary, so put the old primary
      // back there when it is still around.
      const ordered =
        selectedId && survivors.includes(selectedId)
          ? [...survivors.filter((id) => id !== selectedId), selectedId]
          : survivors;
      setSelection(ordered);
    }
    else if (selection.size > 0 || selectedId) selectNode(null);
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
    contentBoundsCache = null;
    nodeById = new Map(nextCanvas.nodes.map((node) => [node.id, node]));
    groupById = new Map(nextCanvas.groups.map((group) => [group.id, group]));
    for (const node of nextCanvas.nodes) updateNodeElement(node);
    positionComments();
    world.style.width = `${nextCanvas.width}px`;
    world.style.height = `${nextCanvas.height}px`;
    const edges = world.querySelector<SVGSVGElement>(".vc-edges");
    edges?.setAttribute("width", String(nextCanvas.width));
    edges?.setAttribute("height", String(nextCanvas.height));
    updateEdgeGeometry();
    renderMinimap();
    paintEmptyState();
    trackImageStates();
    reportIframeState();
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
    mode: "camera" | "move" | "resize" | "marquee";
    /** Shift was held on pointer-down: the gesture adds to the selection. */
    additive?: boolean;
    /** Which handle a resize is being driven from; absent for other modes. */
    resizeFrom?: ResizeDirection;
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

  /*
   * Everything a dragged node could line up with. Off-screen nodes are
   * excluded: a guide the user cannot see is a correction they cannot
   * explain, and on a large canvas comparing against all thousand nodes
   * every pointer move is work with nothing to show for it.
   */
  function neighbourRects(movingId: string): Rect[] {
    const left = -view.x / view.scale;
    const top = -view.y / view.scale;
    const right = left + viewportRect.width / view.scale;
    const bottom = top + viewportRect.height / view.scale;
    const rects: Rect[] = [];
    for (const node of liveCanvas.nodes) {
      if (node.id === movingId) continue;
      const rect = node.rect;
      if (rect.x > right || rect.x + rect.w < left) continue;
      if (rect.y > bottom || rect.y + rect.h < top) continue;
      rects.push(rect);
    }
    return rects;
  }

  function paintGuides(guides: readonly AlignmentGuide[]): void {
    if (guides.length === 0) {
      if (guidesLayer.childElementCount > 0) guidesLayer.replaceChildren();
      return;
    }
    guidesLayer.replaceChildren(
      ...guides.map((guide) => {
        const line = document.createElement("i");
        line.className = `vc-guide vc-guide-${guide.axis}`;
        const at = guide.axis === "x" ? guide.at * view.scale + view.x : guide.at * view.scale + view.y;
        const from = guide.axis === "x" ? guide.from * view.scale + view.y : guide.from * view.scale + view.x;
        const span = (guide.to - guide.from) * view.scale;
        if (guide.axis === "x") {
          line.style.left = `${at}px`;
          line.style.top = `${from}px`;
          line.style.height = `${span}px`;
        } else {
          line.style.top = `${at}px`;
          line.style.left = `${from}px`;
          line.style.width = `${span}px`;
        }
        return line;
      }),
    );
  }

  /** The rubber band, in viewport-local screen space like the guides. */
  function paintMarquee(box: { x: number; y: number; w: number; h: number } | null): void {
    if (!box) {
      marqueeLayer.hidden = true;
      return;
    }
    marqueeLayer.hidden = false;
    marqueeLayer.style.left = `${box.x}px`;
    marqueeLayer.style.top = `${box.y}px`;
    marqueeLayer.style.width = `${box.w}px`;
    marqueeLayer.style.height = `${box.h}px`;
  }

  /** Screen rect of the in-flight marquee, or null when there is none. */
  function marqueeBox(event: { clientX: number; clientY: number }): {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null {
    if (dragState?.mode !== "marquee") return null;
    const x0 = dragState.startX - viewportRect.left;
    const y0 = dragState.startY - viewportRect.top;
    const x1 = event.clientX - viewportRect.left;
    const y1 = event.clientY - viewportRect.top;
    return {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0),
    };
  }

  function clearDragClasses(): void {
    container.classList.remove("is-panning", "is-pinching", "is-moving-node", "is-marquee");
  }

  function cancelDrag(): void {
    flickSample = null;
    flickVelocity = null;
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
    paintMarquee(null);
    clearDragClasses();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".vc-node.iframe-active iframe")) return;
    if (target.closest("input, button, a, summary, details")) return;
    event.preventDefault();
    /*
     * The Comment tool is a placement gesture, not a drag: one press drops
     * a pin on whatever is under it — a node if there is one, otherwise the
     * world point — and hands the anchor to the app to compose into. It
     * runs before pointer capture so no camera or marquee state is started.
     */
    if (activeTool === "comment" && commentsEnabled) {
      const overNode = target.closest<HTMLElement>(".vc-node")?.dataset.nodeId;
      opts.onCommentDraft?.({
        nodeId: overNode,
        point: {
          x: (event.clientX - viewportRect.left - view.x) / view.scale,
          y: (event.clientY - viewportRect.top - view.y) / view.scale,
        },
      });
      return;
    }
    // Touching the canvas always stops a coasting camera dead — the same
    // way it does in every scroll surface on every platform.
    stopFlick();
    flickSample = { x: event.clientX, y: event.clientY, at: performance.now() };
    flickVelocity = null;
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
    const editing = tool === "move" && Boolean(opts.editable);
    const selected = nodeId !== null && selection.has(nodeId);
    const groupSelected = groupId !== null && groupId === selectedGroupId;
    const handle = target.closest<HTMLElement>(".vc-resize-handle");
    const resizeFrom = asResizeDirection(handle?.dataset.resize);
    /*
     * In the Move tool an empty-canvas drag is a marquee, not a pan — the
     * View tool, the wheel and the minimap all still pan, and a selection
     * rectangle is the one gesture that had no other way to be expressed.
     * Resizing needs exactly one node: with several picked, dragging a
     * handle is still a move of the whole set.
     */
    const mode =
      editing && selected && node && resizeFrom && selection.size === 1
        ? "resize"
        : editing && selected && node
          ? "move"
          : editing && groupSelected && group
            ? "move"
            : editing && !nodeId && !groupId
              ? "marquee"
              : "camera";
    // A multi-selection drags as one body; a single node keeps its own
    // snapping path, which needs no member map.
    const movingSet =
      mode === "move" && node && selection.size > 1 && selected ? [...selection] : null;
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
      nodeId,
      groupId,
      mode,
      additive: event.shiftKey,
      resizeFrom: mode === "resize" ? resizeFrom : undefined,
      originRect: node?.rect ? { ...node.rect } : undefined,
      originMemberRects: group
        ? new Map(
            group.nodeIds.flatMap((id) => {
              const member = nodeById.get(id);
              return member ? [[id, { ...member.rect }] as const] : [];
            }),
          )
        : movingSet
          ? new Map(
              movingSet.flatMap((id) => {
                const member = nodeById.get(id);
                return member ? [[id, { ...member.rect }] as const] : [];
              }),
            )
          : undefined,
    };
    if (mode === "marquee") paintMarquee({ x: 0, y: 0, w: 0, h: 0 });
    container.classList.add(
      mode === "camera" ? "is-panning" : mode === "marquee" ? "is-marquee" : "is-moving-node",
    );
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
      clampPan();
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
      clampPan();
      // Sampled over a short trailing window rather than frame-to-frame:
      // a single 16ms delta is mostly noise, and a pause before release
      // should read as "stop here", which a short window gives for free.
      const now = performance.now();
      const previous = flickSample;
      flickSample = { x: event.clientX, y: event.clientY, at: now };
      if (previous && now - previous.at > 0 && now - previous.at <= FLICK_SAMPLE_MS) {
        flickVelocity = {
          x: (event.clientX - previous.x) / (now - previous.at),
          y: (event.clientY - previous.y) / (now - previous.at),
        };
      } else if (previous && now - previous.at > FLICK_SAMPLE_MS) {
        flickVelocity = null;
      }
      applyView();
    } else if (dragState.mode === "marquee") {
      paintMarquee(marqueeBox(event));
    } else if (dragState.originMemberRects) {
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
      const dragged =
        dragState.mode === "move"
          ? {
              ...dragState.originRect,
              x: dragState.originRect.x + wx,
              y: dragState.originRect.y + wy,
            }
          : resizeRect(
              dragState.originRect,
              dragState.resizeFrom ?? "se",
              wx,
              wy,
              frameAspectFor(node),
            );
      /*
       * Snapping applies to a move, not a resize: a resize already has one
       * edge pinned and the other following the pointer exactly, and pulling
       * that edge onto a neighbour's line would silently change the size the
       * pointer is asking for.
       */
      const snap =
        dragState.mode === "move"
          ? snapRectToNeighbours(dragged, neighbourRects(node.id), SNAP_THRESHOLD_PX / view.scale)
          : { dx: 0, dy: 0, guides: [] };
      const next = { ...dragged, x: dragged.x + snap.dx, y: dragged.y + snap.dy };
      paintGuides(snap.guides);
      Object.assign(node.rect, next, {});
      Object.assign(node, { x: next.x, y: next.y, w: next.w, h: next.h });
      scheduleGeometry(node.id);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    clearDragClasses();
    paintGuides([]);
    if (activePointers.size < 2) pinchState = null;
    const finishedDrag = dragState;
    const marqueeRect = marqueeBox(event);
    const releaseVelocity = flickVelocity;
    const releasedAt = flickSample?.at;
    paintMarquee(null);
    dragState = null;
    flickSample = null;
    flickVelocity = null;
    scheduleIframeSync(0);
    if (!finishedDrag) return;
    /*
     * Only a camera drag coasts, and only one still in motion at release:
     * a drag that ended with the pointer parked for longer than the sample
     * window is a deliberate placement, not a throw.
     */
    if (
      finishedDrag.moved &&
      finishedDrag.mode === "camera" &&
      releaseVelocity &&
      releasedAt !== undefined &&
      performance.now() - releasedAt <= FLICK_SAMPLE_MS
    ) {
      startFlick(releaseVelocity.x, releaseVelocity.y);
    }
    /*
     * A marquee takes only nodes that fit *entirely* inside the band. Partial
     * containment reads as "I grazed it" far more often than "I meant it",
     * and a half-selected node that then moves with the set is a surprise the
     * user has to undo.
     */
    if (finishedDrag.mode === "marquee") {
      if (!finishedDrag.moved) {
        if (!finishedDrag.additive) selectNode(null);
        return;
      }
      const area = marqueeRect ?? { x: 0, y: 0, w: 0, h: 0 };
      const world = {
        x: (area.x - view.x) / view.scale,
        y: (area.y - view.y) / view.scale,
        w: area.w / view.scale,
        h: area.h / view.scale,
      };
      const inside = liveCanvas.nodes
        .filter(
          (node) =>
            node.rect.x >= world.x &&
            node.rect.y >= world.y &&
            node.rect.x + node.rect.w <= world.x + world.w &&
            node.rect.y + node.rect.h <= world.y + world.h,
        )
        .map((node) => node.id);
      setSelection(finishedDrag.additive ? [...selection, ...inside] : inside);
      return;
    }
    if (
      finishedDrag.moved &&
      finishedDrag.mode !== "camera" &&
      finishedDrag.nodeId &&
      !finishedDrag.groupId &&
      (finishedDrag.originMemberRects?.size ?? 0) <= 1
    ) {
      const node = nodeById.get(finishedDrag.nodeId);
      if (node && finishedDrag.originRect)
        void opts.onGeometryChange?.(node.id, { ...node.rect }, { ...finishedDrag.originRect });
    }
    // A dragged multi-selection persists as one batch write, so the set can
    // never be half-saved.
    if (
      finishedDrag.moved &&
      finishedDrag.mode === "move" &&
      !finishedDrag.groupId &&
      finishedDrag.originMemberRects &&
      finishedDrag.originMemberRects.size > 1
    ) {
      const first = finishedDrag.originMemberRects.entries().next().value as
        | [string, Rect]
        | undefined;
      const anchor = first ? nodeById.get(first[0]) : undefined;
      if (first && anchor) {
        void opts.onNodesMove?.(
          [...finishedDrag.originMemberRects.keys()],
          anchor.rect.x - first[1].x,
          anchor.rect.y - first[1].y,
        );
      }
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
      else if (finishedDrag.nodeId && finishedDrag.additive)
        toggleSelection(finishedDrag.nodeId);
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
    paintGuides([]);
    scheduleIframeSync(0);
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    stopFlick();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.01);
      zoomAt(event.clientX, event.clientY, factor);
    } else {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
      clampPan();
      applyView();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    // Text entry owns the keyboard outright. (The zoom field also stops
    // propagation itself, so "150" cannot fire Fit Page underneath.)
    if (
      target?.isContentEditable ||
      target?.matches("input, textarea, select, [contenteditable='true']")
    )
      return;
    /*
     * Buttons and links used to be in that list too, which quietly killed
     * every shortcut the moment the toolbar was clicked: the toolbar and
     * the inspector are inside this container, so pressing the help toggle
     * moved focus onto a button and Escape then did nothing at all.
     *
     * Only the keys a focused control genuinely needs are surrendered —
     * Enter and Space activate it, and arrows step the zoom menu — while
     * Escape, the tool letters and the zoom keys keep working from
     * anywhere on the canvas.
     */
    if (target?.matches("button, a, summary")) {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") return;
      if (event.key.startsWith("Arrow") && target.closest(".vc-zoom-menu")) return;
    }
    if (event.key === "v" || event.key === "V") setTool("view");
    else if ((event.key === "m" || event.key === "M") && opts.editable) setTool("move");
    else if ((event.key === "c" || event.key === "C") && commentsEnabled) setTool("comment");
    else if (event.shiftKey && (event.code === "Digit1" || event.key === "1")) {
      event.preventDefault();
      fitAll();
    } else if (event.shiftKey && (event.code === "Digit2" || event.key === "2")) {
      event.preventDefault();
      fitSelection();
    } else if (event.shiftKey && (event.code === "Digit0" || event.key === ")")) {
      // Shift+0 is Figma's "back to 100%". `R` keeps doing the same thing
      // for anyone who already learned it here.
      event.preventDefault();
      resetView();
    } else if (event.key === "+" || event.key === "=") {
      // Cmd/Ctrl is accepted but not required: the canvas owns its keyboard
      // and the browser's own page zoom is not what anyone means here.
      event.preventDefault();
      stepZoom(1);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      stepZoom(-1);
    } else if (event.key === "?") {
      event.preventDefault();
      toggleShortcutHelp();
    } else if (
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight"
    ) {
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
      if (nudgeSelection(dx, dy)) event.preventDefault();
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      opts.editable &&
      selection.size > 0
    ) {
      // Backspace would otherwise navigate back in some browsers.
      event.preventDefault();
      requestDelete();
    } else if (event.key === "0") fitAll();
    else if (event.key === "r" || event.key === "R") resetView();
    else if (event.key === "Escape") {
      if (shortcutHelpOpen()) {
        toggleShortcutHelp(false);
        return;
      }
      cancelDrag();
      stopFlick();
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

  function onMultiselectClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest(".vc-multiselect-delete")) requestDelete();
  }

  function onToolbarClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest("[data-help='toggle']")) {
      toggleShortcutHelp();
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
    if (button && !button.disabled) {
      const tool = button.dataset.tool;
      if (tool === "view" || tool === "move" || tool === "comment") setTool(tool);
    }
    const zoomStep = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-zoom]");
    if (zoomStep) {
      stepZoom(zoomStep.dataset.zoom === "in" ? 1 : -1);
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

  function centreOnMinimapPoint(clientX: number, clientY: number): void {
    const rect = minimap.getBoundingClientRect();
    const worldX = (clientX - rect.left - miniOffsetX) / miniScale;
    const worldY = (clientY - rect.top - miniOffsetY) / miniScale;
    view.x = viewportRect.width / 2 - worldX * view.scale;
    view.y = viewportRect.height / 2 - worldY * view.scale;
    clampPan();
    applyView();
  }

  /*
   * Press *and drag*. The minimap used to be click-to-centre only — it had
   * no pointermove at all — so the viewport rectangle drawn on it looked
   * like a handle and behaved like a picture.
   */
  function onMinimapPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    stopFlick();
    minimap.setPointerCapture(event.pointerId);
    minimap.classList.add("is-scrubbing");
    centreOnMinimapPoint(event.clientX, event.clientY);
  }

  function onMinimapPointerMove(event: PointerEvent): void {
    if (!minimap.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    centreOnMinimapPoint(event.clientX, event.clientY);
  }

  function onMinimapPointerUp(event: PointerEvent): void {
    if (minimap.hasPointerCapture(event.pointerId)) minimap.releasePointerCapture(event.pointerId);
    minimap.classList.remove("is-scrubbing");
    scheduleIframeSync(0);
  }

  function shortcutHelpOpen(): boolean {
    return !shortcutHelp.hasAttribute("hidden");
  }

  function toggleShortcutHelp(next = !shortcutHelpOpen()): void {
    shortcutHelp.toggleAttribute("hidden", !next);
    helpToggle.setAttribute("aria-expanded", String(next));
    if (!next) container.focus({ preventScroll: true });
  }

  /** Commits a typed zoom percentage, anchored at the viewport centre. */
  function commitTypedZoom(): void {
    const parsed = Number.parseFloat(zoomValue.value.replace("%", "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      zoomValue.value = `${Math.round(view.scale * 100)}%`;
      return;
    }
    stopFlick();
    zoomTo(clampCanvasScale(parsed / 100), viewportRect.width / 2, viewportRect.height / 2, true);
    zoomValue.value = `${Math.round(clampCanvasScale(parsed / 100) * 100)}%`;
  }

  function onZoomValueKeyDown(event: KeyboardEvent): void {
    // The field lives inside the canvas, whose keydown handler owns every
    // bare letter. Stopping propagation is what lets someone type "150"
    // without `0` firing Fit Page underneath.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitTypedZoom();
      container.focus({ preventScroll: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      zoomValue.value = `${Math.round(view.scale * 100)}%`;
      container.focus({ preventScroll: true });
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      stepZoom(event.key === "ArrowUp" ? 1 : -1);
      zoomValue.value = `${Math.round(view.scale * 100)}%`;
    }
  }

  function onZoomValueFocus(): void {
    zoomValue.select();
  }

  function onShortcutHelpClose(): void {
    toggleShortcutHelp(false);
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
      return;
    }
    const retry = (event.target as HTMLElement).closest(".vc-iframe-retry");
    if (retry) {
      event.stopPropagation();
      const owner = retry.closest<HTMLElement>(".vc-node");
      if (owner) retryIframe(owner);
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
  multiselectPanel.addEventListener("click", onMultiselectClick);
  minimap.addEventListener("pointerdown", onMinimapPointerDown);
  minimap.addEventListener("pointermove", onMinimapPointerMove);
  minimap.addEventListener("pointerup", onMinimapPointerUp);
  minimap.addEventListener("pointercancel", onMinimapPointerUp);
  zoomValue.addEventListener("keydown", onZoomValueKeyDown);
  zoomValue.addEventListener("focus", onZoomValueFocus);
  zoomValue.addEventListener("blur", commitTypedZoom);
  shortcutHelpClose.addEventListener("click", onShortcutHelpClose);
  inspectorClose.addEventListener("click", onInspectorClose);
  inspectorRefCopy.addEventListener("click", onInspectorRefCopy);
  nodesRoot.addEventListener("dblclick", onNodesDoubleClick);
  nodesRoot.addEventListener("click", onNodesClick);
  window.addEventListener("message", onWindowMessage);
  resizeObserver?.observe(container);

  renderMinimap();
  paintEmptyState();
  trackImageStates();
  reportIframeState();
  paintToolState();
  if (opts.initialView) applyView();
  else fitAll();

  function onCommentLayerClick(event: MouseEvent): void {
    const pin = (event.target as HTMLElement).closest<HTMLElement>("[data-comment-id]");
    const id = pin?.dataset.commentId;
    if (id) opts.onCommentActivate?.(id);
  }
  if (commentsEnabled) {
    commentsLayer.addEventListener("click", onCommentLayerClick);
    container.querySelector(".vc-shortcut-comment")?.removeAttribute("hidden");
    rebuildComments();
  }

  return {
    fitAll,
    fitSelection,
    resetView,
    selectNode,
    setSelection: (ids, focus = false) => setSelection(ids, focus),
    getSelection: () => [...selection],
    zoomAt,
    activateIframe,
    deactivateIframe,
    setTool,
    getTool: () => activeTool,
    setComments,
    getView: () => ({ ...view }),
    updateCanvas,
    dispose() {
      if (viewFrame !== null) cancelAnimationFrame(viewFrame);
      if (geometryFrame !== null) cancelAnimationFrame(geometryFrame);
      if (iframeSyncTimer !== null) window.clearTimeout(iframeSyncTimer);
      if (fitAnimationTimer !== null) window.clearTimeout(fitAnimationTimer);
      if (flickFrame !== null) cancelAnimationFrame(flickFrame);
      for (const timeout of iframeLoadTimeouts.values()) window.clearTimeout(timeout);
      resizeObserver?.disconnect();
      commentsLayer.removeEventListener("click", onCommentLayerClick);
      multiselectPanel.removeEventListener("click", onMultiselectClick);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onWindowBlur);
      toolbar.removeEventListener("click", onToolbarClick);
      minimap.removeEventListener("pointerdown", onMinimapPointerDown);
      minimap.removeEventListener("pointermove", onMinimapPointerMove);
      minimap.removeEventListener("pointerup", onMinimapPointerUp);
      minimap.removeEventListener("pointercancel", onMinimapPointerUp);
      zoomValue.removeEventListener("keydown", onZoomValueKeyDown);
      zoomValue.removeEventListener("focus", onZoomValueFocus);
      zoomValue.removeEventListener("blur", commitTypedZoom);
      shortcutHelpClose.removeEventListener("click", onShortcutHelpClose);
      inspectorClose.removeEventListener("click", onInspectorClose);
      inspectorRefCopy.removeEventListener("click", onInspectorRefCopy);
      nodesRoot.removeEventListener("dblclick", onNodesDoubleClick);
      nodesRoot.removeEventListener("click", onNodesClick);
      window.removeEventListener("message", onWindowMessage);
    },
  };
}
