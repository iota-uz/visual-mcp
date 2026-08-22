import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/*
 * Iframe capability tokens live for ten minutes (convex/canvases.ts
 * mintIframeCapabilityMine). Two routes need one, and both used to get it
 * wrong in a different way:
 *
 *   - Canvas.tsx renewed on time but treated a mint failure as terminal —
 *     it set the token to null with no retry, and the render gate refuses
 *     to mount whenever the doc has an iframe or image node. One transient
 *     failure meant "Loading canvas…" forever, with no message and no way
 *     out but a reload.
 *   - Present.tsx minted exactly once, with no renewal timer and no catch.
 *     Any presentation open longer than ten minutes had its iframes start
 *     404ing silently, and a mint failure was an unhandled rejection.
 *
 * So: one hook, renewal a minute before expiry, bounded exponential
 * backoff on failure, and `error` exposed so the surface can say what
 * happened and offer `retry` instead of spinning.
 */

const RENEW_LEAD_MS = 60_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const RETRY_ATTEMPTS = 5;

export interface IframeCapability {
  token: string;
  expiresAt: number;
  /*
   * The revision map as it stood when this token was minted. Held with the
   * token rather than read live so the cache-busting `?vcv=` suffix cannot
   * change identity between the mint and the mount, which would reload
   * every frame.
   */
  revisions: Record<string, string> | null;
}

export interface IframeCapabilityState {
  capability: IframeCapability | null;
  /** Set once the retry budget is spent. Null while attempts remain. */
  error: string | null;
  /** Re-arms the whole sequence from attempt zero. */
  retry: () => void;
}

/**
 * Keeps a live iframe capability token for one canvas, renewing it before
 * it expires and retrying with backoff when a mint fails.
 *
 * Pass `enabled: false` for public views and non-canvas kinds — those read
 * iframes through the `/s/:slug` path and need no token at all.
 */
export function useIframeCapability({
  canvasId,
  enabled,
  revisions,
}: {
  canvasId: string | undefined;
  enabled: boolean;
  revisions: Record<string, string> | null;
}): IframeCapabilityState {
  const mint = useMutation(api.canvases.mintIframeCapabilityMine);
  const [capability, setCapability] = useState<IframeCapability | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Serialised so the run below does not restart on every reactive object
  // identity change; only an actual revision change should re-mint.
  const revisionsKey = JSON.stringify(revisions ?? null);

  /*
   * One generation per run. The unmount cleanup and `retry` both bump it,
   * which is what makes a stale backoff timer or an in-flight mint from a
   * previous run land harmlessly instead of overwriting fresh state.
   */
  const generationRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const start = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;

    if (!canvasId || !enabled) {
      setCapability(null);
      setError(null);
      return;
    }
    setError(null);
    const snapshot = JSON.parse(revisionsKey) as Record<string, string> | null;

    const run = async (failures: number) => {
      try {
        const { token, expiresAt } = await mint({ canvasId: canvasId as Id<"canvases"> });
        if (generationRef.current !== generation) return;
        setCapability({ token, expiresAt, revisions: snapshot });
        setError(null);
        timerRef.current = window.setTimeout(
          () => void run(0),
          Math.max(1_000, expiresAt - Date.now() - RENEW_LEAD_MS),
        );
      } catch (err: unknown) {
        if (generationRef.current !== generation) return;
        if (failures + 1 >= RETRY_ATTEMPTS) {
          /*
           * Deliberately keeps any token already in hand: an expired one
           * still renders frames that loaded before it lapsed, which beats
           * blanking a presentation mid-demo. The error is what changes
           * the UI.
           */
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        timerRef.current = window.setTimeout(
          () => void run(failures + 1),
          Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** failures),
        );
      }
    };

    void run(0);
  }, [canvasId, enabled, revisionsKey, mint]);

  useEffect(() => {
    start();
    return () => {
      generationRef.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [start]);

  return { capability, error, retry: start };
}
