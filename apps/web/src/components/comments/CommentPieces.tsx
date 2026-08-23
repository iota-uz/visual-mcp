import { ArrowUp, Bot, User } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { formatAbsoluteTime, formatRelativeTime } from "../../lib/formatDate";
import { commentAuthor } from "./types";

/*
 * The parts every comment surface is built from. They live together because
 * the popover and the panel have to agree on them exactly: a thread read on
 * the canvas and the same thread read in the list must be recognisably one
 * object, and that is carried by the avatar, the byline and the send button
 * far more than by the container around them.
 */

/** Who is speaking. The agent is the other party here, not a decoration. */
export function CommentAvatar({ kind, size = 22 }: { kind: "human" | "agent"; size?: number }) {
  const Icon = kind === "agent" ? Bot : User;
  return (
    <span className="comment-avatar" data-author={kind} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.6)} aria-hidden="true" />
    </span>
  );
}

export function CommentByline({ kind, at }: { kind: "human" | "agent"; at: number }) {
  return (
    <span className="comment-byline">
      <strong>{commentAuthor(kind)}</strong>
      <time dateTime={new Date(at).toISOString()} title={formatAbsoluteTime(at)}>
        {formatRelativeTime(at)}
      </time>
    </span>
  );
}

/**
 * The one control that posts a message. Round, accent-filled, disabled
 * until there is something to send — the same button in the composer and in
 * every reply box, so "this sends it" only has to be learned once.
 */
export function CommentSendButton({
  label,
  disabled,
  busy,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <button
      type="submit"
      className="comment-send"
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <ArrowUp size={15} aria-hidden="true" />
    </button>
  );
}

/**
 * A comment box grows with what is typed in it — a fixed three-row textarea
 * is either too tall for "make this blue" or too short for a paragraph.
 * Enter sends, Shift+Enter breaks the line: the convention of every chat
 * surface, and the reason a Send button alone is not enough.
 */
export function CommentInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  autoFocus,
  maxRows = 8,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  maxRows?: number;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);

  // Re-measured off the value, so the box grows as it is typed into and
  // collapses back to one row when a send clears it. Measured, not counted:
  // line-height alone gets wrapping wrong.
  useLayoutEffect(() => {
    const field = own.current;
    if (!field) return;
    field.style.height = "auto";
    if (!value) return;
    const line = Number.parseFloat(getComputedStyle(field).lineHeight) || 18;
    field.style.height = `${Math.min(field.scrollHeight, line * maxRows)}px`;
  }, [value, maxRows]);

  useEffect(() => {
    if (autoFocus) own.current?.focus();
  }, [autoFocus]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // IME composition: Enter is committing a candidate, not sending.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit();
  }

  return (
    <textarea
      ref={(node) => {
        own.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className="comment-input"
      rows={1}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Escape closes the thing you are looking at. Captured at the document, and
 * stopped there, because the canvas underneath also listens for Escape and
 * would clear the selection out from under a composer being dismissed.
 */
export function useDismissOnEscape(onDismiss: () => void) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      latest.current();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

/**
 * Runs `work`, reports the failure where the person is looking rather than
 * in a toast that outlives the card, and keeps the controls disabled while
 * it is in flight.
 */
export function useCommentAction(): {
  busy: boolean;
  error: string | null;
  run: (work: () => Promise<unknown>, failure: string) => Promise<boolean>;
  clearError: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    clearError: () => setError(null),
    run: async (work, failure) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : failure);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
