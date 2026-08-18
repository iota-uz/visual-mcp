import { CheckCircle2, X, XCircle } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The app had no feedback channel at all: six mutations caught nothing and
 * rendered nothing, so a failed publish, mint or revoke was indistinguishable
 * from a successful one. Deliberately a live region rather than a modal —
 * every message here is a report on something the user already did, and
 * nothing in this app should interrupt to say "done".
 */

export type ToastTone = "success" | "error";

export interface ToastOptions {
  tone?: ToastTone;
  message: string;
  /** Milliseconds before auto-dismiss. Errors stay until dismissed. */
  durationMs?: number;
}

interface Toast extends ToastOptions {
  id: number;
  tone: ToastTone;
  /** Marked on the way out; removed once the exit animation ends. */
  leaving?: boolean;
}

interface ToastApi {
  notify: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_SUCCESS_MS = 5000;

/**
 * `notify` outside a provider is a no-op rather than a throw: a toast is
 * never the point of the code calling it, and a missing provider must not
 * turn a working mutation into a crash.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? NO_OP;
}

const NO_OP: ToastApi = { notify: () => {} };

/** Formats an unknown thrown value for a toast. Convex errors are Errors. */
export function toastError(err: unknown, prefix: string): ToastOptions {
  const detail = err instanceof Error ? err.message : String(err);
  return { tone: "error", message: `${prefix}: ${detail}` };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  /*
   * Marks rather than removes: a toast that is filtered out of the array
   * vanishes mid-frame, so the stack had a considered entrance and simply
   * blinked out of existence. The row's own animationend takes it out of the
   * array for good.
   */
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((options: ToastOptions) => {
    setToasts((current) => [
      ...current,
      { ...options, tone: options.tone ?? "success", id: nextId.current++ },
    ]);
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region">
        {toasts.map((toast) => (
          // The slot is what collapses when a toast leaves, so the stack
          // closes the gap instead of the rows below it jumping.
          <div key={toast.id} className={`toast-slot${toast.leaving ? " is-leaving" : ""}`}>
            <ToastRow toast={toast} onDismiss={dismiss} onRemove={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({
  toast,
  onDismiss,
  onRemove,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const { id, tone, leaving } = toast;

  // Backstop for the animationend below: with `prefers-reduced-motion` the
  // duration collapses to 0.01ms, which still fires — but an interrupted
  // animation, or a tab that was backgrounded mid-exit, may not.
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onRemove(id), 400);
    return () => window.clearTimeout(timer);
  }, [leaving, id, onRemove]);

  useEffect(() => {
    // Errors are the ones worth reading twice, and they carry server text
    // the user may want to copy — so only successes expire on their own.
    if (tone === "error") return;
    const ms = toast.durationMs ?? DEFAULT_SUCCESS_MS;
    const timer = window.setTimeout(() => onDismiss(id), ms);
    return () => window.clearTimeout(timer);
  }, [id, tone, toast.durationMs, onDismiss]);

  const Icon = tone === "error" ? XCircle : CheckCircle2;

  return (
    <output
      className={`toast toast-${tone}${leaving ? " is-leaving" : ""}`}
      aria-live={tone === "error" ? "assertive" : "polite"}
      onAnimationEnd={(event) => {
        // Only the row's own exit — the icon and anything inside it bubble
        // their animations here too.
        if (leaving && event.target === event.currentTarget) onRemove(id);
      }}
    >
      <Icon size={16} aria-hidden="true" className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </output>
  );
}
