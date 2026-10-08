import type { ReactNode } from 'react';
import { fmtNum } from '../../i18n/format';
import { polylinePath } from '../common/svgPath';

// Shared scaffold for the thrust-vs-time charts (MotorDetail's ThrustChart plus
// the motor dashboard's MotorCombinePane and MotorComparePane): one set of linear
// scales, axis furniture and path builders, so the three cannot drift apart.
// FlightChart's Panel is deliberately not built on this: it has a per-panel
// y-domain, a hover crosshair, clipping, and event overlays that don't generalize.

export type XY = readonly [number, number];

/**
 * Vertical headroom above the tallest sample: the peak label and the dot need
 * room under the top edge. One number, so every thrust chart leaves the same gap.
 */
export const CHART_HEADROOM = 1.08;

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

/** SVG path `d` for a polyline through the [t, f] points, breaking at a non-finite one. */
export const linePath = (pts: readonly XY[], X: (t: number) => number, Y: (f: number) => number): string =>
  polylinePath(pts.map((p) => [X(p[0]), Y(p[1])]));

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
 *  bottom-edge time ticks at [0, tMax/2, tMax]: the axis furniture every
 *  thrust-vs-time chart draws identically. Render it inside the chart's `<svg>`. */
export function ChartAxes({
  dims,
  tMax,
  fMax,
  X,
  Y,
  levels = [0, 0.5, 1],
  fScale = 1,
  fDigits = 0,
}: {
  dims: ChartDims;
  tMax: number;
  fMax: number;
  X: (t: number) => number;
  Y: (f: number) => number;
  levels?: number[];
  /** Multiplier from newtons to the unit the axis is labeled in. */
  fScale?: number;
  fDigits?: number;
}) {
  return (
    <>
      {levels.map((f) => {
        const gy = Y(fMax * f);
        return (
          <g key={f}>
            <line x1={dims.padL} y1={gy} x2={dims.width - dims.padR} y2={gy} className="stroke-line/10" />
            <text x={dims.padL - 4} y={gy + 3} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
              {fmtNum(fMax * f * fScale, fDigits)}
            </text>
          </g>
        );
      })}
      {[0, tMax / 2, tMax].map((tt, i) => (
        <text
          key={i}
          x={X(tt)}
          y={dims.height - 6}
          textAnchor="middle"
          className="fill-ink-faint text-[9px] tabular-nums"
        >
          {fmtNum(tt, tt < 10 ? 1 : 0)}
        </text>
      ))}
    </>
  );
}

/** The sample with the largest value (the first one on a tie). `pts` must not be empty. */
export const peakOf = (pts: readonly XY[]): XY => pts.reduce((a, b) => (b[1] > a[1] ? b : a));

/** One series curve, optionally named in its own color just above its peak
 *  (the direct label that backs up the legend). Render it inside the chart's `<svg>`. */
export function SeriesPath({
  pts,
  X,
  Y,
  color,
  strokeWidth,
  label,
  labelLift,
  labelClass,
}: {
  pts: readonly XY[];
  X: (t: number) => number;
  Y: (f: number) => number;
  color: string;
  strokeWidth: number;
  /** The direct label; omitted draws the curve alone. */
  label?: string;
  /** Gap in px between the peak and the label's baseline. */
  labelLift: number;
  /** Tailwind size and weight classes for the label. */
  labelClass: string;
}) {
  const peak = peakOf(pts);
  return (
    <g>
      <path d={linePath(pts, X, Y)} fill="none" stroke={color} strokeWidth={String(strokeWidth)} />
      {label !== undefined && (
        <text x={X(peak[0])} y={Y(peak[1]) - labelLift} textAnchor="middle" className={labelClass} fill={color}>
          {label}
        </text>
      )}
    </g>
  );
}

/** A legend entry: a short line swatch in the series color (dashed for a
 *  reference line) followed by its name. */
export function LegendSwatch({
  color,
  width,
  strokeWidth = 2,
  dash,
  children,
}: {
  color: string;
  /** Swatch length in px. */
  width: number;
  strokeWidth?: number;
  dash?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg width={width} height="4" aria-hidden>
        <line
          x1="0"
          y1="2"
          x2={width}
          y2="2"
          stroke={color}
          strokeWidth={String(strokeWidth)}
          strokeDasharray={dash ? '3 2' : undefined}
        />
      </svg>
      {children}
    </span>
  );
}
