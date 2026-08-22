import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { Link } from "react-router-dom";

/*
 * A control whose whole content is an icon. The label is required and not
 * optional-with-a-default: every one of these was hand-written with its own
 * aria-label, its own icon size, and its own aria-hidden — and the ones that
 * forgot the label were unusable with a screen reader.
 */

interface IconControl {
  icon: LucideIcon;
  /** Accessible name — the full one, e.g. "Open canvas details". */
  label: string;
  /**
   * Visible copy beside the icon, where there is room for it. Kept separate
   * from `label` because the two are not the same string: the control says
   * "Details" and means "Open canvas details". It has to be a prefix or
   * substring of `label` (WCAG 2.5.3, label in name) so that saying what is
   * on screen actually activates the control.
   */
  text?: string;
  /** Lucide's `size`, in px. */
  iconSize?: number;
  className?: string;
}

function Content({ icon: Icon, text, iconSize = 16 }: IconControl) {
  return (
    <>
      <Icon size={iconSize} aria-hidden="true" />
      {text && <span>{text}</span>}
    </>
  );
}

export interface IconButtonProps
  extends IconControl,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> {
  /*
   * React 19 passes `ref` to function components as an ordinary prop, so
   * this only has to be declared, not forwarded. Needed by controls that
   * own a popup and have to put focus back on themselves when it closes.
   */
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  text,
  iconSize,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button type={type} className={className} aria-label={label} {...rest}>
      <Content icon={icon} label={label} text={text} iconSize={iconSize} />
    </button>
  );
}

export interface IconLinkProps extends IconControl {
  to: string;
  title?: string;
}

export function IconLink({ icon, label, text, iconSize, className, to, title }: IconLinkProps) {
  return (
    <Link to={to} className={className} aria-label={label} title={title}>
      <Content icon={icon} label={label} text={text} iconSize={iconSize} />
    </Link>
  );
}
