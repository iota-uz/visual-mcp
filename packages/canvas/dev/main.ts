import "../src/theme.css";
import { layoutCanvas } from "../src/layout.js";
import { mountViewport, type ViewportController } from "../src/viewport.js";
import { CanvasDocSchema } from "../src/types.js";

declare global {
  interface Window {
    __vc?: ViewportController;
  }
}

const root = document.getElementById("app");
if (!root) throw new Error("dev viewer: missing #app");

const fixtureDoc = CanvasDocSchema.parse(
  await fetch("http://127.0.0.1:4180/canvas.json").then((response) => response.json()),
);
const positioned = layoutCanvas(fixtureDoc);
const controller = mountViewport({
  container: root,
  canvas: positioned,
  editable: true,
  resolveIframeUrl: (node) =>
    `http://127.0.0.1:4180${node.source.entrypoint}${node.source.route ?? ""}`,
  onSelect: (id) => {
    console.log("[vc] selected:", id);
  },
});

window.__vc = controller;

const focusNode = new URLSearchParams(location.search).get("focus");
if (focusNode) controller.selectNode(focusNode, true);
