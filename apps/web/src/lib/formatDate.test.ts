import { describe, expect, test } from "vitest";
import { formatRelativeTime } from "./formatDate";

const NOW = new Date("2026-08-14T12:00:00Z").getTime();
const MINUTE = 60_000;

describe("formatRelativeTime", () => {
  test("collapses anything under a minute to 'just now'", () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("just now");
  });

  test("uses minutes, hours and days for the last week", () => {
    expect(formatRelativeTime(NOW - 12 * MINUTE, NOW)).toBe("12m ago");
    expect(formatRelativeTime(NOW - 5 * 60 * MINUTE, NOW)).toBe("5h ago");
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * MINUTE, NOW)).toBe("3d ago");
  });

  test("falls back to an absolute date past a week", () => {
    const older = NOW - 60 * 24 * 60 * MINUTE;
    expect(formatRelativeTime(older, NOW)).toBe(
      new Date(older).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    );
  });
});
