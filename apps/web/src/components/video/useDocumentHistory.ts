import { useEffect, useRef, useState } from "react";

type Editor<T> = {
  document: T;
  edit: (document: T) => void;
  locked: boolean;
  historyEpoch: number;
  canEdit?: () => boolean;
};
export type HistoryControls = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

/** Ordered document commands, shared by every mode in one draft. Saves are not commands. */
export function useDocumentHistory<T extends Record<string, unknown>>(
  editors: { [K in keyof T]: Editor<T[K]> },
  disabled = false,
) {
  type Entry = { lane: keyof T; before: T[keyof T]; after: T[keyof T] };
  const entries = useRef<{ past: Entry[]; future: Entry[] }>({ past: [], future: [] });
  const group = useRef<{ target: Element; lane: keyof T; time: number } | null>(null);
  const latest = useRef(editors);
  latest.current = editors;
  const epoch = Object.entries(editors)
    .map(([key, editor]) => `${key}:${editor.historyEpoch}`)
    .join("|");
  const previousEpoch = useRef(epoch);
  // Invalidate synchronously: a remote snapshot must never be undoable as a local edit.
  if (previousEpoch.current !== epoch) {
    entries.current = { past: [], future: [] };
    group.current = null;
    previousEpoch.current = epoch;
  }
  const [, refresh] = useState(0);
  const locked = disabled || Object.values(editors).some((editor) => editor.locked);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    const endGroup = () => {
      group.current = null;
    };
    document.addEventListener("focusin", endGroup);
    document.addEventListener("pointerdown", endGroup, true);
    return () => {
      document.removeEventListener("focusin", endGroup);
      document.removeEventListener("pointerdown", endGroup, true);
    };
  }, []);

  function edit<K extends keyof T>(lane: K, next: T[K]) {
    if (
      lockedRef.current ||
      Object.values(latest.current).some((editor) => editor.canEdit?.() === false)
    )
      return;
    const before = latest.current[lane].document;
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    const target = document.activeElement;
    const typing = target?.matches(
      "textarea,input:not([type=checkbox]):not([type=radio]):not([type=range])",
    );
    const previous = entries.current.past.at(-1);
    const now = Date.now();
    if (
      typing &&
      group.current?.target === target &&
      group.current.lane === lane &&
      now - group.current.time < 750 &&
      previous?.lane === lane &&
      !entries.current.future.length
    ) {
      previous.after = next;
    } else {
      entries.current.past.push({ lane, before, after: next });
      if (entries.current.past.length > 100) entries.current.past.shift();
    }
    group.current = typing && target ? { target, lane, time: now } : null;
    entries.current.future = [];
    latest.current[lane].edit(next);
    // Multiple commands in the same event must see the most recent document.
    latest.current = { ...latest.current, [lane]: { ...latest.current[lane], document: next } };
    refresh((value) => value + 1);
  }
  function move(direction: "undo" | "redo") {
    if (
      lockedRef.current ||
      Object.values(latest.current).some((editor) => editor.canEdit?.() === false)
    )
      return;
    group.current = null;
    const from = direction === "undo" ? entries.current.past : entries.current.future;
    const to = direction === "undo" ? entries.current.future : entries.current.past;
    const entry = from.pop();
    if (!entry) return;
    const next = direction === "undo" ? entry.before : entry.after;
    latest.current[entry.lane].edit(next);
    latest.current = {
      ...latest.current,
      [entry.lane]: { ...latest.current[entry.lane], document: next },
    };
    to.push(entry);
    refresh((value) => value + 1);
  }
  return {
    edit,
    undo: () => move("undo"),
    redo: () => move("redo"),
    canUndo: !locked && entries.current.past.length > 0,
    canRedo: !locked && entries.current.future.length > 0,
  };
}

export function handleHistoryKey(
  event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    defaultPrevented: boolean;
    isComposing?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  history: HistoryControls,
) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !(event.metaKey || event.ctrlKey)
  )
    return false;
  const key = event.key.toLowerCase();
  if (key !== "z" && !(key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey))
    return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.shiftKey || key === "y") history.redo();
  else history.undo();
  return true;
}
