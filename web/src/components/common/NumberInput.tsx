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
/**
 * What a typed field value means: a finite number clamped to the declared
 * bounds, or `null` for "no value".
 *
 * Pure and exported because the DOM cannot be trusted to exercise it. jsdom
 * refuses to deliver "1e999" to a `type="number"` input at all, so a rendered
 * test of the overflow case passes for the wrong reason; the browser does
 * deliver it, and `parseFloat` returns `Infinity`.
 *
 * `Number.isFinite`, not just `!isNaN`: Infinity slipped through both the NaN
 * check and the clamp (`Infinity < min` is false, and most callers pass no
 * `max`). It reached the node, was persisted, exported to `.ork`, and read
 * back as `0` by `num()` - so the field showed Infinity while the geometry
 * behaved as if the dimension were simply absent.
 *
 * The clamp is here because the HTML `min`/`max` are only spinner hints: a
 * typed-in out-of-range value would otherwise reach the live engine rebuild.
 */
export function parseFieldValue(raw: string, min?: number, max?: number): number | null {
  const n = parseFloat(raw);
  if (raw === '' || !Number.isFinite(n)) return null;
  let v = n;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

export function NumberInput({
  value,
  onChange,
  onCommit,
  step,
  min,
  max,
  disabled,
  placeholder,
  className,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  onCommit?: () => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /**
   * Names the input explicitly. A field row is a <label> that also holds the
   * UnitChip, and a wrapping label's accessible name is its whole subtree — so
   * without this the chip's selected symbol glues itself onto every field name
   * ("Length mm"), and the name changes whenever the unit does.
   */
  ariaLabel?: string;
}) {
  // null ⇒ not editing: mirror the prop. A string ⇒ the in-progress keystrokes.
  const [draft, setDraft] = useState<string | null>(null);
  const blank = value === null || value === undefined || Number.isNaN(value);
  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      value={draft ?? (blank ? '' : fmt(value as number))}
      onFocus={() => setDraft(blank ? '' : String(value))}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        onChange(parseFieldValue(raw, min, max));
      }}
      onBlur={() => {
        setDraft(null);
        onCommit?.();
      }}
    />
  );
}
