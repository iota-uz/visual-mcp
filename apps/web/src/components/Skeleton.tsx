/*
 * Placeholders shaped like the content that replaces them, for the two list
 * surfaces whose loading state used to be a line of pulsing text sized
 * nothing like the rows it became — so every load ended in a jump.
 *
 * `aria-hidden`: the shapes carry no information, and the visually-hidden
 * status line next to them is what actually gets announced.
 */
function SkeletonStatus({ label }: { label: string }) {
  return (
    <span className="visually-hidden" role="status">
      {label}
    </span>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <>
      <SkeletonStatus label="Loading…" />
      <ul className="card-list skeleton-list" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder, never reordered
          <li key={i} className="card-list-item row-item skeleton-row">
            <span className="skeleton-bar skeleton-bar-title" />
            <span className="skeleton-bar skeleton-bar-meta" />
          </li>
        ))}
      </ul>
    </>
  );
}

/*
 * The canvas is the product, and it had the app's worst loading state: a
 * single pulsing line of text, centred in an empty white page, replaced
 * all at once by a full viewport. This stands in the shape of the thing
 * that arrives — dot grid, node cards, the floating chrome — so the swap
 * is a fill-in rather than a jump.
 */
export function CanvasSkeleton({ label = "Loading canvas…" }: { label?: string }) {
  return (
    <div className="canvas-skeleton">
      <SkeletonStatus label={label} />
      <div className="canvas-skeleton-grid" aria-hidden="true" />
      {/* Every kind=canvas has at least one Page, so the rail is certain to
          arrive and take 284px off the left. Standing in for it here is
          what keeps the whole canvas from sliding sideways on arrival. */}
      <div className="canvas-skeleton-rail" aria-hidden="true">
        <span className="skeleton-bar skeleton-bar-title" />
        <span className="skeleton-bar skeleton-bar-meta" />
      </div>
      <div className="canvas-skeleton-nodes" aria-hidden="true">
        <div className="canvas-skeleton-node canvas-skeleton-node-a" />
        <div className="canvas-skeleton-node canvas-skeleton-node-b" />
        <div className="canvas-skeleton-node canvas-skeleton-node-c" />
      </div>
      <div className="canvas-skeleton-dock" aria-hidden="true" />
    </div>
  );
}

export function CardGridSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <>
      <SkeletonStatus label="Loading canvases…" />
      <div className="canvas-grid" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder, never reordered
          <div key={i} className="canvas-card skeleton-card">
            <div className="skeleton-thumb" />
            <span className="skeleton-bar skeleton-bar-title" />
            <span className="skeleton-bar skeleton-bar-meta" />
          </div>
        ))}
      </div>
    </>
  );
}
