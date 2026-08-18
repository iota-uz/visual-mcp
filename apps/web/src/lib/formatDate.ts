const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Short, glanceable "when was this last touched" label for canvas cards.
 * Recent edits read as relative ("12m ago"), anything past a week falls
 * back to a locale date — a canvas from March is better identified by its
 * date than by "142d ago".
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const delta = now - timestamp;
  if (!Number.isFinite(timestamp)) return "";
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The full, unambiguous form — for `title=` beside a relative label, and
 * for the places that were printing a raw `toLocaleString()` inline.
 */
export function formatAbsoluteTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "in 12 days" / "3 days ago" — for an expiry, where the direction matters
 * and the answer is usually "is this still good?".
 */
export function formatTimeUntil(timestamp: number, now: number = Date.now()): string {
  const delta = timestamp - now;
  if (!Number.isFinite(timestamp)) return "";
  if (delta <= 0) return "expired";
  if (delta < HOUR) return `in ${Math.max(1, Math.floor(delta / MINUTE))}m`;
  if (delta < DAY) return `in ${Math.floor(delta / HOUR)}h`;
  return `in ${Math.floor(delta / DAY)}d`;
}
