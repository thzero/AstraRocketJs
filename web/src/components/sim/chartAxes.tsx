import { fmtNum } from '../../i18n/format';

// Shared scaffold for the thrust-vs-time charts (MotorDetail's ThrustChart plus
// MotorDashboard's CombineChart and ComparePane): the same linear scales, axis
// furniture, and path builders that were hand-rolled — and had drifted — in each.
// FlightChart's Panel is deliberately NOT built on this: it has a per-panel
// y-domain, a hover crosshair, clipping, and event overlays that don't generalise.

export type XY = readonly [number, number];

export interface ChartDims {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

/** Linear scales for a time-vs-thrust plot: X maps t∈[0,tMax] and Y maps f∈[0,fMax]
 *  into the padded plot rectangle (Y grows downward, 0 at the baseline). */
export function chartScales(d: ChartDims, tMax: number, fMax: number) {
  const X = (tt: number) => d.padL + (tt / tMax) * (d.width - d.padL - d.padR);
  const Y = (f: number) => d.height - d.padB - (f / fMax) * (d.height - d.padT - d.padB);
  return { X, Y };
}

/** SVG path `d` for a polyline through the [t, f] points. */
export const linePath = (pts: readonly XY[], X: (t: number) => number, Y: (f: number) => number): string =>
  pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');

/** SVG path `d` for the polyline closed down to the f=0 baseline across [0, tMax]
 *  (the filled area under a curve). Empty string for no points. */
export const baselineArea = (
  pts: readonly XY[],
  X: (t: number) => number,
  Y: (f: number) => number,
  tMax: number,
): string =>
  pts.length
    ? `M ${X(0).toFixed(1)} ${Y(0).toFixed(1)} ${pts
        .map((p) => `L ${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`)
        .join(' ')} L ${X(tMax).toFixed(1)} ${Y(0).toFixed(1)} Z`
    : '';

/** Horizontal gridlines with left-edge value labels at `fMax · levels`, plus
 *  bottom-edge time ticks at [0, tMax/2, tMax] — the axis furniture every
 *  thrust-vs-time chart draws identically. Render it inside the chart's `<svg>`. */
export function ChartAxes({
  dims,
  tMax,
  fMax,
  X,
  Y,
  levels = [0, 0.5, 1],
}: {
  dims: ChartDims;
  tMax: number;
  fMax: number;
  X: (t: number) => number;
  Y: (f: number) => number;
  levels?: number[];
}) {
  return (
    <>
      {levels.map((f) => {
        const gy = Y(fMax * f);
        return (
          <g key={f}>
            <line x1={dims.padL} y1={gy} x2={dims.width - dims.padR} y2={gy} className="stroke-white/10" />
            <text x={dims.padL - 4} y={gy + 3} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
              {fmtNum(fMax * f, 0)}
            </text>
          </g>
        );
      })}
      {[0, tMax / 2, tMax].map((tt, i) => (
        <text key={i} x={X(tt)} y={dims.height - 6} textAnchor="middle" className="fill-slate-500 text-[9px] tabular-nums">
          {fmtNum(tt, tt < 10 ? 1 : 0)}
        </text>
      ))}
    </>
  );
}
