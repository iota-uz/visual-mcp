import type { PositionedCanvas, PositionedNode } from "./layout.js";
import type { EdgePath } from "./router.js";
import { routeEdges } from "./router.js";
import type { LegendGroup, NodeContent } from "./types.js";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderContent(content: NodeContent | undefined): string {
  if (!content) return "";
  switch (content.type) {
    case "html": {
      const frame = content.frame ?? "none";
      const scaleStyle = content.scale ? ` style="--vc-content-scale:${content.scale}"` : "";
      if (frame === "none") {
        return `<div class="vc-content vc-content-html"${scaleStyle}>${content.html}</div>`;
      }
      return `<div class="vc-frame vc-frame-${frame}"${scaleStyle}>
        <div class="vc-frame-chrome"></div>
        <div class="vc-content vc-content-html">${content.html}</div>
      </div>`;
    }
    case "text":
      return `<div class="vc-content vc-content-text">${escapeHtml(content.body)}</div>`;
  }
}

function renderNode(node: PositionedNode): string {
  const badge = node.badge
    ? `<span class="vc-badge vc-tone-${node.badge.tone}">${escapeHtml(node.badge.text)}</span>`
    : "";
  const subtitle = node.caption.subtitle
    ? `<div class="vc-caption-subtitle">${escapeHtml(node.caption.subtitle)}</div>`
    : "";
  const tag = node.caption.tag
    ? `<div class="vc-caption-tag">${escapeHtml(node.caption.tag)}</div>`
    : "";

  return `<div
      class="vc-node vc-shape-${node.shape}"
      data-node-id="${escapeHtml(node.id)}"
      data-lane="${escapeHtml(node.lane)}"
      data-stage="${escapeHtml(node.stage)}"
      style="left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px"
    >
      <div class="vc-caption">
        <div class="vc-caption-title">${escapeHtml(node.caption.title)}</div>
        ${subtitle}
        ${tag}
        ${badge}
      </div>
      ${renderContent(node.content)}
    </div>`;
}

const EDGE_MARKER_ID: Record<EdgePath["edge"]["kind"], string> = {
  main: "vc-arrow-main",
  secondary: "vc-arrow-secondary",
  sync: "vc-arrow-sync",
  actor: "vc-arrow-actor",
  exception: "vc-arrow-exception",
  external: "vc-arrow-external",
};

function renderEdge(path: EdgePath): string {
  const markerId = EDGE_MARKER_ID[path.edge.kind];
  const markerEnd = `url(#${markerId})`;
  const markerStart = path.edge.bidirectional ? `url(#${markerId})` : "";
  const label = path.edge.label
    ? `<text class="vc-edge-label" x="${path.labelPoint.x}" y="${path.labelPoint.y}">${escapeHtml(path.edge.label)}</text>`
    : "";
  return `<g class="vc-edge vc-edge-${path.edge.kind} vc-route-${path.route}" data-edge-id="${escapeHtml(path.edge.id ?? `${path.edge.from}->${path.edge.to}`)}">
      <path d="${path.d}" marker-end="${markerEnd}" ${markerStart ? `marker-start="${markerStart}"` : ""} />
      ${label}
    </g>`;
}

function renderMarkerDefs(): string {
  const kinds = Object.entries(EDGE_MARKER_ID);
  const markers = kinds
    .map(
      ([kind, id]) => `<marker id="${id}" class="vc-marker vc-marker-${kind}" viewBox="0 0 10 10"
        refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" />
      </marker>`,
    )
    .join("\n");
  return `<defs>${markers}</defs>`;
}

function renderLanes(canvas: PositionedCanvas): string {
  return canvas.lanes
    .map(
      (lane) =>
        `<div class="vc-lane vc-role-${lane.role}" data-lane-id="${escapeHtml(lane.id)}" style="top:${lane.y}px;height:${lane.height}px">
          <div class="vc-lane-label">${escapeHtml(lane.label)}</div>
        </div>`,
    )
    .join("\n");
}

function renderStages(canvas: PositionedCanvas): string {
  return canvas.stages
    .map((stage) => {
      const summary = stage.summary
        ? `<div class="vc-stage-summary">${escapeHtml(stage.summary)}</div>`
        : "";
      return `<div class="vc-stage" data-stage-id="${escapeHtml(stage.id)}" style="left:${stage.x}px;width:${stage.width}px;height:${canvas.height}px">
          <div class="vc-stage-header">
            <div class="vc-stage-label">${escapeHtml(stage.label)}</div>
            ${summary}
          </div>
        </div>`;
    })
    .join("\n");
}

function renderLegend(groups: LegendGroup[] | undefined): string {
  if (!groups || groups.length === 0) return "";
  const body = groups
    .map((group) => {
      const title = group.title
        ? `<div class="vc-legend-title">${escapeHtml(group.title)}</div>`
        : "";
      const items = group.items
        .map((item) => {
          const cls = item.role ? `vc-role-${item.role}` : item.tone ? `vc-tone-${item.tone}` : "";
          return `<div class="vc-legend-item ${cls}"><span class="vc-legend-swatch"></span>${escapeHtml(item.label)}</div>`;
        })
        .join("\n");
      return `<div class="vc-legend-group">${title}${items}</div>`;
    })
    .join("\n");
  return `<div class="vc-legend">${body}</div>`;
}

export interface RenderedCanvas {
  html: string;
  width: number;
  height: number;
}

/**
 * Renders the world contents only — lanes, stage frames, node cards, the SVG
 * edge layer, and legend. Caller mounts this into a
 * container that already has theme.css loaded (the browser viewport, or a
 * static page assembled by the render pipeline in a later milestone).
 */
export function renderCanvas(canvas: PositionedCanvas): RenderedCanvas {
  const edges = routeEdges(canvas);
  const html = `<div class="vc-world" style="width:${canvas.width}px;height:${canvas.height}px">
      <div class="vc-lanes">${renderLanes(canvas)}</div>
      <div class="vc-stages">${renderStages(canvas)}</div>
      <div class="vc-nodes">${canvas.nodes.map(renderNode).join("\n")}</div>
      <svg class="vc-edges" width="${canvas.width}" height="${canvas.height}">
        ${renderMarkerDefs()}
        ${edges.map(renderEdge).join("\n")}
      </svg>
    </div>
    ${renderLegend(canvas.doc.legend)}`;
  return { html, width: canvas.width, height: canvas.height };
}
