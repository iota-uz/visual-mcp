import type { ReactNode } from "react";

/*
 * A bordered surface holding one thing. Four of these were written out
 * separately — the connect instructions, the version list, the post-mint
 * reveal, the kitchen-sink sections — with three different radii between
 * them.
 */

export type PanelTone = "plain" | "accent" | "warning";

export interface PanelProps {
  tone?: PanelTone;
  /** `section` when the panel has a heading; `div` when it is just a box. */
  as?: "section" | "div";
  className?: string;
  children: ReactNode;
}

export function Panel({ tone = "plain", as: As = "div", className, children }: PanelProps) {
  return (
    <As
      className={["panel", tone !== "plain" && `panel-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </As>
  );
}
