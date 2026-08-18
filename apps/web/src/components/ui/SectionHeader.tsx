import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
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
  back,
  actions,
  as: Heading = "h2",
  className,
}: SectionHeaderProps) {
  return (
    <header className={["section-header", className].filter(Boolean).join(" ")}>
      {back && (
        <Link to={back.to} className="section-header-back">
          <ArrowLeft size={14} aria-hidden="true" /> {back.label}
        </Link>
      )}
      <div className="section-header-row">
        <Heading className="section-header-title">{title}</Heading>
        {actions && <div className="section-header-actions">{actions}</div>}
      </div>
      {subtitle && <p className="section-header-subtitle">{subtitle}</p>}
    </header>
  );
}
