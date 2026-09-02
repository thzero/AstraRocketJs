// The slider thumbs sit above a custom track; each native range input is
// transparent with only its thumb clickable, so the two overlap cleanly.
const THUMB =
  'pointer-events-none absolute inset-x-0 top-0 m-0 h-5 w-full cursor-pointer appearance-none bg-transparent focus:outline-none'
  + ' [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-400 [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-slate-900'
  + ' [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-sky-400';

/** A two-thumb range slider over `count` discrete stops (OpenRocket-style). */
export function RangeSlider({ count, low, high, onChange, label }: {
  count: number; low: number; high: number; onChange: (lo: number, hi: number) => void; label: string;
}) {
  const pct = (i: number) => (i / (count - 1)) * 100;
  return (
    <div className="relative h-5 min-w-[120px] flex-1">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-700" />
      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-sky-500" style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }} />
      <input
        type="range" min={0} max={count - 1} step={1} value={low} aria-label={`${label} min`}
        onChange={(e) => onChange(Math.min(Number(e.target.value), high), high)}
        className={THUMB} style={{ zIndex: low >= high ? 5 : 3 }}
      />
      <input
        type="range" min={0} max={count - 1} step={1} value={high} aria-label={`${label} max`}
        onChange={(e) => onChange(low, Math.max(Number(e.target.value), low))}
        className={THUMB} style={{ zIndex: 4 }}
      />
    </div>
  );
}
