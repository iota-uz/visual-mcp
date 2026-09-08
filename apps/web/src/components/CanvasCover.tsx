import type { CanvasPoster } from "@visual-canvas/canvas/poster.js";
import { useState } from "react";
import { kindIcon } from "../lib/canvasKind";

/** card = the gallery grid, strip = Home's covers, chip = the Pages rail. */
export type CanvasCoverSize = "card" | "strip" | "chip";

export interface CanvasCoverProps {
  /** "canvas" | "html" | "image" | "pdf". */
  kind: string;
  /** Schematic geometry. Only `kind: "canvas"` ever has one. */
  poster?: CanvasPoster | null;
  /** The worker's PNG, when one exists. Signed and expirable. */
  thumbnailUrl?: string | null;
  size?: CanvasCoverSize;
  className?: string;
}

/*
 * A canvas's face, everywhere a canvas is listed.
 *
 * Almost nothing in the app has a real picture: `thumbnailId` is written
 * only by the agent-driven render path, the background re-render runs only
 * for published canvases, and restoring a version clears it — so a canvas
 * authored in the browser never had one and never would. Every gallery card
 * was a dashed box reading "No render yet".
 *
 * The poster is not a second renderer (the one rasterizer is the Playwright
 * worker — adr/platform/browser-export-via-snapshot-worker.md). It is the
 * arrangement of the nodes and nothing else: no text, no images, no chrome.
 * At cover size that is what tells two canvases apart.
 *
 * Precedence lives here, in one place, rather than in each list: a real PNG
 * always wins, the poster is the fallback, and an expired signed URL now
 * degrades to the poster instead of to "No render yet".
 */
export function CanvasCover({
  kind,
  poster,
  thumbnailUrl,
  size = "card",
  className,
}: CanvasCoverProps) {
  const KindIcon = kindIcon(kind);
  // A signed URL can expire and its storage object can go missing; both look
  // the same from here, and both should fall through rather than break.
  const [failed, setFailed] = useState(false);
  const classes = ["canvas-cover", `canvas-cover-${size}`, className].filter(Boolean).join(" ");

  if (thumbnailUrl && !failed) {
    return (
      <span className={classes}>
        <img
          src={thumbnailUrl}
          alt=""
          className="canvas-cover-image"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  if (poster && poster.rects.length > 0) {
    return (
      <span className={classes}>
        <PosterArt poster={poster} />
      </span>
    );
  }

  // An empty canvas and a canvas whose cover was never computed are
  // different facts, and the poster object exists for exactly this: a
  // `kind: "canvas"` row always gets one, even with no nodes in it.
  if (poster) {
    return (
      <span className={classes}>
        <span className="canvas-cover-art is-empty" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className={classes}>
      <span className="canvas-cover-fallback" aria-hidden="true">
        <KindIcon size={size === "chip" ? 14 : 20} strokeWidth={1.5} />
      </span>
    </span>
  );
}

/**
 * The rectangles alone. The Pages rail uses this directly: it holds the
 * whole CanvasFile already and there is never a PNG for one page.
 */
export function PosterArt({ poster }: { poster: CanvasPoster }) {
  return (
    <span
      className="canvas-cover-art"
      aria-hidden="true"
      // The art keeps the canvas's own aspect inside the frame's, so an
      // extreme document letterboxes rather than stretching.
      style={{ "--cover-ar": String(poster.ar) } as React.CSSProperties}
    >
      {poster.rects.map((rect) => (
        <i
          // Position is the identity here: these are anonymous blocks, and
          // the list is regenerated whole whenever the geometry changes.
          key={`${rect.x}:${rect.y}:${rect.w}:${rect.h}`}
          data-role={rect.r}
          data-kind={rect.k}
          style={{
            left: `${rect.x / 10}%`,
            top: `${rect.y / 10}%`,
            width: `${rect.w / 10}%`,
            height: `${rect.h / 10}%`,
          }}
        />
      ))}
    </span>
  );
}
