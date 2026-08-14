// `role="status"` because this replaces content that is about to appear:
// without it a screen reader hears nothing at all between navigating and
// the data landing.
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="loading-state" role="status">
      {label}
    </p>
  );
}
