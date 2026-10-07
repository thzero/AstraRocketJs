import { NumberInput } from '../common/NumberInput';

/**
 * The small controls on the AeroAnalysis header: the flight-condition number
 * boxes and the segmented toggles (pane, Max Mach, CP unit). Presentation
 * only; the values they edit live in the pane.
 */

/**
 * One flight-condition input. A number box rather than a slider: these are
 * values you know and type (a 4-degree angle of attack, a 20 rad/s roll), not
 * ones you scrub for, and the Worst button writes an exact figure into one.
 */
export function Num({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  // Committed on blur or Enter, not per keystroke.
  //
  // These three drive `sweep`, a 48-to-50 sample `rocket.aeroSweep()` with a
  // full per-component force analysis. It now runs deferred from an effect
  // with a busy state, but it is still a synchronous kernel call on the main
  // thread: firing it on every keystroke meant typing "12" ran two complete
  // sweeps back to back, and the panel visibly stalled on a multi-stage
  // design. The draft keeps the box responsive while you type; the same
  // commit-on-blur shape `NumberInput.onCommit` uses elsewhere.
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] text-ink-faint">{label}</span>
      <NumberInput
        commitOnBlur
        value={value}
        min={min}
        max={max}
        step={step}
        ariaLabel={label}
        // An emptied box commits nothing: the box falls back to what it had.
        onChange={(v) => v !== null && onChange(v)}
        className="w-16 rounded-md bg-raised px-1.5 py-0.5 text-right text-[11px] tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
      />
      <span className="text-[10px] text-ink-dim">{unit}</span>
    </label>
  );
}
