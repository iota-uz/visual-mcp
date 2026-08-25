import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/** Cold renders only. Cache hits never call this limiter. */
export const embedRateLimiter = new RateLimiter(components.rateLimiter, {
  coldEmbedRender: {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 3,
  },
});
