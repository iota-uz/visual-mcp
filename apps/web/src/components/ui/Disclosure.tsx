import type { ReactNode } from "react";

export interface DisclosureProps {
  summary: ReactNode;
  /**
   * Initial state only, and deliberately passed straight through to the
   * `open` attribute rather than held in state: the connect instructions
   * open themselves while the account has nothing in it, and the user must
   * still be able to fold them away.
   */
  open?: boolean;
  className?: string;
  children: ReactNode;
}

export function Disclosure({ summary, open, className, children }: DisclosureProps) {
  return (
    <details className={["disclosure", className].filter(Boolean).join(" ")} open={open}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
