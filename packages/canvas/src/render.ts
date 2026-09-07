import { deviceFrameScale, renderDeviceFrame } from "./device-frame.js";
import type { PositionedCanvas, PositionedGroup, PositionedNode } from "./layout.js";
import { phoneFrameScale, renderPhoneFrame } from "./phone-frame.js";
import { type PrototypeNodeFlags, prototypeNodeClasses } from "./prototype.js";
import { type EdgePath, routeEdges } from "./router.js";
import { ARROW_SHAPE } from "./routing/geometry.js";
import type { Theme } from "./themes.js";
import {
  type CanvasDrawing,
  type CanvasNote,
  type DrawingBounds,
  type DrawingPoint,
  type IframeNode,
  type ImageNode,
  type LegendGroup,
  PERMISSIONS,
  type Point,
  type Rect,
} from "./types.js";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export interface RenderOptions {
  resolveIframeUrl?: (node: IframeNode) => string;
  resolveImageUrl?: (node: ImageNode) => string;
  editable?: boolean;
  /** Viewers defer off-screen screen runtimes; deterministic exports opt into eager loading. */
  iframeLoading?: "lazy" | "eager";
  /** Export/snapshot selector: non-target iframe nodes remain inert placeholders. */
  shouldLoadIframe?: (node: Extract<PositionedNode, { kind: "iframe" }>) => boolean;
  /** Resolved base + workspace + canvas semantic tokens. */
  theme?: Theme;
  /**
   * Per-node Play / Download / more buttons in the caption strip. Off for
   * static renders and public viewers; the viewport turns them on and
   * routes the clicks.
   */
  captionActions?: boolean;
  /** Where Play goes: a real href, so ⌘-click opens the prototype in a new tab. */
  resolvePresentUrl?: (nodeId: string) => string | undefined;
  /** Prototype membership for this page, from `prototypeNodeFlags`. */
  prototypeFlags?: ReadonlyMap<string, PrototypeNodeFlags>;
}

const PLAY_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>`;
const DOWNLOAD_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const MORE_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>`;

/** Actor and decision shapes restyle the caption into something with no room for buttons. */
function captionActionsFor(node: PositionedNode, options: RenderOptions): string {
  if (!options.captionActions) return "";
  if (node.kind === "native" && (node.shape === "actor" || node.shape === "decision")) return "";
  const presentUrl = options.resolvePresentUrl?.(node.id);
  const interactive = options.prototypeFlags?.get(node.id)?.interactive ?? false;
  const play = presentUrl
    ? `<a class="vc-caption-action vc-caption-play${interactive ? " is-interactive" : ""}" href="${escapeHtml(presentUrl)}" data-action="play" title="${interactive ? "Present this screen as a clickable prototype" : "Present from this screen"}" aria-label="Present from this screen" draggable="false">${PLAY_ICON}</a>`
    : "";
  return `<div class="vc-caption-actions" data-caption-actions>${play}<button type="button" class="vc-caption-action vc-caption-download" data-action="download" title="Download this screen as PNG" aria-label="Download this screen as PNG">${DOWNLOAD_ICON}</button><button type="button" class="vc-caption-action vc-caption-more" data-action="more" title="More actions" aria-label="More actions" aria-haspopup="menu">${MORE_ICON}</button></div>`;
}

