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
