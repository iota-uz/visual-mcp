import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TimelineDocument } from "../../../../../packages/video/src/contracts";
import { builtInCharacterPacks } from "../../../../../packages/video/src/registry";
import { TimelinePreview } from "./TimelinePreview";

const resolve = vi.fn();
vi.mock("convex/react", () => ({ useAction: () => resolve }));

const timeline: TimelineDocument = {
  fps: { numerator: 30, denominator: 1 },
  durationFrames: 60,
  trackOrder: ["visual", "captions"],
  tracksById: {
    visual: {
      kind: "visual",
      clipOrder: ["frame"],
      clipsById: {
        frame: {
          startFrame: 0,
          durationFrames: 30,
          source: {
            kind: "asset",
            asset: { assetId: "asset", revisionId: "revision" },
          },
        },
      },
    },
    captions: {
      kind: "caption",
      clipOrder: ["caption"],
      clipsById: {
        caption: {
          startFrame: 0,
          durationFrames: 30,
          source: { kind: "text", text: "A synchronized caption" },
        },
      },
    },
  },
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("PointerEvent", MouseEvent);
  resolve.mockReset();
  resolve.mockResolvedValue({ url: "/frame.png", mimeType: "image/png", name: "Keyframe" });
});

test("short landscape keeps a smaller default monitor so transport can share the viewport", () => {
  vi.stubGlobal("innerHeight", 768);
  vi.stubGlobal("innerWidth", 1024);
  const { container } = render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={timeline}
      frame={0}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );
  expect(container.querySelector(".video-program-stage-shell")).toHaveStyle({
    width: "min(100%, 146.25px)",
  });
});

test("desktop keeps the larger monitor default", () => {
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("innerWidth", 1440);
  const { container } = render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={timeline}
      frame={0}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );
  expect(container.querySelector(".video-program-stage-shell")).toHaveStyle({
    width: "min(100%, 293.625px)",
  });
});

test("resolves pinned media and composes the active caption at the playhead", async () => {
  render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={timeline}
      frame={0}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );

  expect(await screen.findByAltText("Draft frame: Keyframe")).toHaveAttribute("src", "/frame.png");
  expect(screen.getByText("A synchronized caption")).toBeInTheDocument();
  expect(resolve).toHaveBeenCalledWith({
    workspaceId: "workspace",
    asset: { assetId: "asset", revisionId: "revision" },
  });
});

test("hidden visual tracks are named as the cause of an empty stage", async () => {
  render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={timeline}
      frame={0}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set(["visual"])}
      mutedTracks={new Set()}
    />,
  );
  expect(await screen.findByText("Visual tracks are hidden in the editor")).toBeInTheDocument();
  expect(screen.queryByText("No visual at this frame")).not.toBeInTheDocument();
});

test("a gap between visual clips keeps the per-frame message", () => {
  render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={timeline}
      frame={45}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );
  expect(screen.getByText("No visual at this frame")).toBeInTheDocument();
});

test("a timeline without visual clips says so instead of blaming the frame", () => {
  const captionsTrack = timeline.tracksById.captions;
  if (!captionsTrack) throw new Error("Expected the captions fixture track");
  const captionsOnly: TimelineDocument = {
    ...timeline,
    trackOrder: ["captions"],
    tracksById: { captions: captionsTrack },
  };
  render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={captionsOnly}
      frame={0}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );
  expect(screen.getByText("No visual clips on the timeline yet")).toBeInTheDocument();
});

