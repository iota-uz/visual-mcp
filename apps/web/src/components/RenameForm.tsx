import { useEffect, useRef, useState } from "react";

interface RenameFormProps {
  initial: string;
  /** Accessible name of the field, e.g. "Workspace name". */
  label: string;
  onSave: (next: string) => Promise<unknown>;
  onDone: () => void;
}

/*
 * Inline rename: swaps the title in place for an input, submits on Enter,
 * cancels on Escape or blur-free explicit Cancel. Deliberately not a modal
 * — renaming is a one-field, low-stakes edit and a dialog would be heavier
 * than the thing it edits. The parent owns the "am I editing?" flag so the
 * same component works for a list row, a card, and a page header.
 */
export function RenameForm({ initial, label, onSave, onDone }: RenameFormProps) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus via ref rather than the autoFocus attribute: autoFocus steals
  // focus on hydration in ways screen readers announce badly (and biome's
  // a11y/noAutofocus rejects it).
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (!next || next === initial) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="rename-form" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !value.trim()}>
        Save
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onDone} disabled={busy}>
        Cancel
      </button>
      {error && <span className="error-text">{error}</span>}
    </form>
  );
}
