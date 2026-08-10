import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, back, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      {back && (
        <Link to={back.to} className="page-header-back">
          <ArrowLeft size={14} /> {back.label}
        </Link>
      )}
      <div className="page-header-row">
        <h1 className="page-header-title">{title}</h1>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
    </header>
  );
}
