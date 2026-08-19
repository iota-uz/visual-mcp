import type { CanvasDoc } from "../src/types.js";
export const anchors = [
  { id: "left", side: "left" as const, offset: 0.5 },
  { id: "right", side: "right" as const, offset: 0.5 },
];
export function fixture(): CanvasDoc {
  return {
    version: 2,
    title: "fixture",
    world: { width: 1000, height: 600 },
    lanes: [{ id: "lane", label: "Lane", role: "primary", rect: { x: 0, y: 0, w: 1000, h: 600 } }],
    stages: [
      { id: "s1", index: 0, label: "One", rect: { x: 0, y: 0, w: 500, h: 600 } },
      { id: "s2", index: 1, label: "Two", rect: { x: 500, y: 0, w: 500, h: 600 } },
    ],
    labels: [],
    nodes: [
      {
        id: "a",
        kind: "native",
        shape: "note",
        laneId: "lane",
        stageId: "s1",
        rect: { x: 100, y: 100, w: 120, h: 80 },
        caption: { title: "A" },
        anchors,
      },
      {
        id: "b",
        kind: "iframe",
        laneId: "lane",
        stageId: "s2",
        rect: { x: 700, y: 100, w: 200, h: 300 },
        caption: { title: "B" },
        anchors,
        source: { entrypoint: "/src/screens/runtime.html", route: "#/victim/start" },
        viewport: { width: 284, height: 642 },
        frame: { kind: "phone", time: "09:42" },
        sandbox: ["allow-scripts", "allow-forms"],
        permissions: [],
        activation: "double-click",
      },
    ],
    edges: [
      {
        id: "ab",
        source: { nodeId: "a", anchorId: "right" },
        target: { nodeId: "b", anchorId: "left" },
        kind: "main",
        route: { type: "orthogonal" },
        label: { text: "next" },
      },
    ],
  };
}
