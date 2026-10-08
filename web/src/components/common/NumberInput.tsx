import { useRef, useState } from 'react';
import { parseEntry } from '../../prefs/entryValue';

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
 * A thin name over `parseEntry` (prefs/entryValue), which is the app's one rule
 * for what a data entry may store. Kept exported here because this is where
 * callers look for it, and because the DOM cannot be trusted to exercise the
 * overflow case: jsdom refuses to deliver "1e999" to a `type="number"` input at
 * all, so a rendered test of it passes for the wrong reason.
 *
 * The clamp is here because the HTML `min`/`max` are only spinner hints: a
 * typed-in out-of-range value would otherwise reach the live engine rebuild.
 *
 * This guards the ENTRY. A field whose value is unit-converted before storage
 * must also guard the CONVERSION, because a finite entry is not a finite stored
 * value - that is `FieldUnit.toSi`, and the same module backs both.
 */
export const parseFieldValue = parseEntry;

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
  invalid,
  commitOnBlur = false,
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
   * The value in the box is not acceptable, for a reason the input itself
   * cannot see - a wind level sharing its altitude with another row. Says so
   * to a screen reader, which a red ring on its own does not.
   */
  invalid?: boolean;
  /**
   * Names the input explicitly. A field row is a <label> that also holds the
   * UnitChip, and a wrapping label's accessible name is its whole subtree — so
   * without this the chip's selected symbol glues itself onto every field name
   * ("Length mm"), and the name changes whenever the unit does.
   */
  ariaLabel?: string;
  /**
   * Report the typed value once, on blur or Enter, instead of on every
   * keystroke: for a field whose every value costs something to apply (the
   * aero sweep runs the kernel; a settings write hits storage). A visit that
   * typed nothing reports nothing.
   */
  commitOnBlur?: boolean;
}) {
  // null ⇒ not editing: mirror the prop. A string ⇒ the in-progress keystrokes.
  const [draft, setDraft] = useState<string | null>(null);
  const edited = useRef(false);
  const commit = () => {
    if (commitOnBlur && edited.current && draft !== null) {
      if (draft.trim() === '') onChange(null);
      else {
        const v = parseFieldValue(draft, min, max);
        if (v !== null) onChange(v);
      }
    }
    edited.current = false;
    setDraft(null);
    onCommit?.();
  };
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
      aria-invalid={invalid || undefined}
      value={draft ?? (blank ? '' : fmt(value))}
      // `fmt`, not `String`: the prop is usually a unit conversion, so a
      // stored 0.3 m arrives here as 0.30000000000000004 in cm, and String()
      // put that whole tail into the box the moment it was focused. The
      // blurred display already trims it; the draft must start from the same
      // text the user was looking at.
      onFocus={() => setDraft(blank ? '' : fmt(value))}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (commitOnBlur) {
          edited.current = true;
          return;
        }
        // A BLANK box is a real edit and is reported as such. Text that is not
        // a storable number - "abc", a lone "-" or ".", or a value finite only
        // as typed ("1e999") - commits NOTHING instead, because `null` used to
        // mean both and every optional field turned it into 0. That is how a
        // refused overflow became a stored zero, and how a leading "-" snapped
        // a freeform fin vertex to the origin on the way to a negative number.
        // The draft text keeps showing what was typed either way.
        if (raw.trim() === '') {
          onChange(null);
          return;
        }
        const v = parseFieldValue(raw, min, max);
        if (v === null) return;
        onChange(v);
      }}
      onBlur={commit}
      onKeyDown={commitOnBlur ? (e) => e.key === 'Enter' && commit() : undefined}
    />
  );
}
