import { useEffect, useRef } from "react";
import { type HistoryControls, handleHistoryKey } from "./useDocumentHistory";
import type { StudioMode } from "./VideoDraftStudio";

const MODE_ORDER: StudioMode[] = ["story", "shots", "timeline", "review"];
const MODE_KEYS = ["1", "2", "3", "4"];

/*
 * Numeric workspace shortcuts must never steal keystrokes from an
 * interactive control: typing "2" in narration, stepping a number field,
 * or Space/Enter-ing through buttons and sliders has to keep working.
 * Anything focusable that acts — plus links and disclosure summaries —
 * opts out; bare canvas chrome (body, sections, divs) keeps the shortcut.
 */
export function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // isContentEditable covers live editing hosts in browsers; the attribute
  // selectors cover jsdom, which does not implement isContentEditable.
  // [contenteditable="false"] is deliberately excluded: it is not editable.
  if (target.isContentEditable) return true;
  return (
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        "a",
        "summary",
        '[contenteditable=""]',
        '[contenteditable="true"]',
        '[role="button"]',
        '[role="option"]',
        '[role="menuitem"]',
        '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]',
        '[role="slider"]',
        '[role="switch"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="tab"]',
      ].join(","),
    ) !== null
  );
}

export function useStudioShortcuts({
  mode,
  onMode,
  saveScript,
  saveTimeline,
  history,
}: {
  mode: StudioMode;
  onMode: (mode: StudioMode) => void;
  saveScript: () => void;
  saveTimeline: () => void;
  history?: HistoryControls;
}) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onModeRef = useRef(onMode);
  onModeRef.current = onMode;
  const saveScriptRef = useRef(saveScript);
  saveScriptRef.current = saveScript;
  const saveTimelineRef = useRef(saveTimeline);
  saveTimelineRef.current = saveTimeline;
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const nativeField = target?.closest(
        'input,textarea,select,[contenteditable=""],[contenteditable="true"]',
      );
      if (
        modeRef.current !== "review" &&
        historyRef.current &&
        (!nativeField || target?.closest("[data-document-history]")) &&
        !target?.closest('[role="dialog"],dialog,[data-native-history]') &&
        handleHistoryKey(event, historyRef.current)
      )
        return;
      // Save works from anywhere, including inside a field: it only ever
      // flushes pending edits, and useRevisionEditor.save() no-ops when
      // clean, already saving, or conflicted — so key repeat and double
      // presses cannot queue duplicate concurrent writes.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveScriptRef.current();
        saveTimelineRef.current();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInteractiveShortcutTarget(event.target)) return;
      const index = MODE_KEYS.indexOf(event.key);
      if (index >= 0 && MODE_ORDER[index] && MODE_ORDER[index] !== modeRef.current)
        onModeRef.current(MODE_ORDER[index] as StudioMode);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
