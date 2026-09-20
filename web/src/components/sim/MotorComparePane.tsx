import { useTranslation } from 'react-i18next';
import type { CatalogMotor } from '../../services/motorDb';
import type { Sample } from '../../services/motorCombine';
import { useUnits } from '../../prefs/useUnits';
import { keyOf } from './motorKey';
import { ALIGN, heading, type Col } from './motorColumns';
import { seriesColor } from './motorSeries';
import { ChartAxes, CHART_HEADROOM, chartScales, linePath } from './chartAxes';

/**
 * The motor dashboard's COMPARE tool: the checked motors' thrust curves
 * overlaid on one chart, with a legend, and a side-by-side spec table using
 * the grid's chosen columns.
 */

/** Compare pane: overlaid thrust curves (legend + direct labels are the required
 *  secondary encoding) and a side-by-side spec table using the grid's chosen
 *  columns. */
export function MotorComparePane({ motors, cols }: { motors: CatalogMotor[]; cols: Col[] }) {
  const { t } = useTranslation();
  const u = useUnits();
  // Assign a color only to motors that actually have a curve (in order), so the
  // chart, legend and table dots agree — and a curveless motor gets none.
  const colorFor = new Map<string, string>();
  let ci = 0;
  for (const m of motors) {
    if ((m.curves?.[0]?.samples?.length ?? 0) >= 2) colorFor.set(keyOf(m), seriesColor(ci++));
  }
  const series = motors
    .filter((m) => colorFor.has(keyOf(m)))
    .map((m) => ({ m, color: colorFor.get(keyOf(m))!, pts: m.curves![0]!.samples as Sample[] }));
  // Identity is the motor name (+ color dot); show every other chosen column.
  const specCols = cols.filter((c) => c.id !== 'designation');

  const dims = { width: 440, height: 190, padL: 36, padR: 12, padT: 12, padB: 24 };
  const { width: W, height: H } = dims;
  const tMax = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p[0])));
  const fMax = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p[1]))) * CHART_HEADROOM;
  const { X, Y } = chartScales(dims, tMax, fMax);
  const labelDirect = series.length <= 4;

  return (
    <div className="mx-auto max-w-5xl px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">
        {t('dash.compareTitle')}
      </div>
      <h3 className="mt-1 text-lg font-bold text-slate-100">{t('dash.compareN', { n: motors.length })}</h3>

      {series.length >= 1 ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="mt-2 block max-w-xl">
            <ChartAxes dims={dims} tMax={tMax} fMax={fMax} X={X} Y={Y} fScale={u.factor('force')} />
            {series.map((s) => {
              const d = linePath(s.pts, X, Y);
              const peak = s.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
              return (
                <g key={keyOf(s.m)}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth="2" />
                  {labelDirect && (
                    <text
                      x={X(peak[0])}
                      y={Y(peak[1]) - 5}
                      textAnchor="middle"
                      className="text-[9px] font-semibold"
                      fill={s.color}
                    >
                      {s.m.designation}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {/* Legend — identity is never color-alone. */}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
            {series.map((s) => (
              <span key={keyOf(s.m)} className="inline-flex items-center gap-1">
                <svg width="12" height="4" aria-hidden>
                  <line x1="0" y1="2" x2="12" y2="2" stroke={s.color} strokeWidth="2" />
                </svg>
                {s.m.designation}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="my-4 rounded-lg bg-slate-800/50 p-3 text-xs text-slate-400">{t('motorDlg.noCurve')}</p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left font-semibold">{t('dash.colMotor')}</th>
              {specCols.map((c) => (
                <th key={c.id} className={`px-2 py-1 font-semibold ${ALIGN[c.align]}`}>
                  {heading(c, t, u)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {motors.map((m) => (
              <tr key={keyOf(m)} className="border-t border-white/5">
                <td className="px-2 py-1 font-medium text-slate-100">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: colorFor.get(keyOf(m)) ?? '#475569' }}
                  />
                  {m.designation}
                  {!colorFor.has(keyOf(m)) && (
                    <span className="ml-1 text-[10px] font-normal text-slate-500">({t('dash.noCurve')})</span>
                  )}
                </td>
                {specCols.map((c) => (
                  <td key={c.id} className={`px-2 py-1 text-slate-300 ${ALIGN[c.align]}`}>
                    {c.cell(m, u)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
