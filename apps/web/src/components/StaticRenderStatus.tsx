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

/*
 * The subset worth showing next to a card in a list.
 *
 * `staticRenderStatus` describes the *published* embed and share-card
 * render pipeline (convex/lib/staticRenderState.ts, and
 * adr/sharing/static-preview-cards-not-embedded-viewers.md). A card in the
 * gallery does not depend on that pipeline to have a face, so `stale` and
 * `error` were a permanent red badge about something the reader cannot act
 * on from here and that does not affect what they are looking at — the
 * production OSAGO gallery has worn one for weeks.
 *
 * `queued` and `updating` stay: they mean a better picture is on its way,
 * which is true and useful next to a placeholder. The terminal states
 * surface on the canvas page, beside the publish controls that own them.
 */
export function listRenderState(state?: StaticRenderState): StaticRenderState | undefined {
  return state === "queued" || state === "updating" ? state : undefined;
}
