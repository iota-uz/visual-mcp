import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  to: string;
  label: string;
}

export interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * The path down to this page, ancestors first. A trail rather than a
   * single Back link because the app nests three deep: a workspace's assets
   * used to offer one arrow, and it went to the workspace *list*, skipping
   * the workspace you were inside.
   */
  crumbs?: Crumb[];
  actions?: ReactNode;
  /**
   * The heading level. It matters: this used to be a hardcoded `<h1>`, and
   * the canvas drawer rendered one inside an `<aside>` — a second top-level
   * heading on a page that already had one.
   */
  as?: "h1" | "h2" | "h3";
  className?: string;
  /**
   * Double-click, Enter, or F2 on the title starts an in-place rename.
   * Ignored unless `title` is a string — a React node is not a name.
   */
  onRename?: (name: string) => Promise<unknown>;
  /** Accessible name of the rename field, e.g. "Workspace name". */
  renameLabel?: string;
}

export function SectionHeader({
  title,
  subtitle,
  crumbs,
  actions,
  as: Heading = "h2",
  className,
  onRename,
  renameLabel = "Name",
}: SectionHeaderProps) {
  const titleText = typeof title === "string" ? title : null;
  const canRename = Boolean(onRename && titleText !== null);

  return (
    <header className={["section-header", className].filter(Boolean).join(" ")}>
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="section-header-crumbs">
          <ol>
            {crumbs.map((crumb) => (
              <li key={crumb.to}>
                <Link to={crumb.to}>{crumb.label}</Link>
                <ChevronRight size={12} aria-hidden="true" />
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="section-header-row">
        {canRename && onRename && titleText !== null ? (
          <EditableHeading
            as={Heading}
            title={titleText}
            onRename={onRename}
            renameLabel={renameLabel}
          />
        ) : (
          <Heading className="section-header-title">{title}</Heading>
        )}
        {actions && <div className="section-header-actions">{actions}</div>}
      </div>
      {subtitle && <p className="section-header-subtitle">{subtitle}</p>}
    </header>
  );
}

function EditableHeading({
  as: Heading,
  title,
  onRename,
  renameLabel,
}: {
  as: "h1" | "h2" | "h3";
  title: string;
  onRename: (name: string) => Promise<unknown>;
  renameLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  const id = useId();

  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function startEdit() {
    if (busy) return;
    closed.current = false;
    setError(null);
    setValue(title);
    setEditing(true);
  }

  function cancel() {
    closed.current = true;
    setValue(title);
    setError(null);
    setEditing(false);
  }

  async function commit() {
    if (closed.current) return;
    const next = value.trim();
    if (!next || next === title) {
      cancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(next);
      closed.current = true;
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <Heading className="section-header-title is-editing">
        <input
          id={id}
          ref={inputRef}
          className="section-header-rename"
          aria-label={renameLabel}
          aria-invalid={error ? true : undefined}
          value={value}
          size={Math.max(8, value.length + 1)}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
        {error && <span className="error-text">{error}</span>}
      </Heading>
    );
  }

  return (
    <Heading className="section-header-title">
      <button
        type="button"
        className="section-header-rename-hit"
        title="Double-click to rename"
        onDoubleClick={startEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "F2" || event.key === " ") {
            event.preventDefault();
            startEdit();
          }
        }}
      >
        {title}
      </button>
    </Heading>
  );
}
