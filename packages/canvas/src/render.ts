import type { PositionedCanvas, PositionedGroup, PositionedNode } from "./layout.js";
import { deviceFrameScale, renderDeviceFrame } from "./device-frame.js";
import { phoneFrameScale, renderPhoneFrame } from "./phone-frame.js";
import { type EdgePath, routeEdges } from "./router.js";
import { type IframeNode, type ImageNode, type LegendGroup, PERMISSIONS } from "./types.js";

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
}

function caption(node: PositionedNode): string {
  return `<div class="vc-caption"><div><div class="vc-caption-title">${escapeHtml(node.caption.title)}</div>${node.caption.subtitle ? `<div class="vc-caption-subtitle">${escapeHtml(node.caption.subtitle)}</div>` : ""}</div>${node.caption.tag ? `<div class="vc-caption-tag">${escapeHtml(node.caption.tag)}</div>` : ""}${node.maturity ? `<span class="vc-badge vc-tone-${node.maturity}">${node.maturity.toUpperCase()}</span>` : ""}</div>`;
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
        : `<div class="vc-iframe-viewport" style="width:${node.viewport.width}px;height:${node.viewport.height}px">${frame}</div>`;
  // Both shells draw their own rounded body, so the clip layer must not add
  // a second corner radius over the bezel.
  const radius =
    node.frame.kind === "phone" || node.frame.kind === "device" ? 0 : (node.frame.radius ?? 16);
  return `<div class="vc-iframe-clip vc-frame-${node.frame.kind}" style="--vc-frame-radius:${radius}px;--vc-iframe-scale:${scale}">${body}<div class="vc-iframe-guard"><span><i data-hint="fine">Double-click to interact</i><i data-hint="coarse">Double-tap to interact</i></span></div><button class="vc-iframe-exit" type="button" aria-label="Exit screen interaction">Exit</button></div>`;
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
  return `<div class="vc-image-viewport"><img src="${escapeHtml(url)}" alt="${escapeHtml(node.alt)}" decoding="async" style="object-fit:${node.fit};object-position:${position}" /><p class="vc-image-failure" aria-hidden="true">Image couldn’t be loaded.</p></div>`;
}
/*
 * Eight handles, not the one south-east dot this used to carry. With only
 * that corner, a node's top and left edges could not be moved at all — you
 * resized from the bottom-right and then dragged the whole node back to
 * where its other corner had been.
 */
const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
  .map((direction) => `<i class="vc-resize-handle vc-resize-${direction}" data-resize="${direction}"></i>`)
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
        : `${caption(node)}${nativeBody(node)}`
      : node.kind === "iframe"
        ? `${caption(node)}${iframeBody(node, options)}`
        : `${caption(node)}${imageBody(node, options)}`;
  return `<div class="vc-node vc-kind-${node.kind} vc-shape-${shape}" tabindex="0" data-node-id="${escapeHtml(node.id)}" data-lane="${escapeHtml(node.laneId ?? "")}" data-stage="${escapeHtml(node.stageId ?? "")}" style="left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px">${content}${options.editable ? RESIZE_HANDLES : ""}</div>`;
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
function renderEdge(path: EdgePath): string {
  const marker = MARKERS[path.edge.kind];
  const junctions = [path.junctionPoint, path.mergePoint]
    .filter((point) => point !== undefined)
    .map((point) => `<circle class="vc-edge-junction" cx="${point.x}" cy="${point.y}" r="4" />`)
    .join("");
  return `<g class="vc-edge vc-edge-${path.edge.kind} vc-route-${path.route}" data-edge-id="${escapeHtml(path.edge.id)}"><path class="vc-edge-halo" d="${path.d}" aria-hidden="true"/><path class="vc-edge-line" d="${path.d}" marker-end="url(#${marker})" ${path.edge.bidirectional ? `marker-start="url(#${marker})"` : ""}/>${junctions}${path.edge.label ? `<text class="vc-edge-label" x="${path.labelPoint.x}" y="${path.labelPoint.y}">${escapeHtml(path.edge.label.text)}</text>` : ""}</g>`;
}
function markerDefs(): string {
  return `<defs>${Object.entries(MARKERS)
    .map(
      ([kind, id]) =>
        `<marker id="${id}" class="vc-marker vc-marker-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`,
    )
    .join("")}</defs>`;
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
  const html = `<div class="vc-world" data-canvas-version="2" style="width:${canvas.width}px;height:${canvas.height}px"><div class="vc-lanes">${canvas.lanes.map((lane) => `<div class="vc-lane vc-role-${lane.role}" data-lane-id="${escapeHtml(lane.id)}" style="left:${lane.rect.x}px;top:${lane.rect.y}px;width:${lane.rect.w}px;height:${lane.rect.h}px"><div class="vc-lane-label">${escapeHtml(lane.label)}</div></div>`).join("")}</div><div class="vc-stages">${canvas.stages.map((stage) => `<div class="vc-stage" data-stage-id="${escapeHtml(stage.id)}" style="left:${stage.rect.x}px;top:${stage.rect.y}px;width:${stage.rect.w}px;height:${stage.rect.h}px"><div class="vc-stage-header"><div class="vc-stage-label">${escapeHtml(stage.label)}</div>${stage.summary ? `<div class="vc-stage-summary">${escapeHtml(stage.summary)}</div>` : ""}</div></div>`).join("")}</div><div class="vc-labels">${canvas.doc.labels.map((label) => `<div class="vc-label vc-tone-${label.tone ?? "neutral"}" style="left:${label.rect.x}px;top:${label.rect.y}px;width:${label.rect.w}px;height:${label.rect.h}px;text-align:${label.align ?? "left"}">${escapeHtml(label.text)}</div>`).join("")}</div><div class="vc-groups">${canvas.groups.map(renderGroup).join("")}</div><div class="vc-nodes">${canvas.nodes.map((node) => renderNode(node, options)).join("")}</div><svg class="vc-edges" width="${canvas.width}" height="${canvas.height}">${markerDefs()}${edges.map(renderEdge).join("")}</svg></div>${renderLegend(canvas.doc.legend)}`;
  return { html, width: canvas.width, height: canvas.height };
}
