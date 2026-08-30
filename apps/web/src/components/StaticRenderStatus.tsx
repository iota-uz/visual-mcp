import { AlertTriangle, Clock3, RefreshCw } from "lucide-react";

export type StaticRenderState = "ready" | "queued" | "updating" | "stale" | "error";

const STATUS = {
  queued: { label: "Queued", Icon: Clock3 },
  updating: { label: "Updating preview", Icon: RefreshCw },
  stale: { label: "Preview out of date", Icon: Clock3 },
  error: { label: "Preview update failed", Icon: AlertTriangle },
} as const;

export function StaticRenderStatus({
  state,
  className = "",
}: {
  state?: StaticRenderState;
  className?: string;
}) {
  if (!state || state === "ready") return null;
  const { label, Icon } = STATUS[state];
  return (
    <span className={`static-render-status static-render-status-${state} ${className}`.trim()}>
      <Icon size={11} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
