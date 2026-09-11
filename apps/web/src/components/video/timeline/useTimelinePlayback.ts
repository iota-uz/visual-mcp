import { useEffect, useState } from "react";

/** Editor-only transport state. It never mutates the persisted timeline. */
export function useTimelinePlayback(durationFrames: number, fps: number) {
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlayhead((value) => Math.min(value, durationFrames));
  }, [durationFrames]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () =>
        setPlayhead((value) => {
          if (value >= durationFrames) {
            setPlaying(false);
            return durationFrames;
          }
          return Math.min(durationFrames, value + 1);
        }),
      Math.max(8, 1000 / fps),
    );
    return () => window.clearInterval(timer);
  }, [durationFrames, fps, playing]);

  function togglePlayback() {
    if (!playing && playhead >= durationFrames) setPlayhead(0);
    setPlaying((value) => !value);
  }

  return { playhead, setPlayhead, playing, setPlaying, togglePlayback };
}
