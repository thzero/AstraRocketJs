import type { ReactNode } from 'react';
import { FieldLabel, markRing } from './FieldMark';
import { NumberInput } from './NumberInput';

/** The row's placeholder, its notes and markers, and its change handler: what a
 *  wrapper around {@link NumberRow} passes through unchanged. */
export interface NumberRowMarks {
  placeholder?: string;
  /** Why the field stops where it does. Rendered under the row. */
  hint?: string;
  /** A value that is allowed but probably wrong. Rendered under the row, in amber. */
  caution?: string;
  /**
   * The simulations being edited together do not agree on this field. The box
   * shows the active one's value, so without the marker a bulk edit would
   * flatten the others' values with nothing on screen to say so.
   */
  mixed?: boolean;
  /** A launch field a flight cannot be computed without. Marked always. */
  required?: boolean;
  /** ...and it is currently empty, which blocks the run. */
  missing?: boolean;
  onChange: (v: number | null) => void;
}

/**
 * A labeled number field: label (with the required, missing and mixed markers),
 * the input, its unit, and an optional hint under the row. The one row the
 * launch panel, the tools, the simulation editor's overrides and Settings all
 * use.
 */
export function NumberRow({
  label,
  unit,
  value,
  step = 1,
  min,
  max,
  placeholder,
  hint,
  caution,
  mixed,
  required,
  missing,
  onChange,
  onCommit,
  commitOnBlur,
  labelClassName,
}: {
  label: string;
  unit?: ReactNode;
  value: number | null;
  step?: number;
  min?: number;
  /** NumberInput clamps against this; without it a field is unbounded above. */
  max?: number;
  /** Blur: closes the undo entry a run of live edits opened. */
  onCommit?: () => void;
  /** `onChange` fires once, on blur, instead of per keystroke (`NumberInput`). */
  commitOnBlur?: boolean;
  /** The label's typography, for a row set among larger text. */
  labelClassName?: string;
} & NumberRowMarks) {
  if (hint || caution) {
    return (
      <div>
        <NumberRow
          label={label}
          unit={unit}
          value={value}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          mixed={mixed}
          required={required}
          missing={missing}
          onChange={onChange}
          onCommit={onCommit}
          commitOnBlur={commitOnBlur}
          labelClassName={labelClassName}
        />
        {hint && <p className="mt-0.5 pr-24 text-[11px] leading-snug text-ink-faint">{hint}</p>}
        {caution && <p className="mt-0.5 text-[11px] leading-snug text-warn-300">{caution}</p>}
      </div>
    );
  }
  return (
    <label className="flex items-center justify-between gap-3">
      <FieldLabel text={label} required={required} missing={missing} mixed={mixed} className={labelClassName} />
      <span className="flex items-center gap-1">
        <NumberInput
          ariaLabel={label}
          value={value}
          /* An empty required box writes nothing, so the field simply keeps what
             it had. Not a focus trap -- tabbing away still works, which a trap
             would forbid (WCAG 2.1.2) and which would fight anyone clearing a
             field to retype it. NumberInput holds its own draft string while
             focused, so the box still looks empty as you type; only the commit
             is withheld. An imported .ork that omits the field still arrives
             blank, which is what the marker and the run gate are for. */
          onChange={(v) => (v === null && required ? undefined : onChange(v))}
          onCommit={onCommit}
          commitOnBlur={commitOnBlur}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          className={markRing(
            'w-24 rounded-md bg-raised px-2 py-1 text-right text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500',
            missing,
            mixed,
          )}
        />
        {unit && <span className="min-w-10 text-xs text-ink-faint">{unit}</span>}
      </span>
    </label>
  );
}
