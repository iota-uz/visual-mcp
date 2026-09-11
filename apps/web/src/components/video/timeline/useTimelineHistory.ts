import { useEffect, useRef, useState } from "react";
import type { TimelineDocument } from "../../../../../../packages/video/src/contracts";
import type { History } from "./model";

/** Keeps local undo/redo isolated from server subscription reconciliation. */
export function useTimelineHistory(
  document: TimelineDocument,
  onChange: (next: TimelineDocument) => void,
  disabled: boolean,
) {
  const history = useRef<History>({ past: [], future: [] });
  const latestDocument = useRef(document);
  const lastEmittedSignature = useRef<string | undefined>(undefined);
  const [, refresh] = useState(0);

  useEffect(() => {
    if (JSON.stringify(document) === lastEmittedSignature.current)
      lastEmittedSignature.current = undefined;
    else if (document !== latestDocument.current) {
      history.current = { past: [], future: [] };
      refresh((value) => value + 1);
    }
    latestDocument.current = document;
  }, [document]);

  function emit(next: TimelineDocument) {
    latestDocument.current = next;
    lastEmittedSignature.current = JSON.stringify(next);
    onChange(next);
  }

  function commit(next: TimelineDocument) {
    if (disabled || next === latestDocument.current) return;
    history.current.past.push(latestDocument.current);
    if (history.current.past.length > 50) history.current.past.shift();
    history.current.future = [];
    refresh((value) => value + 1);
    emit(next);
  }

  function undo() {
    if (disabled) return;
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(latestDocument.current);
    refresh((value) => value + 1);
    emit(previous);
  }

  function redo() {
    if (disabled) return;
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(latestDocument.current);
    refresh((value) => value + 1);
    emit(next);
  }

  return {
    latestDocument,
    commit,
    undo,
    redo,
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
  };
}
