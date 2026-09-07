/** Checked access for graph indices and DOM nodes whose existence is an invariant. */
export function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing routing state");
  return value;
}
