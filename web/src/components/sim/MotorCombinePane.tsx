import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogMotor } from '../../services/motors/motorDb';
import { combineCurves, impulseClass, type Sample } from '../../services/motors/motorCombine';
import { useUnits } from '../../prefs/useUnits';
import { SpecItem } from './MotorDetail';
import { keyOf } from './motorKey';
import { seriesColor } from '../common/chartPalette';
import { inUserUnit, withFixedUnit } from './motorFormat';
import { ChartAxes, CHART_HEADROOM, chartScales, linePath, baselineArea, LegendSwatch, SeriesPath } from './chartAxes';
import { token } from '../common/colorTokens';

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
  const area = baselineArea(combined, X, Y, tMax);
  const labelDirect = usable.length <= 4;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="mt-2 block max-w-2xl">
        <defs>
          <linearGradient id="combFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={token('thrust')} stopOpacity="0.28" />
            <stop offset="100%" stopColor={token('thrust')} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <ChartAxes dims={dims} tMax={tMax} fMax={fMax} X={X} Y={Y} fScale={u.factor('force')} />
        <path d={area} fill="url(#combFill)" />
        {usable.map((s) => (
          <SeriesPath
            key={keyOf(s.m)}
            pts={s.pts}
            X={X}
            Y={Y}
            color={s.color}
            strokeWidth={1.5}
            label={labelDirect ? s.m.designation : undefined}
            labelLift={4}
            labelClass="text-[8px] font-semibold"
          />
        ))}
        {/* the summed total, drawn on top */}
        <path d={linePath(combined, X, Y)} fill="none" stroke={token('thrust')} strokeWidth="2.5" />
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
        <LegendSwatch color={token('thrust')} width={12} strokeWidth={2.5}>
          {t('dash.total')}
        </LegendSwatch>
        {usable.map((s) => (
          <LegendSwatch key={keyOf(s.m)} color={s.color} width={12}>
            {s.m.code || s.m.designation}
          </LegendSwatch>
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
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warn-400/90">{t('dash.combined')}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="rounded bg-ok-500/15 px-1.5 py-0.5 text-xs font-semibold text-ok-300">
          {impulseClass(combined.totalImpulse)}
        </span>
        <h3 className="text-2xl font-bold text-ink-strong">{t('dash.cluster', { n: combined.motorCount })}</h3>
      </div>
      <div className="mt-0.5 text-sm text-ink-muted">{motors.map((m) => m.designation).join(' + ')}</div>
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
        <SpecItem label={t('dash.motors')} value={String(combined.motorCount)} />
        {/* In the user's units, as MotorDetail's grid is; these four
            were the only readouts in the dashboard fixed to N and N.s. */}
        <SpecItem label={t('motorDlg.totalImpulse')} value={inUserUnit(u, 'impulse', combined.totalImpulse, 1, 1)} />
        <SpecItem label={t('motorDlg.maxThrust')} value={inUserUnit(u, 'force', combined.peakThrust, 1, 1)} />
        <SpecItem label={t('motorDlg.avgThrust')} value={inUserUnit(u, 'force', combined.avgThrust, 1, 1)} />
        <SpecItem label={t('motorDlg.burnTime')} value={withFixedUnit(combined.burnTime, 's', 2)} />
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('dash.combineNote')}</p>
    </div>
  );
}
