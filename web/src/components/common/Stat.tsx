/** A compact labeled stat tile (value + unit/sub), used by the stability and sim panels.
 *  `card` wraps the tile in its own surface (mmrocket-style one-card-per-stat).
 *  `sub` is a node, not just text, so a tile can put a UnitChip in its unit slot
 *  and let the unit be changed from where it is read. */
export function Stat({
  label,
  value,
  sub,
  tone = 'text-slate-100',
  card = false,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  tone?: string;
  card?: boolean;
}) {
  // The carded tiles are the rocket's static-stats strip: a dozen of them read
  // side by side, where what you are looking for matters as much as the number
  // itself. So its label and unit lines run a step larger and the value a step
  // smaller than the default — a flatter scale that scans as a set. The plain
  // tiles stay as they were: they sit in dense dialog grids where the number is
  // the point and the vertical room is tighter.
  //
  // `text-xs` and not an arbitrary size: the sub line usually holds a UnitChip,
  // which sets its own `text-xs` because it is a <select> and form controls do
  // not inherit the page font. Anything else here leaves the unit a pixel off
  // the label above it.
  const labelClass = card ? 'text-xs' : 'text-[10px]';
  const valueClass = card ? 'text-base' : 'text-lg';
  const subClass = card ? 'text-xs' : 'text-[10px]';
  return (
    <div className={`text-center ${card ? 'rounded-lg bg-slate-800/60 px-2 py-1.5 ring-1 ring-white/10' : ''}`}>
      <div className={`${labelClass} uppercase tracking-wide text-slate-400`}>{label}</div>
      <div className={`${valueClass} font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className={`${subClass} text-slate-500`}>{sub}</div>
    </div>
  );
}
