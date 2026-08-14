/**
 * Request/response contracts for the worker's HTTP endpoints (PLAN.md
 * section 6: "requests carry sources[{relPath,getUrl}] + uploads
 * [{relPath,putUrl}] — no creds"). `format`/`viewport`/`pdf` are reused
 * directly from `@visual-canvas/runtime`'s existing zod schemas rather than
 * redeclared, so the worker can never drift from what `renderFile` actually
 * accepts.
 *
 * Upload URLs are treated as an anonymous pool, not pre-matched to a
 * relPath: `/render` always produces exactly one output, so it consumes
 * exactly one upload slot. `/exec` (run_code) can produce an unpredictable
 * number of files under /output, so its caller must pre-provision a pool
 * of upload URLs sized to whatever it's willing to accept back; anything
 * beyond that pool is reported but not uploaded (`skipped: true`). This is
 * a known interim simplification — PLAN.md section 6 doesn't fully specify
 * how a credential-free worker should request *additional* upload URLs
 * mid-job for an unknown output count, so this worker doesn't attempt to.
 */

import {
  PdfOptionsSchema,
  RenderFormatSchema,
  ViewportOptionsSchema,
} from "@visual-canvas/runtime/types.js";
import { z } from "zod";

export const SignedSourceSchema = z.object({
  relPath: z.string().min(1),
  getUrl: z.string().min(1),
});
export type SignedSource = z.infer<typeof SignedSourceSchema>;

export const SignedUploadSchema = z.object({
  putUrl: z.string().min(1),
});
export type SignedUpload = z.infer<typeof SignedUploadSchema>;

export const RenderRequestSchema = z.object({
  sources: z.array(SignedSourceSchema),
  entrypoint: z.string().min(1),
  outputPath: z.string().min(1),
  format: RenderFormatSchema,
  viewport: ViewportOptionsSchema.optional(),
  pdf: PdfOptionsSchema.optional(),
  upload: SignedUploadSchema,
  // Only consulted for format "png" — a thumbnail is a downscale of the
  // full-size PNG we already have in hand (PLAN.md section 8: "near-zero
  // marginal cost, no second Chromium launch"), so there's nothing to
  // capture for svg/pdf/html outputs yet.
  thumbnailUpload: SignedUploadSchema.optional(),
});
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

/**
 * `/render`'s response body. Declared here (rather than as a bare interface
 * next to the handler) so the response contract sits beside the request
 * contract and callers — Convex's `callWorker` type parameter today — have
 * one place to read it from.
 *
 * `relPath` is the *normalized* output path (`/output/x.png`), not the
 * caller's raw `outputPath`: artifact rows are keyed by it, `/s/:slug`
 * always rebuilds a leading-slash relPath when serving, and the `/cache`
 * TTL cron matches `startsWith("/cache/")` — a row keyed `output/x.png`
 * is invisible to both.
 */
export const RenderResponseSchema = z.object({
  relPath: z.string(),
  size: z.number(),
  mimeType: z.string(),
  uploadStatus: z.number(),
  uploadBody: z.unknown(),
  thumbnail: z.object({ uploadStatus: z.number(), uploadBody: z.unknown() }).optional(),
  // Subresources the render asked for and never got (missing images,
  // fonts, CSS `url(...)` targets). Always present, usually empty: a
  // render with unresolved refs still succeeds and still returns its
  // artifact — Chromium draws a broken image instead of failing — so this
  // is the only signal the caller gets that the picture is wrong. Capped
  // and de-duplicated by the renderer (MAX_UNRESOLVED_REFS).
  unresolvedRefs: z.array(z.string()),
});
export type RenderResponse = z.infer<typeof RenderResponseSchema>;

export const ExecRequestSchema = z.object({
  sources: z.array(SignedSourceSchema),
  code: z.string(),
  timeoutMs: z.number().positive().optional(),
  memoryLimitMb: z.number().positive().optional(),
  uploads: z.array(SignedUploadSchema),
});
export type ExecRequest = z.infer<typeof ExecRequestSchema>;

// Canvas-node HTML (PLAN.md section 2) has no single entrypoint file for
// renderFile's own inline Tailwind step to work against, so put_canvas_doc
// sends every content.type==='html' node's raw HTML directly (small text,
// no signed sources needed) and gets back one compiled stylesheet covering
// all of them.
export const CompileCssRequestSchema = z.object({
  htmlFragments: z.array(z.string()),
});
export type CompileCssRequest = z.infer<typeof CompileCssRequestSchema>;
