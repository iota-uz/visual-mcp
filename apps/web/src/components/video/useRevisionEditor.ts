import { useCallback, useEffect, useRef, useState } from "react";

export type EditorState = "saved" | "editing" | "saving" | "conflict" | "error" | "invalid";
export type DocumentSnapshot<T> = { revision: string; document: T };

/** Local edits survive subscription updates. A rejected CAS never rebases silently. */
export function useRevisionEditor<T>(
  snapshot: DocumentSnapshot<T>,
  write: (document: T, revision: string, key: string) => Promise<string>,
) {
  const [document, setDocument] = useState(snapshot.document);
  const [base, setBase] = useState(snapshot);
  const [state, setState] = useState<EditorState>("saved");
  const [error, setError] = useState("");
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const pending = useRef<{ document: T; revision: string; key: string } | null>(null);
  // State alone cannot serialize rapid saves: two presses in the same tick
  // share one render's closure and both read "editing". The ref closes the
  // race so concurrent saves collapse into the single in-flight write.
  const inflight = useRef(false);
  const awaitingAcknowledgement = useRef<{ revision: string; previous: string } | null>(null);
  const writer = useRef(write);
  writer.current = write;
  const dirty = JSON.stringify(document) !== JSON.stringify(base.document);
  const externalChange = snapshot.revision !== base.revision;

  useEffect(() => {
    if (awaitingAcknowledgement.current) {
      if (
        snapshot.revision === awaitingAcknowledgement.current.previous &&
        snapshot.revision !== awaitingAcknowledgement.current.revision
      )
        return;
      awaitingAcknowledgement.current = null;
    }
    if (!dirty && state === "saved" && snapshot.revision !== base.revision) {
      setDocument(snapshot.document);
      setBase(snapshot);
      setHistoryEpoch((epoch) => epoch + 1);
    }
  }, [snapshot, base.revision, dirty, state]);

  const save = useCallback(async () => {
    if (!dirty || state === "saving" || state === "conflict" || inflight.current) return;
    // Retry only the identical operation after a lost response. Changed edits
    // are not allowed until that attempt has been reconciled or discarded.
    const attempt = pending.current ?? {
      document,
      revision: base.revision,
      key: crypto.randomUUID(),
    };
    pending.current = attempt;
    inflight.current = true;
    setState("saving");
    setError("");
    try {
      const revision = await writer.current(attempt.document, attempt.revision, attempt.key);
      awaitingAcknowledgement.current = { revision, previous: attempt.revision };
      setBase({ revision, document: attempt.document });
      pending.current = null;
      setState("saved");
    } catch (cause) {
      const data = cause && typeof cause === "object" && "data" in cause ? cause.data : undefined;
      const code = data && typeof data === "object" && "code" in data ? data.code : undefined;
      const conflict = code === "REVISION_CONFLICT";
      const invalid = code === "VALIDATION_ERROR";
      setState(conflict ? "conflict" : invalid ? "invalid" : "error");
      setError(
        conflict
          ? "Someone changed this draft. Your text is kept here. Compare with the saved draft before continuing."
          : invalid
            ? "This edit is not valid and was not saved. Check the field values and clip bounds."
            : "Saving could not be confirmed. Retry the same save before making more changes.",
      );
      if (conflict || invalid) pending.current = null;
    } finally {
      inflight.current = false;
    }
  }, [document, base.revision, dirty, state]);

  useEffect(() => {
    if (!dirty || state !== "editing") return;
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
  }, [dirty, state, save]);

  useEffect(() => {
    if (!dirty && state !== "saving") return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, state]);

  function edit(next: T) {
    if (inflight.current || state === "saving" || state === "error" || state === "conflict") return;
    setDocument(next);
    setState(JSON.stringify(next) === JSON.stringify(base.document) ? "saved" : "editing");
    setError("");
  }

  function useSaved() {
    if (state === "saving" || state === "error") return;
    setDocument(snapshot.document);
    setHistoryEpoch((epoch) => epoch + 1);
    setBase(snapshot);
    pending.current = null;
    setError("");
    setState("saved");
  }

  return {
    document,
    historyEpoch,
    savedDocument: snapshot.document,
    awaitingSubscription: Boolean(
      awaitingAcknowledgement.current &&
        snapshot.revision === awaitingAcknowledgement.current.previous &&
        snapshot.revision !== awaitingAcknowledgement.current.revision,
    ),
    edit,
    state,
    error,
    dirty,
    externalChange,
    save,
    useSaved,
    locked: state === "saving" || state === "error" || state === "conflict",
    canEdit: () =>
      !inflight.current && state !== "saving" && state !== "error" && state !== "conflict",
  };
}
