import type { LucideIcon } from "lucide-react";

export type RadioCardOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: LucideIcon;
};

export function RadioCards<T extends string>({
  label,
  hint,
  name,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  name: string;
  value: T | "";
  options: RadioCardOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={["radio-cards", className].filter(Boolean).join(" ")} disabled={disabled}>
      <legend>{label}</legend>
      {hint && <p className="radio-cards-hint">{hint}</p>}
      <div className="radio-cards-options">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <label className="radio-card" key={option.value}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span className="radio-card-indicator" aria-hidden="true" />
              {Icon && <Icon className="radio-card-icon" size={17} strokeWidth={1.8} aria-hidden />}
              <span className="radio-card-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