function themeStyle(theme?: Theme): string {
  if (!theme) return "";
  const vars: Record<string, string> = {
    "--vc-ink": theme.colors.foreground,
    "--vc-ink-soft": theme.colors.mutedForeground,
    "--vc-paper": theme.colors.background,
    "--vc-white": theme.colors.background,
    "--vc-line": theme.colors.border,
    "--vc-muted": theme.colors.mutedForeground,
    "--vc-success": theme.colors.success,
    "--vc-warning": theme.colors.warning,
    "--vc-danger": theme.colors.danger,
    "--vc-body": theme.typography.fontSans,
    "--vc-mono": theme.typography.fontMono,
    "--vc-role-primary": theme.colors.primary,
    "--vc-role-secondary": theme.colors.secondary,
    "--vc-accent": theme.colors.primary,
    "--vc-accent-text": theme.colors.primary,
    "--vc-color-surface": theme.colors.surface,
    "--vc-radius-sm": theme.radius.sm,
    "--vc-radius-md": theme.radius.md,
    "--vc-radius-lg": theme.radius.lg,
    "--vc-radius-xl": theme.radius.xl,
    "--vc-shadow-sm": theme.shadows.sm ?? "none",
    "--vc-shadow-md": theme.shadows.md ?? "none",
    "--vc-shadow-lg": theme.shadows.lg ?? "none",
    "--vc-shadow-xl": theme.shadows.xl ?? "none",
  };
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${escapeHtml(value)}`)
    .join(";");
}

function caption(node: PositionedNode, options: RenderOptions = {}): string {
  return `<div class="vc-caption"><div class="vc-caption-text"><div class="vc-caption-title">${escapeHtml(node.caption.title)}</div>${node.caption.subtitle ? `<div class="vc-caption-subtitle">${escapeHtml(node.caption.subtitle)}</div>` : ""}</div>${node.caption.tag ? `<div class="vc-caption-tag">${escapeHtml(node.caption.tag)}</div>` : ""}${node.maturity ? `<span class="vc-badge vc-tone-${node.maturity}">${node.maturity.toUpperCase()}</span>` : ""}${captionActionsFor(node, options)}</div>`;
}
function nativeBody(node: Extract<PositionedNode, { kind: "native" }>): string {
  const body = node.body;
  if (!body) return "";
  return `<div class="vc-native-body">${body.text ? `<p>${escapeHtml(body.text)}</p>` : ""}${body.points?.length ? `<ul>${body.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}${body.code ? `<pre>${escapeHtml(body.code)}</pre>` : ""}</div>`;
}
function actorBody(node: Extract<PositionedNode, { kind: "native" }>): string {
  const role = node.actorRole ?? "subject";
  const progress = node.body?.progress;
  const pips = progress
    ? Array.from({ length: progress.total }, (_, index) => {
        const step = index + 1;
        const state =
          step < progress.value || (step === progress.value && progress.current === false)
            ? " done"
            : step === progress.value
              ? " now"
              : "";
        return `<i class="vc-person-pip${state}"></i>`;
      }).join("")
    : "";
  return `<span class="vc-person-icon vc-person-${role}" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"></circle><path d="M5.5 19c.7-4 2.9-6 6.5-6s5.8 2 6.5 6"></path></svg></span><span class="vc-person-copy"><em>${escapeHtml(node.caption.subtitle ?? "")} · ${escapeHtml(node.caption.tag ?? "")}</em><b>${escapeHtml(node.caption.title)}</b>${node.body?.text ? `<small>${escapeHtml(node.body.text)}</small>` : ""}${progress ? `<span class="vc-person-progress">${pips}<span>${progress.value} / ${progress.total}</span></span>` : ""}</span>`;
}
function iframeBody(
  node: Extract<PositionedNode, { kind: "iframe" }>,
  options: RenderOptions,
): string {
  const url =
    options.resolveIframeUrl?.(node) ?? `${node.source.entrypoint}${node.source.route ?? ""}`;
  /*
   * `permissions` is an allow-list — the features this screen may use — but
   * this line used to emit `${permission} 'none'` for each entry, so naming
   * a feature *denied* it and naming nothing left the attribute empty.
   *
   * Emit the whole closed enum instead: `'src'` for the features the node
   * asked for, `'none'` for the rest. The policy is then explicit and
   * default-deny rather than relying on the embedder's inherited one. The
   * common `permissions: []` goes from an empty attribute to an explicit
   * deny-all, which is a tightening.
   */
  const granted = new Set<string>(node.permissions);
  const allow = PERMISSIONS.map(
    (permission) => `${permission} ${granted.has(permission) ? "'src'" : "'none'"}`,
  ).join("; ");
  const scale = Math.min(
    node.w / node.viewport.width,
    Math.max(1, node.h - 47) / node.viewport.height,
  );
  const loading =
    options.shouldLoadIframe && !options.shouldLoadIframe(node)
      ? "lazy"
      : (options.iframeLoading ?? "lazy");
  const sandbox = node.sandbox.map(escapeHtml).join(" ");
  const frame =
    loading === "eager"
      ? `<iframe tabindex="-1" loading="eager" src="${escapeHtml(url)}" sandbox="${sandbox}" allow="${escapeHtml(allow)}" referrerpolicy="no-referrer" data-entrypoint="${escapeHtml(node.source.entrypoint)}"></iframe>`
      : `<div class="vc-iframe-placeholder" data-src="${escapeHtml(url)}" data-sandbox="${sandbox}" data-allow="${escapeHtml(allow)}" data-entrypoint="${escapeHtml(node.source.entrypoint)}"><span>Loading screen</span></div>`;
  const body =
    node.frame.kind === "phone"
      ? renderPhoneFrame(frame, node.frame.time, phoneFrameScale(node.w, node.h))
      : node.frame.kind === "device"
        ? renderDeviceFrame({
            preset: node.frame.preset,
            screenContent: frame,
            viewport: node.viewport,
            display: node.frame.display,
            url: node.frame.url,
            time: node.frame.time,
            scale: deviceFrameScale(node.frame.preset, node.w, node.h, node.viewport.height),
          })
        : `<div class="vc-iframe-viewport" data-snapshot-content style="width:${node.viewport.width}px;height:${node.viewport.height}px">${frame}</div>`;
  // Both shells draw their own rounded body, so the clip layer must not add
  // a second corner radius over the bezel.
  const radius =
    node.frame.kind === "phone" || node.frame.kind === "device" ? 0 : (node.frame.radius ?? 16);
  return `<div class="vc-iframe-clip vc-frame-${node.frame.kind}" style="--vc-frame-radius:${radius}px;--vc-iframe-scale:${scale}">${body}<div class="vc-iframe-guard"><span><i data-hint="fine">Double-click to interact</i><i data-hint="coarse">Double-tap to interact</i></span></div></div>`;
}
function imageBody(
  node: Extract<PositionedNode, { kind: "image" }>,
  options: RenderOptions,
): string {
  const position = `${node.focalPosition.x * 100}% ${node.focalPosition.y * 100}%`;
  const url = options.resolveImageUrl?.(node) ?? node.source.path;
  /*
   * Image nodes used to be a bare <img>: no loading state, no decode hint,
   * no error fallback — a stark contrast with the iframe scheduler right
   * next to them.
   *
   * The states are driven from viewport.ts, not from inline `onload` /
   * `onerror` attributes: this same markup is served on the public
   * artifact path under a CSP with no `unsafe-inline`, where inline
   * handlers never run — images would have sat in a permanent skeleton.
   * With no script, the element carries no `data-image-state` at all and
   * renders exactly as it always did. `decoding=async` keeps a large
   * screenshot off the main thread either way.
   */
  return `<div class="vc-image-viewport" data-snapshot-content><img src="${escapeHtml(url)}" alt="${escapeHtml(node.alt)}" decoding="async" style="object-fit:${node.fit};object-position:${position}" /><p class="vc-image-failure" aria-hidden="true">Image couldn’t be loaded.</p></div>`;
}
/*
 * Eight handles, not the one south-east dot this used to carry. With only
 * that corner, a node's top and left edges could not be moved at all — you
 * resized from the bottom-right and then dragged the whole node back to
 * where its other corner had been.
 */
const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
  .map(
    (direction) =>
      `<i class="vc-resize-handle vc-resize-${direction}" data-resize="${direction}"></i>`,
  )
  .join("");

function renderNode(node: PositionedNode, options: RenderOptions): string {
  const shape =
    node.kind === "native"
      ? node.shape
      : node.kind === "iframe"
        ? `iframe-${node.frame.kind}`
        : "image";
  const content =
    node.kind === "native"
      ? node.shape === "actor"
        ? actorBody(node)
        : `${caption(node, options)}${nativeBody(node)}`
      : node.kind === "iframe"
        ? `${caption(node, options)}${iframeBody(node, options)}`
        : `${caption(node, options)}${imageBody(node, options)}`;
  const flags = prototypeNodeClasses(options.prototypeFlags?.get(node.id));
  return `<div class="vc-node vc-kind-${node.kind} vc-shape-${shape}${flags}" tabindex="0" data-node-id="${escapeHtml(node.id)}" data-lane="${escapeHtml(node.laneId ?? "")}" data-stage="${escapeHtml(node.stageId ?? "")}" style="left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px">${content}${options.editable ? RESIZE_HANDLES : ""}</div>`;
}
/**
 * A sticky note is world-space text with a width and no stored height: the
 * element wraps its text and `note-metrics.ts` estimates the same number
 * for anything that cannot ask the DOM. `data-author` is what lets the
 * agent's notes and the human's read differently without two components.
 */
export function renderNote(note: CanvasNote): string {
  return `<div class="vc-note" tabindex="0" data-note-id="${escapeHtml(note.id)}" data-color="${note.color}" data-size="${note.size}" data-author="${note.author}" style="left:${note.x}px;top:${note.y}px;width:${note.w}px"><div class="vc-note-text">${escapeHtml(note.text)}</div></div>`;
}
function renderGroup(group: PositionedGroup): string {
  return `<div class="vc-group" tabindex="0" data-group-id="${escapeHtml(group.id)}" style="left:${group.x}px;top:${group.y}px;width:${group.w}px;height:${group.h}px"><span>${escapeHtml(group.label ?? group.id)}</span></div>`;
}
const MARKERS: Record<EdgePath["edge"]["kind"], string> = {
  main: "vc-arrow-main",
  secondary: "vc-arrow-secondary",
  sync: "vc-arrow-sync",
  actor: "vc-arrow-actor",
  exception: "vc-arrow-exception",
  external: "vc-arrow-external",
};
export function renderEdge(path: EdgePath): string {
  const junctions = [path.junctionPoint, path.mergePoint]
    .filter((point) => point !== undefined)
    .map((point) => `<circle class="vc-edge-junction" cx="${point.x}" cy="${point.y}" r="4" />`)
    .join("");
  const label = path.label;
  const labelHtml = label
    ? `${label.leader ? `<path class="vc-edge-leader" d="${label.leader.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ")}"/>` : ""}<rect class="vc-edge-label-bg" x="${label.bounds.x}" y="${label.bounds.y}" width="${label.bounds.w}" height="${label.bounds.h}" rx="5"/><text class="vc-edge-label" x="${label.point.x}" y="${label.point.y}">${label.lines.map((line, i) => `<tspan x="${label.point.x}" y="${label.bounds.y + 18 + i * 16}">${escapeHtml(line)}</tspan>`).join("")}</text>`
    : "";
  const description =
    path.edge.label?.text ?? `${path.edge.source.nodeId} → ${path.edge.target.nodeId}`;
  return `<g class="vc-edge vc-edge-${path.edge.kind} vc-route-${path.route}${path.diagnostics.length ? " vc-edge-warning" : ""}" data-edge-id="${escapeHtml(path.edge.id)}" data-routing-diagnostics="${path.diagnostics.join(",")}" tabindex="0" role="button" aria-label="${escapeHtml(description)}"><title>${escapeHtml(description)}${path.diagnostics.length ? ` — ${path.diagnostics.join(", ")}` : ""}</title><path class="vc-edge-hit" d="${path.d}"/><path class="vc-edge-halo" d="${path.d}" aria-hidden="true"/><path class="vc-edge-line" d="${path.d}"/>${junctions}${labelHtml}</g>`;
}
/** Paint tips last: a reciprocal edge's halo must never erase an arrowhead. */
export function renderEdgeHeads(paths: EdgePath[]): string {
  return (
    '<g class="vc-edge-heads" aria-hidden="true">' +
    paths
      .map((path) => {
        const marker = MARKERS[path.edge.kind];
        return `<path d="${path.d}" fill="none" stroke="none" marker-end="url(#${marker})" ${path.edge.bidirectional ? `marker-start="url(#${marker})"` : ""}/>`;
      })
      .join("") +
    "</g>"
  );
}
function markerDefs(): string {
  return `<defs>${Object.entries(MARKERS)
    .map(
      ([kind, id]) =>
        `<marker id="${id}" class="vc-marker vc-marker-${kind}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="${ARROW_SHAPE}"/></marker>`,
    )
    .join("")}</defs>`;
}

function drawingTargetRect(node: PositionedNode): Rect {
  if (node.kind === "image" || node.kind === "iframe") {
    return { x: node.x, y: node.y + 47, w: node.w, h: Math.max(1, node.h - 47) };
  }
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

function resolveDrawingPoint(point: DrawingPoint, nodes: Map<string, PositionedNode>): Point {
  if (point.type === "point") return point;
  const node = nodes.get(point.nodeId);
  if (!node) throw new Error(`drawing references unknown node "${point.nodeId}"`);
  if (point.type === "node") {
    const rect = drawingTargetRect(node);
    return { x: rect.x + rect.w * point.x, y: rect.y + rect.h * point.y };
  }
  if (point.side === "top") return { x: node.x + node.w * point.offset, y: node.y };
  if (point.side === "right") return { x: node.x + node.w, y: node.y + node.h * point.offset };
  if (point.side === "bottom") return { x: node.x + node.w * point.offset, y: node.y + node.h };
  return { x: node.x, y: node.y + node.h * point.offset };
}

function resolveDrawingBounds(bounds: DrawingBounds, nodes: Map<string, PositionedNode>): Rect {
  if (bounds.type === "rect") return bounds;
  const node = nodes.get(bounds.nodeId);
  if (!node) throw new Error(`drawing references unknown node "${bounds.nodeId}"`);
  const rect = drawingTargetRect(node);
  return {
    x: rect.x + rect.w * bounds.x,
    y: rect.y + rect.h * bounds.y,
    w: rect.w * bounds.w,
    h: rect.h * bounds.h,
  };
}

function drawingStyle(drawing: CanvasDrawing): string {
  const style = drawing.style;
  return [
    `stroke-width="${style.strokeWidth}"`,
    `opacity="${style.opacity}"`,
    style.dashed ? 'stroke-dasharray="10 8"' : "",
    style.color ? `stroke="${escapeHtml(style.color)}"` : "",
    style.fill ? `fill="${escapeHtml(style.fill)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function renderDrawing(drawing: CanvasDrawing, nodes: Map<string, PositionedNode>): string {
  const className = `vc-drawing vc-drawing-${drawing.kind} vc-drawing-${drawing.style.preset}`;
  const clip =
    "bounds" in drawing && drawing.bounds.type === "node" && drawing.bounds.clip
      ? ` clip-path="url(#vc-drawing-clip-${escapeHtml(drawing.id)})"`
      : "";
  const common = `class="${className}" data-drawing-id="${escapeHtml(drawing.id)}" ${drawingStyle(drawing)}${clip}`;
  if ("bounds" in drawing) {
    const bounds = resolveDrawingBounds(drawing.bounds, nodes);
    if (drawing.kind === "ellipse") {
      return `<ellipse ${common} cx="${bounds.x + bounds.w / 2}" cy="${bounds.y + bounds.h / 2}" rx="${bounds.w / 2}" ry="${bounds.h / 2}"/>`;
    }
    return `<rect ${common} x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" rx="${drawing.kind === "highlight" ? 6 : 10}"/>`;
  }
  if ("from" in drawing) {
    const from = resolveDrawingPoint(drawing.from, nodes);
    const to = resolveDrawingPoint(drawing.to, nodes);
    return `<line ${common} x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"${drawing.kind === "arrow" ? ' marker-end="url(#vc-drawing-arrow)"' : ""}/>`;
  }
  if ("points" in drawing) {
    const points = drawing.points.map((point) => resolveDrawingPoint(point, nodes));
    const d = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
    return `<path ${common} d="${d}${drawing.closed ? " Z" : ""}"/>`;
  }
  const at = resolveDrawingPoint(drawing.at, nodes);
  if (drawing.kind === "badge") {
    const width = Math.max(36, drawing.text.length * 8 + 20);
    return `<g ${common}><rect x="${at.x}" y="${at.y - 16}" width="${width}" height="32" rx="16"/><text x="${at.x + width / 2}" y="${at.y}">${escapeHtml(drawing.text)}</text></g>`;
  }
  const number = drawing.number
    ? `<circle cx="${at.x}" cy="${at.y}" r="18"/><text class="vc-drawing-callout-number" x="${at.x}" y="${at.y}">${drawing.number}</text>`
    : "";
  const textX = drawing.number ? at.x + 28 : at.x;
  return `<g ${common}>${number}<text class="vc-drawing-callout-text" x="${textX}" y="${at.y}">${escapeHtml(drawing.text)}</text></g>`;
}

