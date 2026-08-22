import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Presentation chrome hides itself so the prototype is the only thing on
 * screen, and any sign of the presenter brings it back.
 *
 * The window is longer for a finger. A mouse keeps re-summoning the controls
 * for free — every stray movement is a `mousemove` — while a touch device
 * emits nothing at all between taps, so the same 2.6s reads as "gone" rather
 * than "resting".
 */
export const CONTROLS_HIDE_MS = 2600;
export const CONTROLS_HIDE_COARSE_MS = 5000;

export interface AutoHideControls {
  visible: boolean;
  /**
   * Pointer, key or focus — whatever says the presenter is still here. Pass
   * a `PointerEvent`'s `pointerType` when there is one; the rest get the
   * mouse-length window.
   */
  show: (pointerType?: string) => void;
}

export function useAutoHideControls(): AutoHideControls {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<number | null>(null);
  /*
   * What is driving this session, remembered rather than read per call: a
   * tap is followed by a compatibility `mousemove`, and taking that at face
   * value would hand a finger the mouse-length window a moment after it
   * earned the long one.
   */
  const coarseRef = useRef(false);

  const show = useCallback((pointerType?: string) => {
    setVisible(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (pointerType) coarseRef.current = pointerType === "touch" || pointerType === "pen";
    timerRef.current = window.setTimeout(
      () => setVisible(false),
      coarseRef.current ? CONTROLS_HIDE_COARSE_MS : CONTROLS_HIDE_MS,
    );
  }, []);

  useEffect(() => {
    show();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [show]);

  return { visible, show };
}
