export type VideoMetric =
  | "result_persistence_failed"
  | "recovery_source_unavailable"
  | "orphan_leases"
  | "retry_count"
  | "duration_mismatch";

export function emitVideoMetric(
  metric: VideoMetric,
  fields: Record<string, string | number | boolean | null>,
  options: { alert?: boolean } = {},
) {
  const entry = {
    event: "video_operational_metric",
    metric,
    value: typeof fields.value === "number" ? fields.value : 1,
    alert: options.alert ?? false,
    ...fields,
  };
  (entry.alert ? console.warn : console.info)(JSON.stringify(entry));
  return entry;
}
