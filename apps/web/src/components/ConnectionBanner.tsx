import { CloudOff, RefreshCw } from "lucide-react";
import { useConnectionStatus } from "../lib/useConnectionStatus";

/*
 * One line, app-wide, only while something is wrong. It deliberately does
 * not replace the page: a canvas that has stopped receiving updates is
 * still worth looking at, and hiding it behind a full-screen error would
 * lose the user's camera and selection for a condition that usually
 * resolves itself in seconds.
 */
export function ConnectionBanner() {
  const status = useConnectionStatus();
  if (status === "online") return null;
  const offline = status === "offline";
  return (
    <div className="connection-banner" data-status={status} role="status" aria-live="polite">
      {offline ? (
        <CloudOff size={14} aria-hidden="true" />
      ) : (
        <RefreshCw size={14} aria-hidden="true" className="connection-banner-spin" />
      )}
      <span>
        {offline
          ? "You’re offline. This canvas is showing its last loaded state and won’t update."
          : "Reconnecting… this canvas won’t update until the connection is back."}
      </span>
    </div>
  );
}
