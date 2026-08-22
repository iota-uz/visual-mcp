import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  /*
   * A recovery control — Retry, mostly. Kept out of `hint` because that
   * renders as a paragraph: a button folded into it sat inline with the
   * error text, reading as part of the sentence rather than as the way
   * out of it.
   */
  action?: ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon className="empty-state-icon" size={28} strokeWidth={1.5} />
      <p className="empty-state-title">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
