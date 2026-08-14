import { describe, expect, test } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  test("keeps whole bytes whole", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  test("steps up through the units with one decimal", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(437_434)).toBe("427.2 KB");
    expect(formatBytes(4_328_034)).toBe("4.1 MB");
  });

  test("does not run off the end of the unit table", () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe("5120 GB");
  });

  test("treats nonsense as zero rather than printing NaN", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
  });
});
