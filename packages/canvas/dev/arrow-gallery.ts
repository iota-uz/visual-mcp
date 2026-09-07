import { required } from "../src/routing/invariant.js";
import "../src/theme.css";
import { layoutCanvas } from "../src/layout.js";
import { type CanvasDoc, CanvasDocSchema, type CanvasEdge, type CanvasNode } from "../src/types.js";
import { mountViewport, type ViewportController } from "../src/viewport.js";

const anchors = ["top", "right", "bottom", "left"].map((side) => ({ id: side, side, offset: 0.5 }));
const node = (id: string, x: number, y: number, w = 100, h = 100) => ({
  id,
  kind: "native",
  shape: "note",
  rect: { x, y, w, h },
  caption: { title: id },
  anchors,
});
const edge = (id: string, a: string, b: string, source = "right", target = "left") => ({
  id,
  source: { nodeId: a, side: source },
  target: { nodeId: b, side: target },
  kind: "main",
  route: { type: "orthogonal" },
});
const cases = {
  public: {
    nodes: [
      node("Quarantine", 20, 100, 700, 512),
      node("Model catalog", 760, 100, 700, 512),
      node("Risk assessment", 1500, 100, 700, 512),
    ],
    edges: [
      { ...edge("accepted", "Quarantine", "Model catalog"), label: { text: "решение принято" } },
      {
        ...edge("features", "Model catalog", "Risk assessment"),
        label: { text: "признаки на дату" },
      },
    ],
  },
  maze: {
    nodes: [
      node("Start", 20, 300),
      node("One", 210, 180, 100, 280),
      node("Two", 400, 400, 100, 280),
      node("Three", 590, 180, 100, 280),
      node("Finish", 820, 480),
    ],
    edges: [{ ...edge("route", "Start", "Finish"), label: { text: "Avoid every card" } }],
  },
  parallel: {
    nodes: [node("Start", 100, 250), node("Finish", 650, 250)],
    edges: [
      { ...edge("forward", "Start", "Finish"), label: { text: "Request" } },
      { ...edge("reverse", "Finish", "Start", "left", "right"), label: { text: "Response" } },
      { ...edge("loop", "Finish", "Finish", "right", "right"), label: { text: "Retry" } },
    ],
  },
};
let controller: ViewportController;
const app = required(document.querySelector<HTMLElement>("#app")),
  select = required(document.querySelector("select"));
function show() {
  controller?.dispose();
  const content = cases[select.value as keyof typeof cases];
  const doc: CanvasDoc = CanvasDocSchema.parse({
    version: 2,
    title: select.value,
    world: { width: 2400, height: 1000 },
    lanes: [],
    stages: [],
    groups: [],
    labels: [],
    ...content,
  });
  const redraw = () => controller.updateCanvas(layoutCanvas(doc));
  controller = mountViewport({
    container: app,
    canvas: layoutCanvas(doc),
    editable: true,
    fitOnResize: true,
    onEdgeChange: (next: CanvasEdge) => {
      doc.edges = doc.edges.map((e) => (e.id === next.id ? next : e));
      redraw();
    },
    onGeometryChange: (id, rect) => {
      doc.nodes = doc.nodes.map((n: CanvasNode) => (n.id === id ? { ...n, rect } : n));
      redraw();
    },
  });
}
select.addEventListener("change", show);
show();
