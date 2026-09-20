import { useState } from 'react';

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
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <input
        type="number"
        value={draft ?? value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-16 rounded-md bg-slate-800 px-1.5 py-0.5 text-right text-[11px] tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
      />
      <span className="text-[10px] text-slate-600">{unit}</span>
    </label>
  );
}

export function Seg<T extends string | number | boolean>({
  options,
  value,
  onChange,
  fmt,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  fmt: (v: T) => string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-md ring-1 ring-white/10 ${disabled ? 'pointer-events-none opacity-40' : ''}`}
    >
      {options.map((o) => (
        <button
          key={String(o)}
          // `pointer-events-none` on the wrapper stops the mouse and nothing
          // else: without this the buttons stayed tabbable and Enter still
          // fired, so a "disabled" toggle could be flipped from the keyboard.
          disabled={disabled}
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`px-2 py-0.5 text-[11px] font-medium ${value === o ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}
