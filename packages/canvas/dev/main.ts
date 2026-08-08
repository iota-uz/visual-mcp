import "../src/theme.css";
import { layoutCanvas } from "../src/layout.js";
import { mountViewport, type ViewportController } from "../src/viewport.js";
import { fixtureDoc } from "./fixture.js";

declare global {
  interface Window {
    __vc?: ViewportController;
  }
}

const root = document.getElementById("app");
if (!root) throw new Error("dev viewer: missing #app");

const positioned = layoutCanvas(fixtureDoc);
const controller = mountViewport({
  container: root,
  canvas: positioned,
  onSelect: (id) => {
    console.log("[vc] selected:", id);
  },
});

window.__vc = controller;
