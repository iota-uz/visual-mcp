export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <p className="loading-state">{label}</p>;
}