function drawingDefs(drawings: CanvasDrawing[], nodes: Map<string, PositionedNode>): string {
  const clips = drawings
    .filter(
      (drawing) => "bounds" in drawing && drawing.bounds.type === "node" && drawing.bounds.clip,
    )
    .map((drawing) => {
      if (!("bounds" in drawing) || drawing.bounds.type !== "node") return "";
      const node = nodes.get(drawing.bounds.nodeId);
      if (!node) return "";
      const rect = drawingTargetRect(node);
      return `<clipPath id="vc-drawing-clip-${escapeHtml(drawing.id)}"><rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"/></clipPath>`;
    })
    .join("");
  return `<defs><marker id="vc-drawing-arrow" class="vc-drawing-arrow-marker" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="${ARROW_SHAPE}"/></marker>${clips}</defs>`;
}
function renderLegend(groups?: LegendGroup[]): string {
  return groups?.length
    ? `<div class="vc-legend">${groups.map((group) => `<div class="vc-legend-group">${group.title ? `<div class="vc-legend-title">${escapeHtml(group.title)}</div>` : ""}${group.items.map((item) => `<div class="vc-legend-item ${item.role ? `vc-role-${item.role}` : item.maturity ? `vc-tone-${item.maturity}` : ""}"><span class="vc-legend-swatch"></span>${escapeHtml(item.label)}</div>`).join("")}</div>`).join("")}</div>`
    : "";
}

