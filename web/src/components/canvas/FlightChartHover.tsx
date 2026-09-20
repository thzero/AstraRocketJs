import { fmtNum } from '../../i18n/format';
import { lerpAt } from '../../services/interpolate';

/**
 * Owns the per-panel hover readout: the crosshair line (the e2e suite
 * selects on its `data-crosshair`), one dot per stage at the hovered time,
 * and the inline value label when several stages share a panel. `hoverValue`
 * is the one rule for whether a stage reports a value at a time.
 */

/** What the readout needs of a drawn stage: its samples and its flight span. */
export interface HoverSeries {
  color: string;
  xs: number[];
  ys: number[];
  t0?: number;
  t1?: number;
}

/** A stage only reports a hovered value while its own flight is under way — a
 *  spent booster already on the ground must not show a flat clamped dot. */
function hoverValue(s: HoverSeries, hoverT: number): number | null {
  return s.t0 != null && s.t1 != null && hoverT >= s.t0 && hoverT <= s.t1 ? lerpAt(s.xs, s.ys, hoverT) : null;
}

export function PanelHover({
  hoverT,
  list,
  X,
  Y,
  top,
  bottom,
  single,
  digits,
}: {
  hoverT: number;
  list: HoverSeries[];
  X: (t: number) => number;
  Y: (v: number) => number;
  /** Plot-area y extent of the crosshair line. */
  top: number;
  bottom: number;
  /** One stage on this panel: the dot alone reads, so no inline value. */
  single: boolean;
  digits: number;
}) {
  return (
    <g pointerEvents="none">
      <line
        x1={X(hoverT)}
        y1={top}
        x2={X(hoverT)}
        y2={bottom}
        data-crosshair
        className="stroke-slate-300/40"
        vectorEffect="non-scaling-stroke"
      />
      {list.map((s, i) => {
        const hv = hoverValue(s, hoverT);
        if (hv == null) return null;
        return (
          <g key={i}>
            <circle cx={X(hoverT)} cy={Y(hv)} r={3} fill={s.color} />
            {!single && (
              <text x={X(hoverT) + 5} y={Y(hv) - 3} className="text-[9px] tabular-nums" fill={s.color}>
                {fmtNum(hv, digits)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
