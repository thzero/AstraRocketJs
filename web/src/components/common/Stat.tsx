/** A compact labelled stat tile (value + unit/sub), used by the stability and sim panels. */
export function Stat({ label, value, sub, tone = 'text-slate-100' }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}