test("renders pinned images and authored layers inside a scene graph component", async () => {
  const sceneGraph: TimelineDocument = {
    fps: { numerator: 30, denominator: 1 },
    durationFrames: 60,
    trackOrder: ["visual"],
    tracksById: {
      visual: {
        kind: "visual",
        clipOrder: ["scene"],
        clipsById: {
          scene: {
            startFrame: 0,
            durationFrames: 60,
            source: {
              kind: "component",
              component: { resourceId: "video/component/scene-graph", revisionId: "1" },
              props: {
                background: "#ffffff",
                nodeOrder: ["title", "car", "shield"],
                nodesById: {
                  title: {
                    kind: "text",
                    x: 0.1,
                    y: 0.1,
                    width: 0.8,
                    height: 0.1,
                    opacity: 1,
                    rotation: 0,
                    scale: 1,
                    animations: [
                      {
                        property: "opacity",
                        keyframes: [
                          { frame: 0, value: 0, easing: "linear" },
                          { frame: 30, value: 1, easing: "linear" },
                        ],
                      },
                    ],
                    text: "ОСАГО защищает ответственность",
                    fontSize: 64,
                    fontFamily: "sans-serif",
                    color: "#0f172a",
                    textAlign: "left",
                    fontWeight: 700,
                  },
                  car: {
                    kind: "image",
                    x: 0.1,
                    y: 0.3,
                    width: 0.8,
                    height: 0.4,
                    opacity: 1,
                    rotation: 0,
                    scale: 1,
                    animations: [],
                    asset: { assetId: "asset", revisionId: "revision" },
                    fit: "contain",
                  },
                  shield: {
                    kind: "shape",
                    x: 0.2,
                    y: 0.25,
                    width: 0.6,
                    height: 0.5,
                    opacity: 0.5,
                    rotation: 0,
                    scale: 1,
                    animations: [],
                    shape: "ellipse",
                    fill: "#dbeafe",
                    borderColor: "#2563eb",
                    borderWidth: 4,
                    radius: 0,
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={sceneGraph}
      frame={15}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );

  expect(await screen.findByAltText("Draft frame: Keyframe")).toHaveAttribute("src", "/frame.png");
  expect(screen.getByText("ОСАГО защищает ответственность")).toHaveStyle({ opacity: "0.5" });
  expect(screen.queryByText("Generated graphic")).not.toBeInTheDocument();
  expect(resolve).toHaveBeenCalledTimes(1);
});

test("renders native character scenes at the current timeline frame", () => {
  const characterTimeline: TimelineDocument = {
    fps: { numerator: 30, denominator: 1 },
    durationFrames: 60,
    trackOrder: ["visual"],
    tracksById: {
      visual: {
        kind: "visual",
        clipOrder: ["characters"],
        clipsById: {
          characters: {
            startFrame: 0,
            durationFrames: 60,
            source: {
              kind: "component",
              component: { resourceId: "video/component/character-scene", revisionId: "4" },
              props: {
                stage: { aspect: "9:16", width: 1080, height: 1920 },
                timebase: { numerator: 30, denominator: 1 },
                seed: 42,
                staging: { layout: "reaction-closeup", focalActorId: "mascot" },
                camera: {
                  movement: "locked",
                  startFrame: 0,
                  durationFrames: 60,
                  holdFrames: 0,
                  intensity: 0.5,
                },
                cameraSequence: [],
                effects: [],
                environment: {
                  background: "#170f0a",
                  horizonY: 0.65,
                  ground: "#2b1811",
                  accent: "#ffb52e",
                  layers: [],
                },
                characterPacksById: {
                  "farq-official": builtInCharacterPacks["farq-official"]!,
                },
                actorOrder: ["mascot"],
                actorsById: {
                  mascot: {
                    characterPackId: "farq-official",
                    x: 0.5,
                    y: 0.65,
                    scale: 1,
                    facing: "right",
                    initialEmotion: "happy",
                  },
                },
                propOrder: [],
                propsById: {},
                actionOrder: ["enter"],
                actionsById: {
                  enter: {
                    type: "enter",
                    actorId: "mascot",
                    startFrame: 0,
                    durationFrames: 30,
                    priority: 0,
                    weight: 1,
                    blendInFrames: 6,
                    blendOutFrames: 6,
                    from: "left",
                  },
                },
                overlayOrder: [],
                overlaysById: {},
                caption: "Official mascot preview",
              },
            },
          },
        },
      },
    },
  };

  render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={characterTimeline}
      frame={20}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );

  expect(screen.getByLabelText("Official farq.uz mascot")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Official mascot preview" })).toBeInTheDocument();
  expect(screen.queryByText("Generated graphic")).not.toBeInTheDocument();
});

test.each([
  ["bottom right", 150, 180],
  ["bottom left", 50, 180],
  ["top right", 150, 20],
  ["top left", 50, 20],
] as const)("resizes from the %s corner with bounds and keyboard support", (name, x, y) => {
  render(
    <TimelinePreview
      workspaceId={"workspace" as Id<"workspaces">}
      document={timeline}
      frame={0}
      playing={false}
      format={{ width: 1080, height: 1920 }}
      hiddenTracks={new Set()}
      mutedTracks={new Set()}
    />,
  );

  const stage = screen.getByRole("img", { name: "Timeline draft preview" });
  const shell = stage.parentElement;
  if (!shell) throw new Error("Expected a preview stage shell");
  const initialWidth = shell.style.width;
  const corner = screen.getByRole("button", { name: `Resize preview from ${name}` });
  fireEvent.pointerDown(corner, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  expect(shell).toHaveAttribute("data-resizing", "true");
  fireEvent.pointerMove(corner, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(corner, { pointerId: 1, clientX: x, clientY: y });
  expect(shell).toHaveAttribute("data-resizing", "false");
  expect(shell.style.width).not.toBe(initialWidth);
  fireEvent.keyDown(corner, { key: "Home" });
  expect(shell.style.width).toContain("157.5px");
  expect(localStorage.getItem("visual-canvas:video-preview-height")).toBe("280");
  fireEvent.keyDown(corner, { key: "ArrowDown" });
  expect(shell.style.width).toContain("157.5px");
  fireEvent.keyDown(corner, { key: "End" });
  const maxWidth = shell.style.width;
  fireEvent.keyDown(corner, { key: "ArrowUp" });
  expect(shell.style.width).toBe(maxWidth);
  fireEvent.pointerDown(corner, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerCancel(corner);
  fireEvent.pointerMove(corner, { pointerId: 1, clientX: 0, clientY: 0 });
  expect(shell.style.width).toBe(maxWidth);
  expect(shell).toHaveAttribute("data-resizing", "false");
});
