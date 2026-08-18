import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";

/*
 * The app's one button. `btn btn-ghost btn-sm` plus a hand-placed 14px
 * Lucide icon was copy-pasted across nineteen call sites, which is why the
 * icon size, the aria-hidden on it, and the gap between icon and label had
 * all drifted apart. The class strings it emits are unchanged.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  /** Breaks something outside the app rather than destroying data. */
  | "warning"
  /** Google's own branding, not this app's palette — see styles.css. */
  | "google";

export type ButtonSize = "sm" | "md";

/** Mirrors --app-icon-sm / --app-icon-md. */
const ICON_PX: Record<ButtonSize, number> = { sm: 14, md: 16 };

interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconEnd?: LucideIcon;
  className?: string;
  children?: ReactNode;
}

function classNameFor({ variant = "secondary", size = "md", className }: ButtonLook) {
  return ["btn", `btn-${variant}`, size === "sm" && "btn-sm", className].filter(Boolean).join(" ");
}

function Content({ icon: Icon, iconEnd: IconEnd, size = "md", children }: ButtonLook) {
  const px = ICON_PX[size];
  return (
    <>
      {Icon && <Icon size={px} aria-hidden="true" />}
      {children}
      {IconEnd && <IconEnd size={px} aria-hidden="true" />}
    </>
  );
}

export interface ButtonProps
  extends ButtonLook,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> {
  /** Disables and marks the button busy. The caller owns the label swap. */
  busy?: boolean;
  /** React 19 passes `ref` as an ordinary prop; the DOM attribute types don't
      declare it, so it's declared here. ConfirmButton needs it to move focus
      between its armed and resting trees. */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant,
  size,
  icon,
  iconEnd,
  className,
  children,
  busy,
  disabled,
  // Defaulted, because a <button> inside a <form> without it submits — the
  // failure mode is silent and only shows up on the one surface that has a
  // form around the button.
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNameFor({ variant, size, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      <Content icon={icon} iconEnd={iconEnd} size={size}>
        {children}
      </Content>
    </button>
  );
}

/**
 * A button that navigates. `to` routes in-app; `href` leaves the app and
 * gets `target="_blank"` plus the rel that stops the new tab reaching back
 * through `window.opener`.
 */
export type ButtonLinkProps = ButtonLook & {
  title?: string;
  "aria-label"?: string;
  onClick?: () => void;
} & ({ to: string; href?: undefined } | { href: string; to?: undefined });

export function ButtonLink({
  variant,
  size,
  icon,
  iconEnd,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const content = (
    <Content icon={icon} iconEnd={iconEnd} size={size}>
      {children}
    </Content>
  );
  const look = classNameFor({ variant, size, className });

  if (rest.to !== undefined) {
    const { to, href: _href, ...anchor } = rest;
    return (
      <Link to={to} className={look} {...anchor}>
        {content}
      </Link>
    );
  }

  const { href, to: _to, ...anchor } = rest;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={look} {...anchor}>
      {content}
    </a>
  );
}
