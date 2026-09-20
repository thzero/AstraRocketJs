import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogMotor } from '../../services/motorDb';
import { combineCurves, impulseClass, type Sample } from '../../services/motorCombine';
import { useUnits } from '../../prefs/useUnits';
import { Stat } from './MotorDetail';
import { keyOf } from './motorKey';
import { seriesColor } from './motorSeries';
import { inUserUnit, withUnit } from './motorFormat';
import { ChartAxes, CHART_HEADROOM, chartScales, linePath, baselineArea } from './chartAxes';

/**
 * The motor dashboard's COMBINE tool: the checked motors summed into one
 * cluster, as the summed thrust curve (with each motor's own curve overlaid)
 * and the cluster's impulse class and totals.
 */

/** Cluster chart: the summed total as a filled orange envelope with each motor's
 *  own curve overlaid on top (categorical colors), so you see each contribution.
 *  Legend + direct labels are the secondary encoding for the palette floor band. */
function CombineChart({
  combined,
  series,
}: {
  combined: Sample[];
  series: { m: CatalogMotor; color: string; pts: Sample[] }[];
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const usable = series.filter((s) => s.pts.length >= 2);
  const dims = { width: 560, height: 220, padL: 40, padR: 12, padT: 12, padB: 24 };
  const { width: W, height: H } = dims;
  const tMax = Math.max(1, combined[combined.length - 1]?.[0] ?? 0, ...usable.flatMap((s) => s.pts.map((p) => p[0])));
  const fMax = Math.max(1, ...combined.map((s) => s[1])) * CHART_HEADROOM; // the sum is the envelope (max)
  const { X, Y } = chartScales(dims, tMax, fMax);
  const path = (pts: Sample[]) => linePath(pts, X, Y);
  const area = baselineArea(combined, X, Y, tMax);
  const labelDirect = usable.length <= 4;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="mt-2 block max-w-2xl">
        <defs>
          <linearGradient id="combFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <ChartAxes dims={dims} tMax={tMax} fMax={fMax} X={X} Y={Y} fScale={u.factor('force')} />
        <path d={area} fill="url(#combFill)" />
        {usable.map((s) => {
          const peak = s.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
          return (
            <g key={keyOf(s.m)}>
              <path d={path(s.pts)} fill="none" stroke={s.color} strokeWidth="1.5" />
              {labelDirect && (
                <text
                  x={X(peak[0])}
                  y={Y(peak[1]) - 4}
                  textAnchor="middle"
                  className="text-[8px] font-semibold"
                  fill={s.color}
                >
                  {s.m.designation}
                </text>
              )}
            </g>
          );
        })}
        {/* the summed total, drawn on top */}
        <path d={path(combined)} fill="none" stroke="#f97316" strokeWidth="2.5" />
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1">
          <svg width="12" height="4" aria-hidden>
            <line x1="0" y1="2" x2="12" y2="2" stroke="#f97316" strokeWidth="2.5" />
          </svg>
          {t('dash.total')}
        </span>
        {usable.map((s) => (
          <span key={keyOf(s.m)} className="inline-flex items-center gap-1">
            <svg width="12" height="4" aria-hidden>
              <line x1="0" y1="2" x2="12" y2="2" stroke={s.color} strokeWidth="2" />
            </svg>
            {s.m.designation}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The cluster summary: class chip, chart and the combined totals. `motors`
 *  must be referentially stable across renders (the dashboard memoizes it on
 *  the checked set) so the combine memo below is honest. */
export function MotorCombinePane({ motors }: { motors: CatalogMotor[] }) {
  const { t } = useTranslation();
  const u = useUnits();
  const combined = useMemo(
    () => combineCurves(motors.map((m) => (m.curves?.[0]?.samples ?? []) as Sample[])),
    [motors],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">{t('dash.combined')}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-300">
          {impulseClass(combined.totalImpulse)}
        </span>
        <h3 className="text-2xl font-bold text-slate-100">{t('dash.cluster', { n: combined.motorCount })}</h3>
      </div>
      <div className="mt-0.5 text-sm text-slate-400">{motors.map((m) => m.designation).join(' + ')}</div>
      {combined.samples.length >= 2 && (
        <CombineChart
          combined={combined.samples}
          series={motors.map((m, i) => ({
            m,
            color: seriesColor(i),
            pts: (m.curves?.[0]?.samples ?? []) as Sample[],
          }))}
        />
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Stat label={t('dash.motors')} value={String(combined.motorCount)} />
        {/* In the user's units, as MotorDetail's grid is; these four
            were the only readouts in the dashboard fixed to N and N.s. */}
        <Stat label={t('motorDlg.totalImpulse')} value={inUserUnit(u, 'impulse', combined.totalImpulse, 1, 1)} />
        <Stat label={t('motorDlg.maxThrust')} value={inUserUnit(u, 'force', combined.peakThrust, 1, 1)} />
        <Stat label={t('motorDlg.avgThrust')} value={inUserUnit(u, 'force', combined.avgThrust, 1, 1)} />
        <Stat label={t('motorDlg.burnTime')} value={withUnit(combined.burnTime, 's', 2)} />
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('dash.combineNote')}</p>
    </div>
  );
}
