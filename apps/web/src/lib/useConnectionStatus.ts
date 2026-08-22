import { useConvex } from "convex/react";
import { useEffect, useState } from "react";

/*
 * The app had no connectivity awareness at all: no `navigator.onLine`, no
 * Convex connection state. When the websocket dropped, every `useQuery`
 * flipped back to `undefined` and the routes rendered that as a full-screen
 * loading state — indistinguishable from a fresh navigation, and with no
 * hint that the canvas had stopped being live.
 *
 * Two signals, because neither is sufficient alone. `navigator.onLine` is
 * instant and event-driven but only knows about the network interface;
 * the Convex socket can be down while the machine is happily online (a
 * deploy, a proxy, a suspended laptop that has not noticed yet). The
 * socket state is authoritative but has no event, so it has to be polled.
 */
const POLL_MS = 2_000;

export type ConnectionStatus = "online" | "offline" | "reconnecting";

export function useConnectionStatus(): ConnectionStatus {
  const convex = useConvex();
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [socketConnected, setSocketConnected] = useState(true);

  useEffect(() => {
    const goOnline = () => setBrowserOnline(true);
    const goOffline = () => setBrowserOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    // `connectionState` is not part of the fixture client, and older
    // clients may not expose it either — a missing method must read as
    // "connected" rather than pinning a permanent banner to the page.
    const read = () => {
      const state = (
        convex as { connectionState?: () => { isWebSocketConnected?: boolean } } | undefined
      )?.connectionState?.();
      setSocketConnected(state?.isWebSocketConnected ?? true);
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => window.clearInterval(timer);
  }, [convex]);

  if (!browserOnline) return "offline";
  return socketConnected ? "online" : "reconnecting";
}
