import { memo, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { lerpAt } from '../../services/flight/interpolate';
import {
  buildLinePath,
  chartDomain,
  machTicks,
  nearestSampleIndex,
  stackedBands,
  type ChartSeries as Series,
} from './aeroTables';
import { useElementResize } from '../common/useElementResize';
import { token } from '../common/colorTokens';

/**
 * The AeroAnalysis chart cards: one `ChartCard` per curve set (title, legend
 * with the hovered readout, the SVG plot with a keyboard-and-pointer
 * crosshair) and the memoized `ChartBody` that draws the paths. The pane owns
 * the hover state and the series; this file owns how they are drawn.
 */

const PAD_L = 46,
  PAD_R = 14,
  PAD_T = 10,
  PAD_B = 20,
  CHART_H = 168;

/** Chart geometry shared by the memoized body and the hover overlay. */
interface ChartGeom {
  w: number;
  yMin: number;
  yMax: number;
  X: (m: number) => number;
  Y: (v: number) => number;
}

const chartGeom = (w: number, machMin: number, machMax: number, yMin: number, yMax: number): ChartGeom => {
  const iw = w - PAD_L - PAD_R,
    ih = CHART_H - PAD_T - PAD_B;
  const span = machMax - machMin || 1;
  return {
    w,
    yMin,
    yMax,
    X: (m: number) => PAD_L + ((m - machMin) / span) * iw,
    Y: (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * ih,
  };
};

/**
 * One chart: title row, legend with the hovered readout, the SVG plot with a
 * keyboard-and-pointer crosshair.
 *
 * `hoverM` is state at the pane level (one crosshair drives all three charts),
 * so every pointer move re-renders every card. The expensive part - the
 * y-domain, the stacked bands and every path string - therefore lives in
 * `ChartBody`, a memoized child whose props do not include the hover, and
 * this card recomputes only the legend readout and the crosshair line on a
 * move.
 */
export function ChartCard({
  title,
  note,
  right,
  machs,
  machMin,
  machMax,
  series,
  stacked,
  unit,
  digits,
  hoverM,
  setHoverM,
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
  machs: number[];
  machMin: number;
  machMax: number;
  series: Series[];
  stacked?: boolean;
  unit: string;
  digits: number;
  hoverM: number | null;
  setHoverM: (m: number | null | ((prev: number | null) => number | null)) => void;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
  useElementResize(hostRef, (r) => setW(Math.max(240, r.width)));

  /**
   * Arrow-key crosshair over the Mach grid.
   *
   * Snaps to computed samples rather than interpolating a free position, which
   * is the same rule the Mach slider follows - a reading between samples is not
   * one the sweep produced.
   */
  const onCrosshairKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!machs.length) return;
    const cur = hoverM ?? machs[0]!;
    let i = nearestSampleIndex(machs, cur);
    const jump = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') i = Math.min(machs.length - 1, i + jump);
    else if (e.key === 'ArrowLeft') i = Math.max(0, i - jump);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = machs.length - 1;
    else if (e.key === 'Escape') {
      setHoverM(null);
      return;
    } else return;
    e.preventDefault();
    setHoverM(machs[i]!);
  };

  // The y-domain is the one derived value the overlay needs (to place the
  // crosshair through the same scale the body drew with), so it is computed
  // here and handed down; the body memoizes the rest on top of it.
  const { yMin, yMax } = useMemo(() => chartDomain(series, machs, !!stacked), [series, machs, stacked]);
  const geom = useMemo(() => chartGeom(w, machMin, machMax, yMin, yMax), [w, machMin, machMax, yMin, yMax]);

  const onMove = (e: React.PointerEvent) => {
    const host = hostRef.current;
    if (!host) return;
    const x = e.clientX - host.getBoundingClientRect().left;
    const iw = w - PAD_L - PAD_R;
    const span = machMax - machMin || 1;
    setHoverM(Math.max(machMin, Math.min(machMax, machMin + ((x - PAD_L) / iw) * span)));
  };

  return (
    <div className="rounded-lg bg-raised/40 ring-1 ring-line/10">
      <div className="flex items-center gap-2 px-2 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 pb-1 pt-1">
        {series.map((se, li) => {
          const val = hoverM != null ? lerpAt(machs, se.values, hoverM) : null;
          return (
            <span key={li} className="inline-flex items-center gap-1 text-[10px] text-ink-soft">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: se.color }} />
              {se.name}
              {val != null && (
                <span className="tabular-nums text-ink-muted">
                  · {fmtNum(val, digits)}
                  {unit && ` ${unit}`}
                </span>
              )}
            </span>
          );
        })}
      </div>
      {/*
        Keyboard crosshair, so the per-Mach values these curves carry can be
        read without a pointer. The arrows walk the Mach grid sample by sample
        (Shift for ten), Home/End go to the ends, Escape drops the crosshair.
      */}
      <div // eslint-disable-line jsx-a11y-x/no-noninteractive-element-interactions -- a focusable crosshair: the arrows move it, and the group names it without claiming a widget role it does not fit
        ref={hostRef}
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- a focusable crosshair: the arrows move it, and the group names it without claiming a widget role it does not fit
        tabIndex={0}
        role="group"
        aria-label={t('aero.crosshairHint')}
        className="focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset focus-visible:outline-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverM(null)}
        onFocus={() => setHoverM((m) => m ?? machs[Math.floor(machs.length / 2)] ?? null)}
        onBlur={() => setHoverM(null)}
        onKeyDown={onCrosshairKey}
      >
        <svg viewBox={`0 0 ${w} ${CHART_H}`} width="100%" height={CHART_H} className="block">
          <ChartBody geom={geom} machs={machs} machMax={machMax} series={series} stacked={!!stacked} digits={digits} />
          {hoverM != null && (
            <line
              x1={geom.X(hoverM)}
              y1={PAD_T}
              x2={geom.X(hoverM)}
              y2={CHART_H - PAD_B}
              data-crosshair
              className="stroke-ink-soft/40"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      {note && <p className="px-2 pb-1.5 text-[9px] text-ink-faint">{note}</p>}
    </div>
  );
}

/**
 * The plot itself: gridlines, the stacked bands or the line paths, and the
 * Mach ticks. Memoized on its (stable) inputs so the pane-level hover state
 * never reaches it; the path strings are the cost, and they only change when
 * the sweep, the width or the domain does.
 */
const ChartBody = memo(function ChartBody({
  geom,
  machs,
  machMax,
  series,
  stacked,
  digits,
}: {
  geom: ChartGeom;
  machs: number[];
  machMax: number;
  series: Series[];
  stacked: boolean;
  digits: number;
}) {
  const { w, yMin, yMax, X, Y } = geom;
  // Stacked areas: cumulative bottom-to-top, each band drawn as a filled
  // polygon with a thin surface stroke along its top edge (the dataviz
  // 2px-gap rule). Lines otherwise.
  const { bands, paths } = useMemo(
    () => ({
      bands: stacked ? stackedBands(series, machs, X, Y) : [],
      paths: stacked ? [] : series.map((se) => buildLinePath(machs, se.values, X, Y)),
    }),
    [series, machs, stacked, X, Y],
  );
  // A sweep that ends at 1 is ticked in fifths, so its labels need a decimal;
  // whole Mach numbers do not. With no decimals, 0.2 and 0.4 would both
  // print as "0".
  const machDecimals = machMax <= 1 ? 1 : 0;
  const xTicks = useMemo(() => machTicks(machs[0] ?? 0.05, machMax), [machs, machMax]);
  return (
    <>
      {[0, 1, 2].map((i) => {
        const yv = yMin + (yMax - yMin) * (i / 2);
        const gy = Y(yv);
        return (
          <g key={i}>
            <line x1={PAD_L} y1={gy} x2={w - PAD_R} y2={gy} className="stroke-line/10" />
            <text x={PAD_L - 4} y={gy + 3} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
              {fmtNum(yv, digits)}
            </text>
          </g>
        );
      })}
      {stacked
        ? bands.map((b, i) => (
            <path
              key={i}
              d={b.d}
              fill={b.fill}
              fillOpacity={0.85}
              stroke={token('surface')}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))
        : series.map((se, i) => (
            <path
              key={i}
              d={paths[i]}
              fill="none"
              stroke={se.color}
              strokeWidth={1.75}
              vectorEffect="non-scaling-stroke"
            />
          ))}
      {xTicks.map((m, i) => (
        <text key={i} x={X(m)} y={CHART_H - 5} textAnchor="middle" className="fill-ink-faint text-[9px] tabular-nums">
          {i === 0 ? `M ${fmtNum(m, machDecimals)}` : fmtNum(m, machDecimals)}
        </text>
      ))}
    </>
  );
});
