import { useEffect, useId, useRef, useState } from "react";

interface RenameFormProps {
  initial: string;
  /** Accessible name of the field, e.g. "Workspace name". */
  label: string;
  onSave: (next: string) => Promise<unknown>;
  onDone: () => void;
  className?: string;
}

/*
 * The title becomes a field. Enter and blur save, Escape or an empty value
 * cancel. No Save/Cancel buttons: those were heavier than the one word they
 * edited, and the page heading already renamed this way on double-click.
 * The parent owns "am I editing?" so the same field works in a card, a
 * drawer, and a heading.
 */
export function RenameForm({ initial, label, onSave, onDone, className }: RenameFormProps) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  const id = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function cancel() {
    closed.current = true;
    onDone();
  }

  async function commit() {
    if (closed.current) return;
    const next = value.trim();
    if (!next || next === initial) {
      cancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      closed.current = true;
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={["inline-rename-wrap", className].filter(Boolean).join(" ")}>
      <input
        id={id}
        ref={inputRef}
        className="inline-rename"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={value}
        size={Math.max(8, value.length + 1)}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
      />
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}
