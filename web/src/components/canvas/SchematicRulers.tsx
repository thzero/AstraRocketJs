import { useUnits } from '../../prefs/useUnits';

/**
 * The TreeSchematic measuring frame: one length (horizontal) ruler drawn on
 * the top or bottom edge and one radial (vertical) ruler on the left or right.
 * The graduations they draw come from `rulerGraduations` in
 * schematicGeometry.ts (memoized by the schematic); this file is the markup.
 * Both are `pointerEvents="none"` so they never take a click from the drawing.
 */

/**
 * One length (horizontal) ruler: faint minor subdivisions + bold labeled
 * majors. `dir` points the ticks away from the drawing (down at the bottom
 * edge, up at the top). Drawn on both edges for a full measuring frame.
 */
export function LengthRuler({
  baseY,
  dir,
  labelY,
  unitY,
  x0,
  x1,
  ctxX0,
  scale,
  rulerStep,
  rulerDigits,
  marks,
  minorMarks,
}: {
  baseY: number;
  dir: 1 | -1;
  labelY: number;
  unitY: number;
  /** Where the baseline starts and ends (viewBox px). */
  x0: number;
  x1: number;
  /** The datum: model 0 (the nose tip) in viewBox px. */
  ctxX0: number;
  scale: number;
  rulerStep: number;
  rulerDigits: number;
  /** Labeled majors and their minor subdivisions, in model meters. */
  marks: number[];
  minorMarks: number[];
}) {
  const u = useUnits();
  return (
    <g pointerEvents="none">
      <line x1={x0} y1={baseY} x2={x1} y2={baseY} className="stroke-white/55" />
      {minorMarks.map((m, i) => {
        const x = ctxX0 + m * scale;
        const medium = Math.abs(((((m / rulerStep) % 1) + 1) % 1) - 0.5) < 0.02;
        return (
          <line
            key={`n${i}`}
            x1={x}
            y1={baseY}
            x2={x}
            y2={baseY + dir * (medium ? 10 : 7)}
            className={medium ? 'stroke-white/80' : 'stroke-white/60'}
          />
        );
      })}
      {marks.map((m, i) => {
        const x = ctxX0 + m * scale;
        return (
          <g key={i}>
            <line x1={x} y1={baseY} x2={x} y2={baseY + dir * 12} className="stroke-white/90" strokeWidth={1.5} />
            <text x={x} y={labelY} textAnchor="middle" className="fill-slate-100 text-[8px] tabular-nums">
              {u.fmt('length', m, rulerDigits)}
            </text>
          </g>
        );
      })}
      <text x={x1} y={unitY} textAnchor="end" data-ruler-unit className="fill-slate-300 text-[9px] font-medium">
        {u.sym('length')}
      </text>
    </g>
  );
}

/**
 * One radial (vertical) ruler: same treatment; `dir` points the ticks into the
 * side lane (away from the drawing) so the numbers sit clear of the airframe.
 */
export function RadialRuler({
  baseX,
  dir,
  labelX,
  anchor,
  frameTopY,
  frameBotY,
  vTop,
  scale,
  rulerStep,
  rulerDigits,
  ticks,
  minorTicks,
}: {
  baseX: number;
  dir: 1 | -1;
  labelX: number;
  anchor: 'start' | 'end';
  /** Where the baseline starts and ends (viewBox px): the corners of the frame. */
  frameTopY: number;
  frameBotY: number;
  /** Where the graduations start (viewBox px). */
  vTop: number;
  scale: number;
  rulerStep: number;
  rulerDigits: number;
  /** Labeled majors (already placed) and their minor subdivisions (model meters). */
  ticks: { y: number; label: number }[];
  minorTicks: number[];
}) {
  const u = useUnits();
  return (
    <g pointerEvents="none">
      {/* Baseline runs corner-to-corner (to the top/bottom length-ruler baselines,
          or the viewport edge where that side's ruler is off) so the rulers close
          into one frame; the ticks stay in vTop..vBot. */}
      <line x1={baseX} y1={frameTopY} x2={baseX} y2={frameBotY} className="stroke-white/55" />
      {minorTicks.map((m, i) => {
        const y = vTop + m * scale;
        const medium = Math.abs(((((m / rulerStep) % 1) + 1) % 1) - 0.5) < 0.02;
        return (
          <line
            key={`n${i}`}
            x1={baseX}
            y1={y}
            x2={baseX + dir * (medium ? 10 : 7)}
            y2={y}
            className={medium ? 'stroke-white/80' : 'stroke-white/60'}
          />
        );
      })}
      {ticks.map((tk, i) => (
        <g key={i}>
          <line x1={baseX} y1={tk.y} x2={baseX + dir * 12} y2={tk.y} className="stroke-white/90" strokeWidth={1.5} />
          <text
            x={labelX}
            y={tk.y}
            textAnchor={anchor}
            dominantBaseline="central"
            className="fill-slate-100 text-[8px] tabular-nums"
          >
            {u.fmt('length', tk.label, rulerDigits)}
          </text>
        </g>
      ))}
      <text
        x={labelX}
        y={vTop - 6}
        textAnchor={anchor}
        data-ruler-unit
        className="fill-slate-300 text-[9px] font-medium"
      >
        {u.sym('length')}
      </text>
    </g>
  );
}
