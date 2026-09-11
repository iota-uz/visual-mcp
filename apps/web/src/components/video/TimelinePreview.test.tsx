import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TimelineDocument } from "../../../../../packages/video/src/contracts";
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
  resolve.mockReset();
  resolve.mockResolvedValue({ url: "/frame.png", mimeType: "image/png", name: "Keyframe" });
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

test("lets editors resize the draft monitor with controls and the keyboard", () => {
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

  const separator = screen.getByRole("separator", { name: "Resize draft monitor" });
  const initialHeight = Number(separator.getAttribute("aria-valuenow"));
  fireEvent.click(screen.getByRole("button", { name: "Enlarge preview" }));
  expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(initialHeight);
  fireEvent.keyDown(separator, { key: "ArrowDown" });
  expect(Number(separator.getAttribute("aria-valuenow"))).toBe(initialHeight + 40);
  fireEvent.keyDown(separator, { key: "Home" });
  expect(separator).toHaveAttribute("aria-valuenow", "280");
});
