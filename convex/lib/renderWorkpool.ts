import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

/** One global Chromium budget shared by user-requested and background renders. */
export const renderWorkpool = new Workpool(components.renderWorkpool, {
  maxParallelism: 3,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
});
