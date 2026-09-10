import { useEffect, useState } from "react";
import { JobRequest } from "../../../../../packages/video/src/jobs";
import { useSessionUser } from "../../auth";

const PREFIX = "visual-canvas:job-intent:";
export function clearJobIntents() {
  for (const key of Object.keys(localStorage))
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);
}
/** No URLs or credentials: only the exact authenticated operation and idempotency key. */
export function useDurableJobIntent<T extends { idempotencyKey: string; request: unknown }>(
  scope: string,
) {
  const user = useSessionUser();
  const key = user?.userId ? `${PREFIX}${user.userId}:${scope}` : null;
  const [state, setState] = useState<{ key: string; value: T | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!key) {
      setState(null);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      const value: T | null = raw ? JSON.parse(raw) : null;
      if (
        value &&
        (typeof value.idempotencyKey !== "string" || !JobRequest.safeParse(value.request).success)
      )
        throw new Error("Invalid recovery record");
      setState({ key, value });
      setError("");
    } catch {
      setError(
        "The recovery record could not be read. Do not create another paid request; inspect Production first.",
      );
    }
  }, [key]);
  return {
    current: state?.key === key ? state.value : null,
    ready: Boolean(key && state?.key === key && !error),
    error,
    save(value: T | null) {
      if (!key || state?.key !== key) throw new Error("Account recovery scope is not ready");
      try {
        if (value) localStorage.setItem(key, JSON.stringify(value));
        else localStorage.removeItem(key);
      } catch {
        setError("Recovery storage is unavailable. No new operation can be submitted safely.");
        throw new Error("Recovery storage unavailable");
      }
      setState({ key, value });
    },
  };
}
