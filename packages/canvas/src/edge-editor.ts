import type { PositionedCanvas } from "./layout.js";
import { escapeHtml } from "./render.js";
import { routeEdges } from "./router.js";
import { required } from "./routing/invariant.js";
import { type CanvasEdge, CanvasEdgeSchema, type Point } from "./types.js";

interface Options {
  container: HTMLElement;
  canvas: () => PositionedCanvas;
  editable: boolean;
  toWorld: (x: number, y: number) => Point;
  paint: () => void;
  commit?: (edge: CanvasEdge, previous: CanvasEdge) => void | Promise<void>;
}
/** Delegated controls survive reactive SVG replacement and keep iframe owners intact. */
export function mountEdgeEditor(options: Options): {
  refresh: () => void;
  destroy: () => void;
} {
  const { container } = options,
    panel = document.createElement("aside");
  panel.className = "vc-edge-editor";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Arrow settings");
  container.append(panel);
  let selected: string | null = null,
    drag: {
      before: CanvasEdge;
      type: string;
      index: number;
      points: Point[];
      labelBase?: Point;
    } | null = null;
  const current = () => options.canvas().doc.edges.find((e) => e.id === selected);
  function handles() {
    container.querySelector(".vc-edge-handles")?.remove();
    const edge = current();
    if (!edge || !options.editable) return;
    const path = routeEdges(options.canvas()).find((p) => p.edge.id === edge.id);
    if (!path) return;
    const svg = container.querySelector(".vc-edges");
    if (!svg) return;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("vc-edge-handles");
    const add = (p: Point, type: string, index = 0) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(p.x));
      circle.setAttribute("cy", String(p.y));
      circle.setAttribute("r", String(Math.abs(options.toWorld(6, 0).x - options.toWorld(0, 0).x)));
      circle.dataset.handle = type;
      circle.dataset.index = String(index);
      group.append(circle);
    };
    add(required(path.points[0]), "source");
    add(required(path.points.at(-1)), "target");
    (edge.route.waypoints ?? []).forEach((p, i) => {
      add(p, "waypoint", i);
    });
    if (edge.route.type === "orthogonal")
      for (let i = 1; i < path.points.length - 2; i++) {
        const a = required(path.points[i]),
          b = required(path.points[i + 1]);
        add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, "segment", i);
      }
    if (path.label) add(path.labelPoint, "label");
    svg.append(group);
  }
  function refresh() {
    const edge = current();
    if (!edge) {
      selected = null;
      panel.hidden = true;
      handles();
      return;
    }
    panel.hidden = false;
    container.querySelectorAll(".vc-edge").forEach((el) => {
      el.classList.toggle("vc-edge-selected", el.getAttribute("data-edge-id") === selected);
    });
    const select = (
      name: string,
      value: string,
      values: {
        value: string;
        label: string;
      }[],
    ) =>
      `<select name="${name}">${values.map((v) => `<option value="${escapeHtml(v.value)}"${v.value === value ? " selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}</select>`;
    const nodes = options.canvas().nodes.map((n) => ({ value: n.id, label: n.caption.title }));
    const endpoint = (type: "source" | "target") => {
      const p = edge[type],
        node = required(options.canvas().nodes.find((n) => n.id === p.nodeId));
      return `<fieldset><legend>${type === "source" ? "From" : "To"}</legend><label>Card${select(`${type}Node`, p.nodeId, nodes)}</label><label>Port${select(`${type}Port`, p.anchorId ? `anchor:${p.anchorId}` : (p.side ?? "auto"), [{ value: "auto", label: "Automatic" }, ...["top", "right", "bottom", "left"].map((value) => ({ value, label: value })), ...node.anchors.map((a) => ({ value: `anchor:${a.id}`, label: `Named: ${a.id}` }))])}</label><details><summary>Position on side</summary><label>Side position (0–1)<input name="${type}Offset" type="number" min="0" max="1" step="0.05" value="${p.offset ?? 0.5}"${p.side ? "" : " disabled"}></label></details></fieldset>`;
    };
    const diagnostic =
      routeEdges(options.canvas()).find((p) => p.edge.id === edge.id)?.diagnostics ?? [];
    const messages: Record<string, string> = {
      no_clear_route: "This arrow crosses a card. Move a card or choose another port.",
      endpoint_blocked: "An endpoint is blocked by a card.",
      constraint_conflict: "A waypoint cannot be reached without crossing a card.",
      routing_budget_exceeded: "This layout is too complex to route automatically. Add a waypoint.",
      label_no_space: "The label overlaps other content. Move its handle or set an offset.",
    };
    panel.innerHTML = `<header><strong>Arrow</strong><button type="button" data-close aria-label="Close arrow settings">×</button></header><p>${escapeHtml(edge.label?.text ?? edge.id)}</p>${diagnostic.map((d) => `<p role="status">${messages[d]}</p>`).join("")}${
      options.editable
        ? `<form>${endpoint("source")}${endpoint("target")}<label>Route${select(
            "route",
            edge.route.type,
            ["orthogonal", "bezier", "straight"].map((value) => ({ value, label: value })),
          )}</label><details><summary>Route constraints</summary><label>Corner radius<input name="radius" type="number" min="0" max="40" value="${edge.route.radius ?? 10}"></label><label>Via points (x, y per line)<textarea name="waypoints" rows="3">${edge.route.waypoints?.map((p) => `${p.x}, ${p.y}`).join("\n") ?? ""}</textarea></label></details><label>Label<textarea name="label" rows="2">${escapeHtml(edge.label?.text ?? "")}</textarea></label><label>Label offset (x, y; empty for automatic)<input name="labelOffset" value="${edge.label?.offset ? `${edge.label.offset.x}, ${edge.label.offset.y}` : ""}"></label><label><input type="checkbox" name="bidirectional"${edge.bidirectional ? " checked" : ""}> Arrowheads at both ends</label><p class="vc-edge-error" role="alert"></p><footer><button type="button" data-reset>Reset route</button><button type="submit">Apply</button></footer></form>`
        : "<p>Sign in to adjust this arrow.</p>"
    }`;
    handles();
  }
  function apply(next: CanvasEdge, previous: CanvasEdge, commit: boolean) {
    const canvas = options.canvas(),
      i = canvas.doc.edges.findIndex((e) => e.id === next.id);
    if (i < 0) return;
    canvas.doc.edges[i] = next;
    options.paint();
    handles();
    if (commit) {
      void options.commit?.(next, previous);
      refresh();
    }
  }
  function choose(id: string) {
    selected = id;
    refresh();
  }
  function click(event: Event) {
    const target = event.target as Element;
    if (target.closest("[data-close]")) {
      selected = null;
      panel.hidden = true;
      handles();
      return;
    }
    if (target.closest("[data-reset]")) {
      const edge = current();
      if (edge)
        apply(
          {
            ...edge,
            source: { nodeId: edge.source.nodeId },
            target: { nodeId: edge.target.nodeId },
            route: { type: "orthogonal" },
            label: edge.label ? { text: edge.label.text } : undefined,
          },
          edge,
          true,
        );
      return;
    }
    const el = target.closest(".vc-edge");
    if (el) choose(required(el.getAttribute("data-edge-id")));
  }
  function submit(event: Event) {
    event.preventDefault();
    const edge = current();
    if (!edge) return;
    const data = new FormData(required(panel.querySelector("form"))),
      value = (key: string) => String(data.get(key) ?? "");
    try {
      const parsePoint = (text: string) => {
        const pieces = text.split(",").map((s) => s.trim());
        if (pieces.length !== 2 || pieces.some((s) => !s || !Number.isFinite(Number(s))))
          throw new Error("Use finite x, y coordinates.");
        return { x: Number(pieces[0]), y: Number(pieces[1]) };
      };
      const endpoint = (type: string) => {
        const port = value(`${type}Port`),
          nodeId = value(`${type}Node`);
        return port.startsWith("anchor:")
          ? { nodeId, anchorId: port.slice(7) }
          : port === "auto"
            ? { nodeId }
            : { nodeId, side: port, offset: Number(value(`${type}Offset`)) };
      };
      const next = CanvasEdgeSchema.parse({
        ...edge,
        source: endpoint("source"),
        target: endpoint("target"),
        route: {
          type: value("route"),
          radius: Number(value("radius")),
          waypoints: value("waypoints").trim()
            ? value("waypoints").trim().split("\n").map(parsePoint)
            : undefined,
        },
        label: value("label").trim()
          ? {
              text: value("label"),
              ...(edge.label?.position !== undefined ? { position: edge.label.position } : {}),
              ...(value("labelOffset").trim() ? { offset: parsePoint(value("labelOffset")) } : {}),
            }
          : undefined,
        bidirectional: data.has("bidirectional"),
      });
      for (const p of [next.source, next.target])
        if (
          p.anchorId &&
          !options
            .canvas()
            .nodes.find((n) => n.id === p.nodeId)
            ?.anchors.some((a) => a.id === p.anchorId)
        )
          throw new Error("Choose a port belonging to the selected card.");
      apply(next, edge, true);
    } catch (error) {
      required(panel.querySelector(".vc-edge-error")).textContent =
        error instanceof Error ? error.message : "Unable to apply arrow settings";
    }
  }
  function keydown(event: KeyboardEvent) {
    const target = event.target as Element;
    if (event.key === "Escape" && !panel.hidden) {
      cancel();
      selected = null;
      panel.hidden = true;
      handles();
      event.stopPropagation();
    }
    if ((event.key === "Enter" || event.key === " ") && target.matches(".vc-edge")) {
      event.preventDefault();
      choose(required(target.getAttribute("data-edge-id")));
      panel.querySelector<HTMLElement>("button")?.focus();
    }
  }
  function down(event: PointerEvent) {
    const target = event.target as Element,
      handle = target.closest<SVGElement>("[data-handle]"),
      edge = current();
    if (!handle || !edge || !options.editable) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      before: structuredClone(edge),
      type: required(handle.dataset.handle),
      index: Number(handle.dataset.index),
      points: structuredClone(
        required(routeEdges(options.canvas()).find((p) => p.edge.id === edge.id)).points,
      ),
    };
    if (drag.type === "label")
      drag.labelBase = required(
        routeEdges({
          ...options.canvas(),
          doc: {
            ...options.canvas().doc,
            edges: options
              .canvas()
              .doc.edges.map((e) =>
                e.id === edge.id
                  ? { ...e, label: { ...required(e.label), offset: { x: 0, y: 0 } } }
                  : e,
              ),
          },
        }).find((p) => p.edge.id === edge.id),
      ).labelPoint;
    container.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const point = options.toWorld(event.clientX, event.clientY),
      next = structuredClone(drag.before);
    if (drag.type === "source" || drag.type === "target") {
      const nodes = options
          .canvas()
          .nodes.map((n) => ({
            n,
            d: Math.hypot(
              Math.max(n.x - point.x, 0, point.x - n.x - n.w),
              Math.max(n.y - point.y, 0, point.y - n.y - n.h),
            ),
          }))
          .sort((a, b) => a.d - b.d),
        nearest = nodes[0];
      if (!nearest || nearest.d > 60) return;
      const n = nearest.n,
        sides = [
          { side: "left" as const, d: Math.abs(point.x - n.x) },
          { side: "right" as const, d: Math.abs(point.x - n.x - n.w) },
          { side: "top" as const, d: Math.abs(point.y - n.y) },
          { side: "bottom" as const, d: Math.abs(point.y - n.y - n.h) },
        ].sort((a, b) => a.d - b.d),
        side = required(sides[0]).side;
      next[drag.type] = {
        nodeId: n.id,
        side,
        offset: Math.max(
          0,
          Math.min(
            1,
            side === "top" || side === "bottom" ? (point.x - n.x) / n.w : (point.y - n.y) / n.h,
          ),
        ),
      };
    } else if (drag.type === "label" && next.label) {
      const base = required(drag.labelBase);
      next.label.offset = { x: point.x - base.x, y: point.y - base.y };
    } else if (drag.type === "waypoint") {
      required(next.route.waypoints)[drag.index] = point;
    } else if (drag.type === "segment") {
      const points = structuredClone(drag.points),
        a = required(points[drag.index]),
        b = required(points[drag.index + 1]);
      if (a.y === b.y) {
        a.y = point.y;
        b.y = point.y;
      } else {
        a.x = point.x;
        b.x = point.x;
      }
      next.route.waypoints = points.slice(1, -1);
    }
    apply(next, drag.before, false);
  }
  function up(event: PointerEvent) {
    if (!drag) return;
    event.stopPropagation();
    const before = drag.before;
    drag = null;
    const edge = current();
    if (edge && JSON.stringify(edge) !== JSON.stringify(before)) {
      const parsed = CanvasEdgeSchema.safeParse(edge);
      if (parsed.success) void options.commit?.(parsed.data, before);
      else apply(before, before, false);
    }
    refresh();
  }
  function cancel() {
    if (drag) {
      const before = drag.before;
      drag = null;
      apply(before, before, false);
      refresh();
    }
  }
  function change(event: Event) {
    const input = event.target as HTMLSelectElement;
    for (const type of ["source", "target"]) {
      const port = panel.querySelector<HTMLSelectElement>(`[name="${type}Port"]`),
        offset = panel.querySelector<HTMLInputElement>(`[name="${type}Offset"]`);
      if (!port || !offset) continue;
      if (input.name === `${type}Node`) {
        const node = options.canvas().nodes.find((n) => n.id === input.value);
        port.innerHTML =
          '<option value="auto">Automatic</option>' +
          ["top", "right", "bottom", "left"]
            .map((side) => `<option value="${side}">${side}</option>`)
            .join("") +
          (node?.anchors
            .map(
              (a) =>
                `<option value="anchor:${escapeHtml(a.id)}">Named: ${escapeHtml(a.id)}</option>`,
            )
            .join("") ?? "");
      }
      offset.disabled = port.value === "auto" || port.value.startsWith("anchor:");
    }
  }
  panel.addEventListener("change", change);
  window.addEventListener("blur", cancel);
  container.addEventListener("click", click);
  container.addEventListener("keydown", keydown, true);
  panel.addEventListener("submit", submit);
  container.addEventListener("pointerdown", down, true);
  container.addEventListener("pointermove", move, true);
  container.addEventListener("pointerup", up, true);
  container.addEventListener("pointercancel", cancel, true);
  return {
    refresh,
    destroy() {
      panel.removeEventListener("change", change);
      window.removeEventListener("blur", cancel);
      cancel();
      panel.remove();
      container.querySelector(".vc-edge-handles")?.remove();
      container.removeEventListener("click", click);
      container.removeEventListener("keydown", keydown, true);
      panel.removeEventListener("submit", submit);
      container.removeEventListener("pointerdown", down, true);
      container.removeEventListener("pointermove", move, true);
      container.removeEventListener("pointerup", up, true);
      container.removeEventListener("pointercancel", cancel, true);
    },
  };
}
