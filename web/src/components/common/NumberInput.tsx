import { useState } from 'react';

/** Round for DISPLAY only — trims unit-conversion float noise (e.g. 0.1 + 0.2).
 *  The value the parent stores keeps whatever precision the user actually typed. */
const fmt = (v: number) => String(Number(v.toFixed(6)));

/**
 * Controlled numeric <input> that doesn't fight the user's keystrokes.
 *
 * While focused it renders a raw text buffer, so typing "2.", momentarily
 * clearing the field, or entering many decimals survives instead of being
 * normalized away on every render (the old `value={+v.toFixed(4)}` +
 * `parseFloat(...) || 0` round-trip truncated >4 decimals and snapped a cleared
 * field to 0). `onChange` still fires live — with the parsed number, or null for
 * an empty/unparseable field — so canvas previews stay responsive; `onCommit`
 * fires on blur to close the undo entry. When blurred it shows the canonical,
 * noise-trimmed value from the prop.
 */
export function NumberInput({
  value, onChange, onCommit, step, min, disabled, placeholder, className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  onCommit?: () => void;
  step?: number;
  min?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  // null ⇒ not editing: mirror the prop. A string ⇒ the in-progress keystrokes.
  const [draft, setDraft] = useState<string | null>(null);
  const blank = value === null || value === undefined || Number.isNaN(value);
  return (
    <input
      type="number" step={step} min={min} disabled={disabled}
      placeholder={placeholder} className={className}
      value={draft ?? (blank ? '' : fmt(value as number))}
      onFocus={() => setDraft(blank ? '' : String(value))}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = parseFloat(raw);
        onChange(raw === '' || Number.isNaN(n) ? null : n);
      }}
      onBlur={() => { setDraft(null); onCommit?.(); }}
    />
  );
}
