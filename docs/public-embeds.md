# Public PNG embeds

Public embeds are served from `https://canvas.iota.uz/s/{shareSlug}/_embed/*`.
The web origin streams the Convex HTTP response without redirects, cookies, or
`Set-Cookie`; MCP must never return a `*.convex.site` embed URL.

Node endpoints accept `clip=content` for iframe and image nodes. The renderer
uses the actual inner viewport's transformed DOM bounds, preserving its aspect
ratio while excluding the node caption, phone/browser chrome, and default
outer padding. `clip=frame` is the default. Content clipping is rejected for
canvas, group, stage, region, and native-content targets.

## Storage

Rendered PNGs use the existing private asset bucket configured with
`S3_ASSET_*`. They live under an isolated `embeds/{canvasId}/v{version}/`
prefix. The worker receives a short-lived presigned PUT, but object keys,
bucket credentials, and presigned GETs are never returned to clients.

Every public read passes through `canvas.iota.uz`, revalidates the live share
slug in Convex, then fetches the object with server-side credentials and
streams it without redirects, cookies, or `Set-Cookie`. Making a canvas
private or replacing its slug therefore immediately makes old embed endpoints
return 404 even though the cached object may still exist in the bucket.

## Cache behavior

- An unpinned URL has no `v`, resolves the latest published checkpoint, and
  returns `Cache-Control: public, max-age=60, must-revalidate`.
- `v=N` is accepted only for a checkpoint known to have been published and
  returns `Cache-Control: public, max-age=31536000, immutable`.
- The internal key includes canvas id, published version, Page, target, scale,
  clip mode, padding, and renderer version. Thus the same unpinned URL causes a cold render
  after the next published checkpoint while draft-only edits remain invisible.
- The worker hashes final PNG bytes for `ETag`; matching `If-None-Match` returns
  304. It compresses and downsizes any PNG over 4 MiB and the endpoint adds
  `X-Embed-Downscaled: 1`.
- Only cold misses consume the per-share-slug rate limit. A successful capture
  with incomplete iframe readiness is returned as the real PNG with
  `X-Embed-Partial: 1` and `Cache-Control: no-store`, and is not promoted into
  the durable cache so the next request retries. A worker/browser failure that
  produces no PNG returns the static unavailable-preview PNG with `no-store`.
