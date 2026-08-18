import type { LucideIcon } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from "react";

/*
 * Form controls. Every input in the app carried its own visually-hidden
 * <label> paired to a hand-written id, and the search field additionally
 * hand-placed an icon and a clear button absolutely inside a wrapper. The
 * label is a required prop here so a control can't ship without one.
 */

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> {
  id: string;
  /** Accessible name. Hidden unless `labelVisible`. */
  label: string;
  labelVisible?: boolean;
  /** Sits inside the field's left edge; the field pads itself to clear it. */
  leadingIcon?: LucideIcon;
  /** Sits inside the right edge — a clear button, a unit, a spinner. */
  trailingSlot?: ReactNode;
  /** Class for the field wrapper, not the input. */
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/*
 * A visible label has to sit *above* its control, so it and the control are
 * wrapped together — otherwise a flex-row container lays the two out side
 * by side. A hidden label needs no wrapper: `.visually-hidden` takes it out
 * of flow, so the field stays the container's direct child and keeps
 * whatever flex behaviour that container gave it.
 */
function Labelled({
  id,
  label,
  labelVisible,
  children,
}: {
  id: string;
  label: string;
  labelVisible?: boolean;
  children: ReactNode;
}) {
  const labelEl = (
    <label className={labelVisible ? "field-label" : "visually-hidden"} htmlFor={id}>
      {label}
    </label>
  );
  if (!labelVisible) {
    return (
      <>
        {labelEl}
        {children}
      </>
    );
  }
  return (
    <div className="field-group">
      {labelEl}
      {children}
    </div>
  );
}

export function TextInput({
  id,
  label,
  labelVisible,
  leadingIcon: LeadingIcon,
  trailingSlot,
  className,
  inputRef,
  ...rest
}: TextInputProps) {
  return (
    <Labelled id={id} label={label} labelVisible={labelVisible}>
      {/* The icon and the trailing slot are positioned against this
          wrapper, not against whatever block contains the field — anchored
          to the block they slid to the vertical middle of the results list
          below it. */}
      <div className={["field", className].filter(Boolean).join(" ")}>
        {LeadingIcon && <LeadingIcon className="field-icon" size={14} aria-hidden="true" />}
        <input id={id} ref={inputRef} {...rest} />
        {trailingSlot}
      </div>
    </Labelled>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

/** Label-wrapped, so the whole row is the hit target. */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={["checkbox", className].filter(Boolean).join(" ")}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  id: string;
  label: string;
  labelVisible?: boolean;
  options: Array<{ value: string; label: string }>;
}

export function Select({ id, label, labelVisible, options, className, ...rest }: SelectProps) {
  return (
    <Labelled id={id} label={label} labelVisible={labelVisible}>
      <select id={id} className={["field-select", className].filter(Boolean).join(" ")} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Labelled>
  );
}
