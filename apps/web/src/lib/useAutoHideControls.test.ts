import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CONTROLS_HIDE_COARSE_MS,
  CONTROLS_HIDE_MS,
  useAutoHideControls,
} from "./useAutoHideControls";

describe("useAutoHideControls", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("the chrome starts visible and steps out of the way", () => {
    const { result } = renderHook(() => useAutoHideControls());
    expect(result.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_MS));
    expect(result.current.visible).toBe(false);
  });

  test("any sign of the presenter brings it back", () => {
    const { result } = renderHook(() => useAutoHideControls());
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_MS));
    act(() => result.current.show());
    expect(result.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_MS - 1));
    expect(result.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.visible).toBe(false);
  });

  // A finger gets a longer window: there is no hover to keep refreshing it,
  // so the next tap is the only thing that can summon the controls again.
  test("a touch is given longer than a mouse", () => {
    const { result } = renderHook(() => useAutoHideControls());
    act(() => result.current.show("touch"));
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_MS));
    expect(result.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_COARSE_MS - CONTROLS_HIDE_MS));
    expect(result.current.visible).toBe(false);
  });

  test("a mouse pointer keeps the short window", () => {
    const { result } = renderHook(() => useAutoHideControls());
    act(() => result.current.show("mouse"));
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_MS));
    expect(result.current.visible).toBe(false);
  });

  // A tap is followed by a compatibility `mousemove`, which arrives with no
  // pointer type at all — it must not shorten the window the tap just set.
  test("the synthetic mousemove after a tap keeps the touch window", () => {
    const { result } = renderHook(() => useAutoHideControls());
    act(() => result.current.show("touch"));
    act(() => result.current.show());
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_MS));
    expect(result.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(CONTROLS_HIDE_COARSE_MS - CONTROLS_HIDE_MS));
    expect(result.current.visible).toBe(false);
  });

  test("unmounting leaves no timer to fire", () => {
    const clear = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderHook(() => useAutoHideControls());
    unmount();
    expect(clear).toHaveBeenCalled();
    // Nothing pending means nothing can call setState on a dead hook.
    expect(vi.getTimerCount()).toBe(0);
    clear.mockRestore();
  });
});
