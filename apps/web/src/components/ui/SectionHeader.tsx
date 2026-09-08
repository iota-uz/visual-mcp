import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
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
}

export function SectionHeader({
  title,
  subtitle,
  crumbs,
  actions,
  as: Heading = "h2",
  className,
}: SectionHeaderProps) {
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
        <Heading className="section-header-title">{title}</Heading>
        {actions && <div className="section-header-actions">{actions}</div>}
      </div>
      {subtitle && <p className="section-header-subtitle">{subtitle}</p>}
    </header>
  );
}
