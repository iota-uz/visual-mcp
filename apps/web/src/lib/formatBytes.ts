const UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * Byte counts come back from every delete (`bytes_reclaimed`) and from the
 * storage quota, and were previously thrown away — partly because "437434"
 * is not a number anyone can act on. One decimal place above KB, none below.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}
