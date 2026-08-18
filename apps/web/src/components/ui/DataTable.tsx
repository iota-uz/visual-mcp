import type { ReactNode } from "react";

/*
 * A table, with the two things every hand-written one in this app was
 * missing: an accessible name, and a horizontal scroll container that
 * doesn't clip. Deliberately not a generic `DataTable<T>` with a column
 * config — there is one table here, and a config engine would bury the
 * armed-confirmation cell that is the interesting part of it.
 */

export interface DataTableProps {
  /** The table's accessible name. Hidden unless `captionVisible`. */
  caption: string;
  captionVisible?: boolean;
  /** The `<tr>` of `<th>`s. */
  head: ReactNode;
  className?: string;
  children: ReactNode;
}

export function DataTable({ caption, captionVisible, head, className, children }: DataTableProps) {
  return (
    <div className={["table-wrap", className].filter(Boolean).join(" ")}>
      <table className="data-table">
        <caption className={captionVisible ? "data-table-caption" : "visually-hidden"}>
          {caption}
        </caption>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
