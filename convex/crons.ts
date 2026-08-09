/**
 * PLAN.md section 9/12.4: "/cache TTL sweep" — the only scheduled job this
 * product needs (no admin panel, no billing, single-org — decision #8). See
 * canvases.ts's `sweepCacheTtl` for what it actually deletes and why.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("cache ttl sweep", { hours: 24 }, internal.canvases.sweepCacheTtl, {});

export default crons;
