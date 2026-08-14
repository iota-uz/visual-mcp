/**
 * SPA_ORIGIN is a required deployment variable in v2 — every tool result now
 * carries fully-qualified canvas/share URLs, and ../lib/urls.ts throws rather
 * than handing back nulls when it is missing (returning null links is exactly
 * the v1 failure the URLs were added to fix). Tests need it set for the same
 * reason the deployment does.
 */
process.env.SPA_ORIGIN ??= "https://canvas.test";