export interface RenderedCanvas {
  html: string;
  width: number;
  height: number;
}
export function renderCanvas(
  canvas: PositionedCanvas,
  options: RenderOptions = {},
): RenderedCanvas {
  const edges = routeEdges(canvas);
  const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const drawings = canvas.doc.drawings ?? [];
  const html = `<div class="vc-world" data-canvas-version="2" style="width:${canvas.width}px;height:${canvas.height}px"><div class="vc-lanes">${canvas.lanes.map((lane) => `<div class="vc-lane vc-role-${lane.role}" data-lane-id="${escapeHtml(lane.id)}" style="left:${lane.rect.x}px;top:${lane.rect.y}px;width:${lane.rect.w}px;height:${lane.rect.h}px"><div class="vc-lane-label">${escapeHtml(lane.label)}</div></div>`).join("")}</div><div class="vc-stages">${canvas.stages.map((stage) => `<div class="vc-stage" data-stage-id="${escapeHtml(stage.id)}" style="left:${stage.rect.x}px;top:${stage.rect.y}px;width:${stage.rect.w}px;height:${stage.rect.h}px"><div class="vc-stage-header"><div class="vc-stage-label">${escapeHtml(stage.label)}</div>${stage.summary ? `<div class="vc-stage-summary">${escapeHtml(stage.summary)}</div>` : ""}</div></div>`).join("")}</div><div class="vc-labels">${canvas.doc.labels.map((label) => `<div class="vc-label vc-tone-${label.tone ?? "neutral"}" style="left:${label.rect.x}px;top:${label.rect.y}px;width:${label.rect.w}px;height:${label.rect.h}px;text-align:${label.align ?? "left"}">${escapeHtml(label.text)}</div>`).join("")}</div><div class="vc-groups">${canvas.groups.map(renderGroup).join("")}</div><div class="vc-nodes">${canvas.nodes.map((node) => renderNode(node, options)).join("")}</div><svg class="vc-edges" width="${canvas.width}" height="${canvas.height}">${markerDefs()}${edges.map(renderEdge).join("")}${renderEdgeHeads(edges)}</svg><svg class="vc-drawings" width="${canvas.width}" height="${canvas.height}">${drawingDefs(drawings, nodesById)}${drawings.map((drawing) => renderDrawing(drawing, nodesById)).join("")}</svg><div class="vc-notes">${(canvas.doc.notes ?? []).map(renderNote).join("")}</div></div>${renderLegend(canvas.doc.legend)}`;
  const themedHtml = options.theme
    ? html
        .replace(
          'data-canvas-version="2"',
          `data-canvas-version="2" data-theme-id="${escapeHtml(options.theme.name)}" data-chart-palette="${escapeHtml(options.theme.chartPalette.join(","))}"`,
        )
        .replace('style="width:', `style="${themeStyle(options.theme)};width:`)
    : html;
  return { html: themedHtml, width: canvas.width, height: canvas.height };
}
