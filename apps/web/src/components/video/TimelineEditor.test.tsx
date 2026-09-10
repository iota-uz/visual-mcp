import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { expect, test, vi } from "vitest";
import { Timeline, type TimelineDocument } from "../../../../../packages/video/src/contracts";
import { calculatePointerEdit, formatTimelineTimecode, TimelineEditor } from "./TimelineEditor";

const initial = Timeline.parse({
  fps: { numerator: 30, denominator: 1 },
  durationFrames: 300,
  trackOrder: ["captions"],
  tracksById: {
    captions: {
      kind: "caption",
      clipOrder: ["first"],
      clipsById: {
        first: { startFrame: 30, durationFrames: 90, source: { kind: "text", text: "Hello" } },
      },
    },
  },
});

function ControlledTimeline({ disabled = false }: { disabled?: boolean }) {
  const [document, setDocument] = React.useState<TimelineDocument>(initial);
  return (
    <TimelineEditor
      document={document}
      onChange={(next) => setDocument(Timeline.parse(next))}
      disabled={disabled}
    />
  );
}

test("uses rational SMPTE timecode including drop-frame notation", () => {
  expect(formatTimelineTimecode(30, 30, 1)).toBe("00:00:01:00");
  expect(formatTimelineTimecode(1800, 30000, 1001)).toBe("00:01:00;02");
  expect(formatTimelineTimecode(17982, 30000, 1001)).toBe("00:10:00;00");
});

test("calculates bounded pointer moves and snaps clip edges", () => {
  expect(
    calculatePointerEdit({
      mode: "move",
      startFrame: 30,
      durationFrames: 90,
      deltaPixels: 28,
      laneWidth: 300,
      timelineFrames: 300,
      snapping: true,
      snapTargets: [0, 60, 210, 300],
      snapThresholdPixels: 4,
    }),
  ).toEqual({ startFrame: 60, durationFrames: 90 });
  expect(
    calculatePointerEdit({
      mode: "move",
      startFrame: 30,
      durationFrames: 90,
      deltaPixels: -500,
      laneWidth: 300,
      timelineFrames: 300,
      snapping: false,
      snapTargets: [],
    }),
  ).toEqual({ startFrame: 0, durationFrames: 90 });
});

test("calculates frame-accurate pointer trims with bounds and snapping", () => {
  expect(
    calculatePointerEdit({
      mode: "trim-start",
      startFrame: 30,
      durationFrames: 90,
      deltaPixels: 28,
      laneWidth: 300,
      timelineFrames: 300,
      snapping: true,
      snapTargets: [60],
      snapThresholdPixels: 4,
    }),
  ).toEqual({ startFrame: 60, durationFrames: 60 });
  expect(
    calculatePointerEdit({
      mode: "trim-end",
      startFrame: 30,
      durationFrames: 90,
      deltaPixels: 500,
      laneWidth: 300,
      timelineFrames: 300,
      snapping: false,
      snapTargets: [],
    }),
  ).toEqual({ startFrame: 30, durationFrames: 270 });
});

test("scrubs directly, splits a selected clip, then undoes and redoes", async () => {
  const user = userEvent.setup();
  render(<ControlledTimeline />);
  fireEvent.change(screen.getByRole("slider", { name: "Timeline ruler" }), {
    target: { value: "60" },
  });
  await user.click(screen.getByRole("button", { name: "Split at playhead" }));
  expect(screen.getAllByRole("button", { name: /Captions clip:/ })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Undo timeline edit" }));
  expect(screen.getAllByRole("button", { name: /Captions clip:/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Redo timeline edit" }));
  expect(screen.getAllByRole("button", { name: /Captions clip:/ })).toHaveLength(2);
});

test("supports keyboard nudge while a locked track prevents edits", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <TimelineEditor document={initial} onChange={onChange} disabled={false} />,
  );
  const clip = screen.getByRole("button", { name: "Captions clip: Hello" });
  await user.click(clip);
  fireEvent.keyDown(clip, { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      tracksById: expect.objectContaining({
        captions: expect.objectContaining({
          clipsById: expect.objectContaining({
            first: expect.objectContaining({ startFrame: 31 }),
          }),
        }),
      }),
    }),
  );
  rerender(<TimelineEditor document={initial} onChange={onChange} disabled={false} />);
  await user.click(screen.getByRole("button", { name: "Lock Captions track" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Captions clip: Hello" }), {
    key: "ArrowRight",
  });
  expect(onChange).toHaveBeenCalledTimes(1);
});

test("trims the selected clip one frame from the keyboard", async () => {
  render(<ControlledTimeline />);
  const clip = screen.getByRole("button", { name: "Captions clip: Hello" });
  clip.focus();
  fireEvent.keyDown(clip, { key: "ArrowRight", shiftKey: true });
  expect(screen.getByRole("spinbutton", { name: "Duration" })).toHaveValue(3.033);
});

test("disabled mode cannot mutate the timeline", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<TimelineEditor document={initial} onChange={onChange} disabled />);
  expect(screen.getByRole("button", { name: "Add caption" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Captions clip: Hello" }), {
    key: "Delete",
  });
  expect(onChange).not.toHaveBeenCalled();
});
