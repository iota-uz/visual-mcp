import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { Link } from "react-router-dom";

/*
 * A control whose whole content is an icon. The label is required and not
 * optional-with-a-default: every one of these was hand-written with its own
 * aria-label, its own icon size, and its own aria-hidden — and the ones that
 * forgot the label were unusable with a screen reader.
 */

interface IconControl {
  icon: LucideIcon;
  /** Accessible name. Rendered as text too when `showLabel` is set. */
  label: string;
  /** Show the label beside the icon, as the two Details triggers do. */
  showLabel?: boolean;
  /** Lucide's `size`, in px. */
  iconSize?: number;
  className?: string;
}

function Content({ icon: Icon, label, showLabel, iconSize = 16 }: IconControl) {
  return (
    <>
      <Icon size={iconSize} aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </>
  );
}

export interface IconButtonProps
  extends IconControl,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> {}

export function IconButton({
  icon,
  label,
  showLabel,
  iconSize,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={className}
      // Kept even when the label is visible: the visible copy is a shortened
      // form ("Details") of what the control actually does ("Open canvas
      // details"), and callers pass the long form.
      aria-label={label}
      {...rest}
    >
      <Content icon={icon} label={label} showLabel={showLabel} iconSize={iconSize} />
    </button>
  );
}

export interface IconLinkProps extends IconControl {
  to: string;
  title?: string;
}

export function IconLink({
  icon,
  label,
  showLabel,
  iconSize,
  className,
  to,
  title,
}: IconLinkProps) {
  return (
    <Link to={to} className={className} aria-label={label} title={title}>
      <Content icon={icon} label={label} showLabel={showLabel} iconSize={iconSize} />
    </Link>
  );
}
