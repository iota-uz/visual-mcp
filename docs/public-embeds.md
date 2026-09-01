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
  pins canvas content to that checkpoint. It still revalidates every 60
  seconds because canonical iframe components are live and are deliberately
  not version-pinned.
- The internal key includes canvas id, published version, Page, target, scale,
  clip mode, padding, and renderer version. Thus the same unpinned URL causes a cold render
  after the next published checkpoint while draft-only edits remain invisible.
- The worker hashes final PNG bytes for `ETag`; matching `If-None-Match` returns
  304. It compresses and downsizes any PNG over 4 MiB and the endpoint adds
  `X-Embed-Downscaled: 1`.
- Only anonymous cold misses consume the per-share-slug rate limit. MCP batch
  preparation is authenticated and can enqueue up to 50 targets in one call.
- Cold work runs in a durable queue with three render slots and retries. A cold
  URL returns `202 text/plain`, `Cache-Control: no-store`, `Retry-After: 3`, and
  `X-Embed-Status: queued|updating`; it never returns a placeholder image under
  `200`. Rate limiting returns `429` with the same retry contract.
- A PNG is promoted to the durable cache only after the worker reports complete
  iframe readiness. Wide nodes use the same object cache as every other target.
  Repeated reads stream the stored bytes and use their content hash as `ETag`.
- Component changes mark existing bytes stale and enqueue one coalesced refresh.
  While it runs, the last successful image remains available with
  `X-Embed-Status: stale`. A failed refresh keeps those bytes and exposes
  `X-Embed-Status: error`; an authenticated `canvas_embed` call can retry it.

## MCP preparation

`canvas_embed` requires a `targets` array with 1–50 canvas, node, group, stage,
or region specifications. `page_id`, `target`, `clip`, `scale`, and `padding`
belong inside each `targets[]` item; the former flat top-level target fields are
rejected. Its `embeds[]` result contains the supported URL, linked
Markdown, resolved version, and `preparation_status` for every target. Call it
again until all requested entries report `ready`, then paste the returned URLs
into GitHub, Notion, Slack, or another non-retrying consumer.

With `pin_version: false` (the default), the URL contains no `v` parameter and
therefore follows the latest published checkpoint. With `pin_version: true`,
the URL includes `v=N` and remains attached to that published checkpoint.
