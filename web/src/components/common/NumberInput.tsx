import { useEffect, useRef, useState } from 'react';
import { parseEntry } from '../../prefs/entryValue';

/** Round for display only: trims unit-conversion float noise (e.g. 0.1 + 0.2).
 *  The value the parent stores keeps whatever precision the user actually typed. */
const fmt = (v: number) => String(Number(v.toFixed(6)));

/**
 * What a typed field value means: a finite number clamped to the declared
 * bounds, or `null` for "no value".
 *
 * A thin name over `parseEntry` (prefs/entryValue), which is the app's one rule
 * for what a data entry may store. Kept exported here because this is where
 * callers look for it, and because a rendered test cannot reach every case: a
 * browser hands a `type="number"` input's handler an empty value, with
 * `validity.badInput` set, for any text that is not a valid number, while jsdom
 * delivers the raw string.
 *
 * The clamp is here because the HTML `min`/`max` are only spinner hints: a
 * typed-in out-of-range value would otherwise reach the live engine rebuild.
 *
 * This guards the entry. A field whose value is unit-converted before storage
 * must also guard the conversion, because a finite entry is not a finite stored
 * value - that is `FieldUnit.toSi`, and the same module backs both.
 */
export const parseFieldValue = parseEntry;

/** Report a commit-on-blur draft: a blank box as cleared, a refused entry not at all. */
const reportDraft = (
  draft: string,
  min: number | undefined,
  max: number | undefined,
  onChange: (v: number | null) => void,
) => {
  if (draft.trim() === '') onChange(null);
  else {
    const v = parseFieldValue(draft, min, max);
    if (v !== null) onChange(v);
  }
};

/**
 * Controlled numeric <input> that doesn't fight the user's keystrokes.
 *
 * While focused it renders a raw text buffer, so typing "2.", momentarily
 * clearing the field, or entering many decimals survives instead of being
 * normalized away on every render (a rounded `value` plus a parse-or-0
 * round-trip would truncate decimals and snap a cleared field to 0).
 * `onChange` still fires live (with the parsed number, or null for an empty
 * field) so canvas previews stay responsive; `onCommit`
 * fires on blur to close the undo entry. When blurred it shows the canonical,
 * noise-trimmed value from the prop.
 */
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
   * UnitChip, and a wrapping label's accessible name is its whole subtree, so
   * without this the chip's selected symbol glues itself onto every field name
   * ("Length mm"), and the name changes whenever the unit does.
   */
  ariaLabel?: string;
  /**
   * Report the typed value once, on blur or Enter, instead of on every
   * keystroke: for a field whose every value costs something to apply (the
   * aero sweep runs the kernel; a settings write hits storage). A visit that
   * typed nothing reports nothing. A field unmounted mid-edit (its dialog
   * closed on Escape) reports what was typed: React fires no blur for a
   * removed node.
   */
  commitOnBlur?: boolean;
}) {
  // null ⇒ not editing: mirror the prop. A string ⇒ the in-progress keystrokes.
  const [draft, setDraft] = useState<string | null>(null);
  const edited = useRef(false);
  const blank = value === null || value === undefined || Number.isNaN(value);
  // Malformed text was in the box during this edit. Emptying the box after it
  // fires no change event (the browser reported '' both times), so the blur
  // reports the cleared field instead.
  const sawBadInput = useRef(false);
  // What the edit has left to report, as of the last render: read by the
  // unmount cleanup as well as the blur.
  const props = { commitOnBlur, draft, min, max, blank, onChange, onCommit };
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const report = (el: HTMLInputElement, p: typeof props) => {
    const clearedAfterBad = sawBadInput.current && !el.validity.badInput && el.value.trim() === '';
    sawBadInput.current = false;
    if (clearedAfterBad && !p.blank) p.onChange(null);
    // A malformed entry reads as '' in the browser; reporting it would clear the field.
    else if (p.commitOnBlur && edited.current && p.draft !== null && !el.validity.badInput)
      reportDraft(p.draft, p.min, p.max, p.onChange);
    edited.current = false;
  };
  const commit = (el: HTMLInputElement) => {
    report(el, props);
    setDraft(null);
    onCommit?.();
  };
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Taken now: React has detached the ref by the time the cleanup runs.
    const el = input.current;
    return () => {
      if (!el || !(edited.current || sawBadInput.current)) return;
      report(el, latest.current);
      latest.current.onCommit?.();
    };
    // `report` reads only refs and its arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      ref={input}
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
      // would put that whole tail into the box the moment it is focused. The
      // blurred display already trims it; the draft must start from the same
      // text the user was looking at.
      onFocus={() => setDraft(blank ? '' : fmt(value))}
      onChange={(e) => {
        // Text the browser cannot read as a number ("-", "1e", "1,5" where the
        // locale takes no comma, "1e999") arrives as '' with `badInput` set.
        // It is not a cleared field: callers store `null` as a cleared field
        // and an optional field turns it into 0, so nothing is reported. The
        // draft takes the '' the browser reports, which React sees as the
        // box's current value, so a re-render leaves the typed text in place.
        if (e.target.validity.badInput) {
          sawBadInput.current = true;
          setDraft('');
          return;
        }
        const raw = e.target.value;
        setDraft(raw);
        if (commitOnBlur) {
          edited.current = true;
          return;
        }
        // A blank box is a real edit and is reported as such. Text that
        // `parseFieldValue` refuses commits nothing, for the same reason as
        // `badInput` above; the browser has already turned most such text
        // into `badInput`, but the value string is not guaranteed to parse.
        if (raw.trim() === '') {
          onChange(null);
          return;
        }
        const v = parseFieldValue(raw, min, max);
        if (v === null) return;
        onChange(v);
      }}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={commitOnBlur ? (e) => e.key === 'Enter' && commit(e.currentTarget) : undefined}
    />
  );
}
