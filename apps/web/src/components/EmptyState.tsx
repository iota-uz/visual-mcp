import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon className="empty-state-icon" size={28} strokeWidth={1.5} />
      <p className="empty-state-title">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
    </div>
  );
}
