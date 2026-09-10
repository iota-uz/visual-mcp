/** Shared producer/recovery bound; reports stay in object storage, never job JSON. */
export const MAX_CRITIQUE_REPORT_BYTES = 16 * 1024 * 1024;
export const MAX_CRITIQUE_SUMMARY_BYTES = 64 * 1024;
export function utf8Prefix(value: string, maxBytes: number) {
  let total = 0,
    result = "";
  for (const char of value) {
    const bytes = new TextEncoder().encode(char).length;
    if (total + bytes > maxBytes) break;
    result += char;
    total += bytes;
  }
  return result;
}
