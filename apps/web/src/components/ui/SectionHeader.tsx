import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { RenameForm } from "../RenameForm";

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

  if (editing) {
    return (
      <Heading className="section-header-title is-editing">
        <RenameForm
          initial={title}
          label={renameLabel}
          onSave={onRename}
          onDone={() => setEditing(false)}
        />
      </Heading>
    );
  }

  return (
    <Heading className="section-header-title">
      <button
        type="button"
        className="section-header-rename-hit"
        title="Double-click to rename"
        onDoubleClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "F2" || event.key === " ") {
            event.preventDefault();
            setEditing(true);
          }
        }}
      >
        {title}
      </button>
    </Heading>
  );
}
