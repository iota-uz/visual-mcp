import type { Template } from "../types.js";

const exampleCode = `// Optional: reuse an existing library asset without uploading it again.
// const { assets } = asset_list({ scope: "workspace", workspace: "demo", query: "brand" })

canvas_save({
  ref: "demo/interactive-flow",
  kind: "canvas",
  doc: {
    version: 2,
    title: "Phone to web handoff",
    world: { width: 1280, height: 720 },
    lanes: [
      { id: "app", label: "Mobile app", role: "primary", rect: { x: 0, y: 0, w: 1280, h: 350 } },
      { id: "web", label: "Browser", role: "secondary", rect: { x: 0, y: 360, w: 1280, h: 350 } }
    ],
    stages: [{ id: "handoff", index: 0, label: "Handoff", rect: { x: 0, y: 0, w: 1280, h: 720 } }],
    labels: [],
    nodes: [
      { id: "phone", kind: "iframe", laneId: "app", stageId: "handoff", rect: { x: 160, y: 50, w: 260, h: 641 }, caption: { title: "Invite" }, anchors: [{ id: "out", side: "right", offset: 0.5 }], source: { entrypoint: "/src/screens/runtime.html", route: "#/phone/invite" }, viewport: { width: 284, height: 642 }, frame: { kind: "phone", time: "09:42" }, sandbox: ["allow-scripts", "allow-forms"], permissions: [], activation: "double-click" },
      { id: "browser", kind: "iframe", laneId: "web", stageId: "handoff", rect: { x: 650, y: 390, w: 520, h: 280 }, caption: { title: "Web session" }, anchors: [{ id: "in", side: "left", offset: 0.5 }], source: { entrypoint: "/src/screens/runtime.html", route: "#/web/start" }, viewport: { width: 1280, height: 800 }, frame: { kind: "browser" }, sandbox: ["allow-scripts", "allow-forms"], permissions: [], activation: "double-click" }
    ],
    groups: [{ id: "handoff-flow", label: "Handoff flow", nodeIds: ["phone", "browser"] }],
    edges: [{ id: "handoff", source: { nodeId: "phone", anchorId: "out" }, target: { nodeId: "browser", anchorId: "in" }, kind: "main", route: { type: "orthogonal" }, label: { text: "QR" } }]
  },
  files: [
    { path: "/src/screens/runtime.html", text: "<!doctype html><button>Interactive screen</button><script>document.querySelector('button').onclick=()=>alert('works')</script>" }
    // { path: "/assets/logo.svg", asset_ref: assets[0].asset_ref }
  ],
  renders: [{ target: { type: "canvas" }, format: "png" }]
})`;

export const iframeServiceFlowTemplate: Template = {
  id: "iframe-service-flow",
  name: "Iframe service flow",
  kind: "canvas",
  description:
    "Minimal CanvasDoc v2 flow with phone/browser iframe nodes, external anchors, atomic source upload, interaction mode and canvas export.",
  expectedInputs: {
    screens: "HTML entrypoints under /src/screens",
    routes: "local hash routes",
    export: "png or pdf canvas target",
  },
  exampleCode,
};
