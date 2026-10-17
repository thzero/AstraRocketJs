import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { PAD_L, PAD_R, PANEL_H } from './flightChartAxis';
import { panelDigits, panelSeries, traceScale, traceUnit, type Branch, type Meta } from './flightChartTraces';
import { PanelHover, hoverValue } from './FlightChartHover';
import { NO_VALUE } from '../../i18n/noValue';
import { polylinePath } from '../common/svgPath';
import { ChartPanelFrame } from './ChartPanelFrame';
import { token } from '../common/colorTokens';
import { timeSeriesSummary } from './chartSummary';

/**
 * Owns one small-multiple panel of the flight chart: it draws the lines that
 * `panelSeries` (flightChartTraces) extracts and bounds, and owns the path
 * strings, the header value, and the SVG with its axis labels, event ticks,
 * area fill and lines. The hover readout inside it is FlightChartHover.
 */

type Pt = readonly [number, number];

export function FlightChartPanel({
  meta,
  branches,
  w,
  X,
  hoverT,
  clipT,
  events,
  height = PANEL_H,
  expanded = false,
  onToggleExpand,
}: {
  meta: Meta;
  branches: Branch[];
  w: number;
  X: (t: number) => number;
  hoverT: number | null;
  clipT: number;
  events: { type: string; time: number }[];
  /** The panel's plot height; the pane's whole height when it is the expanded one. */
  height?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const padT = 8;
  const padB = 8;
  const ih = height - padT - padB;
  // A quantity-backed series scales and labels itself from the preference; the
  // rest keep their fixed unit. `factor`, not `toUi`, because this scales a
  // whole series; none of these carry a temperature-style offset.
  const scale = traceScale(meta, u);
  const unit = traceUnit(meta, u, t);
  // Namespaced ids. With a fixed id, two charts in one document (a comparison
  // view, or the mobile and desktop copies during a breakpoint transition)
  // would make `url(#...)` resolve to whichever rendered first, clipping one
  // chart's panels to the other's width.
  const uid = useId();
  const clipId = `${uid}-clip-${meta.key}`;
  const single = branches.length === 1;

  // One line per selected stage; the y-domain spans them all so they share a
  // scale and read against each other. Keyed on the (stable) branch list so a
  // hover doesn't rebuild every stage's path.
  // `meta` is an entry of the static SERIES table, so it is a stable key.
  const { list, lo, hi } = useMemo(() => panelSeries(branches, meta, scale, clipT), [branches, meta, scale, clipT]);
  const digits = panelDigits(meta, lo, hi);

  const Y = useCallback((v: number) => padT + (1 - (v - lo) / (hi - lo)) * ih, [lo, hi, ih]);
  const mkLine = useCallback(
    (pts: Pt[]) =>
      pts.length >= 2
        ? polylinePath(
            pts.map((p) => [X(p[0]), Y(p[1])]),
            'comma',
          )
        : '',
    [X, Y],
  );

  /**
   * The path strings and the peak scan: the expensive half.
   *
   * The memo above caches the sample extraction; this one caches `mkLine` (a
   * toFixed pair and a string per sample) and the reduce over every `ys`.
   * `hoverT` is a prop of this component, so in the render body all of it
   * would be rebuilt for every panel on every pointer move, and at the
   * six-figure sample counts `maxFlightTime`'s docblock describes that is a
   * six-figure-segment string per panel per move.
   */
  const { paths, areaPath, peak } = useMemo(() => {
    const first = list[0];
    return {
      paths: list.map((sr) => mkLine(sr.pts)),
      areaPath:
        first && first.pts.length >= 2
          ? `M${X(first.pts[0]![0]).toFixed(1)},${Y(Math.max(lo, 0)).toFixed(1)} ` +
            first.pts.map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ') +
            ` L${X(first.pts[first.pts.length - 1]![0]).toFixed(1)},${Y(Math.max(lo, 0)).toFixed(1)} Z`
          : '',
      peak: list.reduce((acc, sr) => {
        let m = acc;
        for (const y of sr.ys) if (Math.abs(y) > Math.abs(m)) m = y;
        return m;
      }, 0),
    };
  }, [list, mkLine, X, Y, lo]);

  const zeroInRange = lo < 0 && hi > 0;

  // What a screen reader hears for this panel: its peak and when, or the span a
  // level series covers, per shown stage (see chartSummary).
  const summary = useMemo(
    () => timeSeriesSummary(t, t(meta.label), unit, digits, !!meta.level, list),
    [t, meta.label, meta.level, unit, digits, list],
  );

  // Header: with a crosshair, the primary (first / sustainer) stage's value
  // there, or no value outside that stage's span; with none, the
  // peak-magnitude sample across every shown stage, tagged as the peak so it
  // never reads as a value at a time.
  const primary = list[0];
  const showsPeak = hoverT == null;
  const shown = showsPeak ? peak : primary ? hoverValue(primary, hoverT) : null;

  return (
    <ChartPanelFrame
      title={t(meta.label)}
      reading={
        <>
          {showsPeak && <span className="text-[10px] text-ink-faint">{t('flight.peakTag')}</span>}
          <span className="text-xs font-semibold tabular-nums text-ink-strong">
            {shown == null ? (
              NO_VALUE
            ) : (
              <>
                {fmtNum(shown, digits)}
                {unit && <span className="ml-0.5 text-[10px] text-ink-faint">{unit}</span>}
              </>
            )}
          </span>
        </>
      }
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      w={w}
      height={height}
      summary={summary}
    >
      <defs>
        {/* Filled area only for a lone line (single stage), colored to match
              it; overlaid stages would muddy each other, so they're lines only. */}
        {single && (
          <linearGradient id={`${uid}-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primary?.color ?? token('series-1')} stopOpacity="0.25" />
            <stop offset="100%" stopColor={primary?.color ?? token('series-1')} stopOpacity="0" />
          </linearGradient>
        )}
        {/* Clip everything time-mapped to the plot area, so zoomed-out-of-window
              points don't spill over the y-axis labels / panel edges. */}
        <clipPath id={clipId}>
          <rect x={PAD_L} y={0} width={Math.max(0, w - PAD_L - PAD_R)} height={height} />
        </clipPath>
      </defs>
      {zeroInRange && <line x1={PAD_L} y1={Y(0)} x2={w - PAD_R} y2={Y(0)} className="stroke-line/15" />}
      <g clipPath={`url(#${clipId})`}>
        {events.map((e, i) => (
          <line
            key={i}
            x1={X(e.time)}
            y1={padT}
            x2={X(e.time)}
            y2={height - padB}
            className="stroke-warn-400/25"
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {single && !meta.level && areaPath && <path d={areaPath} fill={`url(#${uid}-${meta.key})`} />}
        {list.map((s, i) =>
          paths[i] ? (
            <path
              key={i}
              d={paths[i]}
              fill="none"
              stroke={s.color}
              strokeWidth={1.75}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
        {hoverT != null && (
          <PanelHover
            hoverT={hoverT}
            list={list}
            X={X}
            Y={Y}
            top={padT}
            bottom={height - padB}
            single={single}
            digits={digits}
          />
        )}
      </g>
      <text x={PAD_L - 4} y={padT + 7} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
        {fmtNum(hi, digits)}
      </text>
      <text x={PAD_L - 4} y={height - padB} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
        {fmtNum(lo, digits)}
      </text>
    </ChartPanelFrame>
  );
}
