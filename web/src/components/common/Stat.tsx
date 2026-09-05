/** A compact labelled stat tile (value + unit/sub), used by the stability and sim panels.
 *  `card` wraps the tile in its own surface (mmrocket-style one-card-per-stat). */
export function Stat({
  label,
  value,
  sub,
  tone = 'text-slate-100',
  card = false,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
  card?: boolean;
}) {
  return (
    <div className={`text-center ${card ? 'rounded-lg bg-slate-800/60 px-2 py-1.5 ring-1 ring-white/10' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}
