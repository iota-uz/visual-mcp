import { render, screen } from "@testing-library/react";
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
