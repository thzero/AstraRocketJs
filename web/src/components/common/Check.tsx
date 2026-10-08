import type { ReactNode } from 'react';

/**
 * A checkbox with its label, the one form every dialog uses: the whole row is
 * the click target, a disabled row fades as a whole, and an optional hint sits
 * under it. `className` carries the row's text size and color; `align="start"`
 * keeps the box on the first line of a label that wraps.
 */
export function Check({
  checked,
  onChange,
  label,
  disabled,
  hint,
  className = 'text-sm text-ink-soft',
  align = 'center',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  /** Rendered under the row: for a setting that needs a sentence of why. */
  hint?: string;
  className?: string;
  align?: 'center' | 'start';
}) {
  const row = (
    <label
      className={`flex ${align === 'start' ? 'items-start' : 'items-center'} gap-2 ${className} ${disabled ? 'opacity-40' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={`accent-accent-500 ${align === 'start' ? 'mt-0.5' : ''}`}
      />
      {label}
    </label>
  );
  if (!hint) return row;
  return (
    <div>
      {row}
      <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{hint}</p>
    </div>
  );
}
