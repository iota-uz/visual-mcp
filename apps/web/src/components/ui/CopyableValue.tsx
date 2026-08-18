import type { ReactNode } from "react";
import { CopyButton } from "../CopyButton";

/*
 * A string the user has to get out of the screen intact — a canvas ref, the
 * MCP endpoint, a share link, a token, a shell command. There were four
 * hand-built versions of this row, differing only in whether the value was
 * boxed and what colour it sat on, and each one had drifted: two truncated,
 * two wrapped, one had no copy button at all until it was added by hand.
 */

export type CopyableAs =
  /** Bare and truncated, for a value inside something that is already a box. */
  | "code"
  /** Boxed and wrapping, for a command or a token you copy whole. */
  | "block"
  /** An anchor, for a URL that is also worth opening. */
  | "link";

export interface CopyableValueProps {
  value: string;
  as?: CopyableAs;
  /** Eyebrow above the row. */
  label?: ReactNode;
  /** Copy button label. Say what it copies — "Copy ref", not "Copy". */
  copyLabel?: string;
  /** Where `as="link"` points, if not `value` itself. */
  href?: string;
  className?: string;
}

export function CopyableValue({
  value,
  as = "code",
  label,
  copyLabel,
  href,
  className,
}: CopyableValueProps) {
  return (
    <div className={["copyable", `copyable-${as}`, className].filter(Boolean).join(" ")}>
      {label && <span className="copyable-label">{label}</span>}
      <div className="copyable-row">
        {as === "block" ? (
          <pre className="copyable-value">{value}</pre>
        ) : as === "link" ? (
          <a
            className="copyable-value"
            href={href ?? value}
            target="_blank"
            rel="noopener noreferrer"
          >
            {value}
          </a>
        ) : (
          <code className="copyable-value">{value}</code>
        )}
        <CopyButton value={value} label={copyLabel} />
      </div>
    </div>
  );
}

/**
 * The `workspace-slug/canvas-slug` ref an agent addresses a canvas by — the
 * product's primary key, and the one string you say back to an agent. It
 * lived on the canvas card and nowhere else, so on the page where you would
 * actually be asked "which canvas?" it had to be reconstructed by hand.
 */
export function RefChip({
  refValue,
  label,
  className,
}: {
  refValue: string;
  label?: ReactNode;
  className?: string;
}) {
  return (
    <CopyableValue
      value={refValue}
      as="code"
      label={label}
      copyLabel="Copy ref"
      className={className}
    />
  );
}
