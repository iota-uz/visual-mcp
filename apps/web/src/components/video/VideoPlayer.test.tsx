import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { VideoPlayer } from "./VideoPlayer";

test("an asynchronously refreshed signed URL remounts the media and restores position", () => {
  const asset = {
    jobId: "job",
    versionId: "v",
    language: "ru" as const,
    sha256: "hash",
    videoUrl: "https://example.test/expired",
    width: 360,
    height: 640,
    durationMs: 2048,
    frameCount: 60,
    videoDurationMs: 2000,
    containerDurationMs: 2048,
    fps: { numerator: 30, denominator: 1 },
    partial: false,
  };
  const view = render(<VideoPlayer asset={asset} onLoaded={() => {}} onTime={() => {}} />);
  const old = screen.getByLabelText("Video preview") as HTMLVideoElement;
  fireEvent.timeUpdate(old, { target: { currentTime: 1.2 } });
  view.rerender(
    <VideoPlayer
      asset={{ ...asset, videoUrl: "https://example.test/refreshed" }}
      onLoaded={() => {}}
      onTime={() => {}}
    />,
  );
  const fresh = screen.getByLabelText("Video preview") as HTMLVideoElement;
  expect(fresh).not.toBe(old);
  expect(fresh.querySelector("source")?.src).toBe("https://example.test/refreshed");
  fireEvent.loadedMetadata(fresh);
  expect(fresh.currentTime).toBe(1.2);
});
test("AAC container padding cannot invent frames or out-of-video anchors", () => {
  const onTime = vi.fn();
  render(
    <VideoPlayer
      asset={{
        jobId: "job",
        versionId: "version",
        language: "ru",
        sha256: "a",
        videoUrl: "https://example.test/video",
        width: 1080,
        height: 1920,
        durationMs: 2048,
        containerDurationMs: 2048,
        videoDurationMs: 2000,
        frameCount: 60,
        fps: { numerator: 30, denominator: 1 },
        partial: false,
      }}
      onLoaded={() => {}}
      onTime={onTime}
    />,
  );
  const video = screen.getByLabelText("Video preview");
  fireEvent.timeUpdate(video, { target: { currentTime: 2.048 } });
  expect(screen.getByText(/Frame 59 of 59/)).toBeInTheDocument();
  expect(onTime).toHaveBeenLastCalledWith(1967);
  expect(screen.getByText(/video 2.000 s \(container 2.048 s\)/)).toBeInTheDocument();
});
