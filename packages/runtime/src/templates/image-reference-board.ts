import type { Template } from "../types.js";

const exampleCode = `canvas_save({
  ref: "demo/reference-board",
  kind: "canvas",
  doc: {
    version: 2,
    title: "Reference board",
    world: { width: 1100, height: 620 },
    lanes: [{ id: "gallery", label: "References", role: "primary", rect: { x: 0, y: 0, w: 1100, h: 620 } }],
    stages: [],
    labels: [],
    nodes: [
      { id: "reference-a", kind: "image", laneId: "gallery", rect: { x: 60, y: 80, w: 440, h: 420 }, caption: { title: "Checkout" }, anchors: [{ id: "right", side: "right", offset: 0.5 }], source: { path: "/assets/checkout.webp" }, fit: "cover", focalPosition: { x: 0.5, y: 0.25 }, alt: "Checkout reference screen" },
      { id: "reference-b", kind: "image", laneId: "gallery", rect: { x: 600, y: 80, w: 440, h: 420 }, caption: { title: "Confirmation" }, anchors: [{ id: "left", side: "left", offset: 0.5 }], source: { path: "/assets/confirmation.webp" }, fit: "contain", focalPosition: { x: 0.5, y: 0.5 }, alt: "Confirmation reference screen" }
    ],
    edges: []
  },
  files: [
    { path: "/assets/checkout.webp", upload_id: "<storageId from canvas_upload_url>" },
    { path: "/assets/confirmation.webp", upload_id: "<storageId from canvas_upload_url>" }
  ]
})`;

export const imageReferenceBoardTemplate: Template = {
  id: "image-reference-board",
  name: "Image reference board",
  kind: "canvas",
  description:
    "CanvasDoc v2 static screenshot gallery using native image nodes without iframe wrappers or readiness waits.",
  expectedInputs: {
    images: "canvas files or pinned Asset Library revisions under /assets",
    layout: "explicit image rects, fit and focalPosition",
    accessibility: "meaningful alt text",
  },
  exampleCode,
};
