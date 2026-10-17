import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum, ladderDigits, withUnit } from '../../i18n/format';
import { NO_VALUE } from '../../i18n/noValue';
import { useUnits } from '../../prefs/useUnits';
import { hoverValue } from './FlightChartHover';
import { PAD_L, PAD_R } from './flightChartAxis';
import type { Branch, Meta } from './flightChartTraces';
import { polylinePath } from '../common/svgPath';
import { ChartPanelFrame } from './ChartPanelFrame';
import { peakOf, velocityAltitudeSummary } from './chartSummary';

/**
 * Velocity against altitude, one line per shown stage.
 *
 * The one panel not on the shared time axis: its x is altitude, so the zoom
 * and the event lines (both times) do not apply to it. The crosshair still
 * does, as a dot at the hovered moment on each line, so moving along the time
 * panels walks the dot up the climb and back down.
 */
export function FlightXYPanel({
  meta,
  branches,
  w,
  height,
  hoverT,
  expanded,
  onToggleExpand,
}: {
  meta: Meta;
  branches: Branch[];
  w: number;
  height: number;
  hoverT: number | null;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const uid = useId();
  const padT = 8;
  const padB = 16;
  const ih = height - padT - padB;
  const iw = Math.max(1, w - PAD_L - PAD_R);
  const xs = u.factor('distance');
  const ys = u.factor('velocity');

  const { lines, x0, x1, y0, y1 } = useMemo(() => {
    let xMin = 0;
    let xMax = -Infinity;
    let yMin = 0;
    let yMax = -Infinity;
    // A plain loop: the domain scan writes the bounds, which a `.map` callback
    // must not.
    const out: { color: string; pts: [number, number][]; time: number[]; alt: number[]; vel: number[] }[] = [];
    for (const b of branches) {
      const pts: [number, number][] = [];
      const time: number[] = [];
      const alt: number[] = [];
      const vel: number[] = [];
      const n = b.series.time.length;
      for (let i = 0; i < n; i++) {
        const ti = b.series.time[i];
        const a = b.series.altitude[i];
        const v = b.series.velocity[i];
        if (ti == null || a == null || v == null || !Number.isFinite(a) || !Number.isFinite(v)) continue;
        const x = a * xs;
        const y = v * ys;
        pts.push([x, y]);
        time.push(ti);
        alt.push(x);
        vel.push(y);
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      out.push({ color: b.color, pts, time, alt, vel });
    }
    if (!(xMax > xMin)) xMax = xMin + 1;
    if (!(yMax > yMin)) yMax = yMin + 1;
    return { lines: out, x0: xMin, x1: xMax, y0: yMin, y1: yMax + (yMax - yMin) * 0.08 };
  }, [branches, xs, ys]);

  const { X, Y, paths } = useMemo(() => {
    const toX = (x: number) => PAD_L + ((x - x0) / (x1 - x0)) * iw;
    const toY = (y: number) => padT + (1 - (y - y0) / (y1 - y0)) * ih;
    return {
      X: toX,
      Y: toY,
      paths: lines.map((l) =>
        l.pts.length >= 2
          ? polylinePath(
              l.pts.map((p) => [toX(p[0]), toY(p[1])]),
              'comma',
            )
          : '',
      ),
    };
  }, [lines, x0, x1, y0, y1, iw, ih]);

  // Each line's own flight span bounds its dot, the rule the time panels use.
  const hovered =
    hoverT == null
      ? []
      : lines.map((l) => {
          const span = { xs: l.time, t0: l.time[0], t1: l.time[l.time.length - 1] };
          return { l, a: hoverValue({ ...span, ys: l.alt }, hoverT), v: hoverValue({ ...span, ys: l.vel }, hoverT) };
        });
  const head = hovered[0];
  const xDigits = ladderDigits(x1 - x0);
  const yDigits = ladderDigits(y1 - y0);
  // The largest magnitude, sign kept: the same top speed the summary below reads.
  const peak = (lines[0] && peakOf(lines[0].alt, lines[0].vel)?.value) ?? 0;
  // What a screen reader hears for this panel: the top speed and the altitude
  // it was reached at, per shown stage (see chartSummary).
  const summary = useMemo(
    () =>
      velocityAltitudeSummary(
        t,
        t(meta.label),
        lines.map((l, i) => ({ name: branches[i]?.name ?? '', alt: l.alt, vel: l.vel })),
        {
          velocity: (v) => withUnit(fmtNum(v, yDigits), u.sym('velocity')),
          altitude: (a) => withUnit(fmtNum(a, xDigits), u.sym('distance')),
        },
      ),
    [t, meta.label, lines, branches, yDigits, xDigits, u],
  );

  return (
    <ChartPanelFrame
      title={t(meta.label)}
      reading={
        // With a crosshair, the primary stage's reading there, or no value
        // outside its flight; with none, its top speed, tagged as the peak so
        // it never reads as a value at a moment.
        <>
          {hoverT == null && <span className="text-[10px] text-ink-faint">{t('flight.peakTag')}</span>}
          <span className="text-xs font-semibold tabular-nums text-ink-strong">
            {hoverT == null
              ? withUnit(fmtNum(peak, yDigits), u.sym('velocity'))
              : head && head.v != null && head.a != null
                ? t('flight.velocityAtAltitude', {
                    velocity: withUnit(fmtNum(head.v, yDigits), u.sym('velocity')),
                    altitude: withUnit(fmtNum(head.a, xDigits), u.sym('distance')),
                  })
                : NO_VALUE}
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
        <clipPath id={`${uid}-clip`}>
          <rect x={PAD_L} y={0} width={iw} height={height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        {lines.map((l, i) =>
          paths[i] ? (
            <path
              key={i}
              d={paths[i]}
              fill="none"
              stroke={l.color}
              strokeWidth={1.75}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
        {hovered.map(({ l, a, v }, i) =>
          a != null && v != null ? <circle key={i} cx={X(a)} cy={Y(v)} r={3} fill={l.color} /> : null,
        )}
      </g>
      <text x={PAD_L - 4} y={padT + 7} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
        {fmtNum(y1, yDigits)}
      </text>
      <text x={PAD_L - 4} y={height - padB} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
        {fmtNum(y0, yDigits)}
      </text>
      <text x={PAD_L} y={height - 3} className="fill-ink-faint text-[9px] tabular-nums">
        {fmtNum(x0, xDigits)}
      </text>
      <text x={w - PAD_R} y={height - 3} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
        {withUnit(fmtNum(x1, xDigits), u.sym('distance'))}
      </text>
    </ChartPanelFrame>
  );
}
