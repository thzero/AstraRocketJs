import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import type { CatalogMotor } from '../../services/motors/motorDb';
import { initialThrust } from '../../services/motors/motorPicker';
import { avgThrustOf, ispOf, massFracOf } from '../../services/motors/motorMath';
import { ChartAxes, CHART_HEADROOM, chartScales, linePath, baselineArea, LegendSwatch, peakOf } from './chartAxes';
import { inUserUnit, withFixedUnit } from './motorFormat';
import { token } from '../common/colorTokens';
import { motorSimilarity } from '../../engine/openRocketEngine';
import { loadHideSimilar, saveHideSimilar } from './motorPrefs';
import { finalizeSamples } from '../../services/motors/curveFinalize';

/** Desktop's threshold for "Hide very similar thrust curves" (MOTOR_SIMILARITY_THRESHOLD). */
const SIMILAR = 0.95;

const TYPE_KEY: Record<string, string> = { SU: 'typeSU', reload: 'typeReload', hybrid: 'typeHybrid' };

/** Detail panel for a catalog motor: manufacturer/class header, thrust-curve
 *  chart, and the spec grid. Reads only bundled data (no fetch). */
export function MotorDetail({
  motor,
  onBack,
  curveIndex,
  onCurveChange,
}: {
  motor: CatalogMotor;
  onBack?: () => void;
  curveIndex: number;
  onCurveChange: (i: number) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const curves = useMemo(() => motor.curves ?? [], [motor.curves]);
  const samples = (curves[curveIndex] ?? curves[0])?.samples ?? [];
  const [hideSimilar, setHideSimilarRaw] = useState(loadHideSimilar);
  const setHideSimilar = (on: boolean) => {
    setHideSimilarRaw(on);
    saveHideSimilar(on);
  };
  // The curves the dropdown offers: the one shown, and with the box ticked only
  // those the kernel's MotorCorrelation does not call near duplicates of it.
  // Every curve while the engine is still loading, rather than none.
  const offered = useMemo(
    () =>
      curves
        .map((_, i) => i)
        .filter((i) => {
          if (!hideSimilar || i === curveIndex || !curves[curveIndex]) return true;
          // A curve the kernel cannot compare is offered rather than hidden, and
          // never takes the dialog down with it.
          try {
            const score = motorSimilarity(
              finalizeSamples(curves[curveIndex]!.samples),
              finalizeSamples(curves[i]!.samples),
            );
            return score === null || score < SIMILAR;
          } catch {
            return true;
          }
        }),
    [curves, curveIndex, hideSimilar],
  );
  const title = motor.code || motor.designation;
  const showCommon = !!motor.code && motor.code !== motor.designation;

  // Avg thrust and total impulse are motor-level (certified); peak and initial
  // thrust reflect the specific curve on screen.
  const avg = avgThrustOf(motor);
  const max = samples.length ? Math.max(...samples.map((s) => s[1])) : (motor.maxThrust ?? 0);
  const init = samples.length ? initialThrust(samples) : null;
  // NaN when the catalog lacks the weights; the formatters render a dash.
  const isp = ispOf(motor);
  const massFrac = massFracOf(motor);
  // ThrustCurve's URL keys on the full designation (e.g. "E26W"), not the common
  // name ("E26") — `code` holds it when they differ.
  const tcUrl = `https://www.thrustcurve.org/motors/${encodeURIComponent(motor.manufacturer)}/${encodeURIComponent(motor.code || motor.designation)}/`;

  const g = withFixedUnit;
  // The catalog is in mm / g / N / N.s (see CatalogMotor), so `scale` lifts a
  // field to SI before the user's unit is applied.
  const q = (quantity: Parameters<typeof u.fmt>[0], v: number | null | undefined, scale = 1, d?: number) =>
    inUserUnit(u, quantity, v, scale, d);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
      {onBack && (
        <button onClick={onBack} className="mb-2 self-start text-xs text-accent-400 hover:underline md:hidden">
          ← {t('motorDlg.backToList')}
        </button>
      )}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-warn-400/90">{motor.manufacturer}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="rounded bg-ok-500/15 px-1.5 py-0.5 text-xs font-semibold text-ok-300">{motor.class}</span>
        <h3 className="text-2xl font-bold text-ink-strong">{title}</h3>
      </div>
      <div className="mt-0.5 text-sm text-ink-muted">
        {showCommon && (
          <>
            {t('motorDlg.commonName')} {motor.designation} ·{' '}
          </>
        )}
        {motor.type ? t(`motorDlg.${TYPE_KEY[motor.type] ?? ''}`, { defaultValue: motor.type }) : ''}
      </div>
      <a
        href={tcUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1 self-start text-sm text-accent-400 hover:underline"
      >
        {t('motorDlg.viewOnTc')} ↗
      </a>

      {motor.oop && <p className="mt-1 text-xs font-medium text-warn-300">{t('motorDlg.oop')}</p>}

      {curves.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('motorDlg.curve')}
            </span>
            <select
              value={curveIndex}
              onChange={(e) => onCurveChange(Number(e.target.value))}
              className="rounded-md bg-canvas px-2 py-1 text-xs text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
            >
              {offered.map((i) => (
                <option key={i} value={i}>
                  {curves[i]!.src} ({curves[i]!.samples.length})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-soft" title={t('motorDlg.hideSimilarHint')}>
            <input
              type="checkbox"
              checked={hideSimilar}
              onChange={(e) => setHideSimilar(e.target.checked)}
              className="accent-accent-500"
            />
            {t('motorDlg.hideSimilar')}
          </label>
        </div>
      )}

      {samples.length >= 2 ? (
        <ThrustChart samples={samples} avg={avg} burn={motor.burn} />
      ) : (
        <p className="my-4 rounded-lg bg-raised/50 p-3 text-xs text-ink-muted">{t('motorDlg.noCurve')}</p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <SpecItem label={t('motorDlg.commonName')} value={motor.designation} />
        <SpecItem
          label={t('motorDlg.motorType')}
          value={motor.type ? t(`motorDlg.${TYPE_KEY[motor.type] ?? ''}`, { defaultValue: motor.type }) : '—'}
        />
        <SpecItem label={t('motorDlg.delays')} value={motor.delays ?? '—'} />
        <SpecItem label={t('prop.diameter')} value={q('motorDimensions', motor.diameter, 0.001)} />
        <SpecItem label={t('prop.length')} value={q('motorDimensions', motor.length, 0.001)} />
        <SpecItem label={t('motorDlg.totalWeight')} value={q('mass', motor.mass, 0.001)} />
        <SpecItem label={t('motorDlg.propWeight')} value={q('mass', motor.propWeightG, 0.001)} />
        <SpecItem label={t('motorDlg.avgThrust')} value={q('force', avg, 1, 1)} />
        <SpecItem label={t('motorDlg.initialThrust') + '*'} value={q('force', init, 1, 1)} />
        <SpecItem label={t('motorDlg.maxThrust')} value={q('force', max, 1, 1)} />
        <SpecItem label={t('motorDlg.totalImpulse')} value={q('impulse', motor.impulse, 1, 1)} />
        <SpecItem label={t('motorDlg.burnTime')} value={g(motor.burn, 's', 2)} />
        <SpecItem label={t('motorDlg.isp') + '*'} value={g(isp, 's', 0)} />
        <SpecItem
          label={t('motorDlg.massFraction') + '*'}
          value={Number.isFinite(massFrac) ? `${fmtNum(massFrac, 0)}%` : '—'}
        />
        <SpecItem label={t('motorDlg.propType')} value={motor.propInfo ?? '—'} />
        <SpecItem label={t('motorDlg.sparky')} value={t(motor.sparky ? 'motorDlg.yes' : 'motorDlg.no')} />
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('motorDlg.calcNote')}</p>
    </div>
  );
}

/** One term and its value in a motor spec `<dl>`. Renders `<dt>`/`<dd>`, so it
 *  must sit inside a `<dl>`; for a free-standing tile use `common/Stat`. */
export function SpecItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="text-sm font-semibold text-ink-strong">{value}</dd>
    </div>
  );
}

/** Compact thrust-vs-time chart: filled curve, average-thrust line, burn marker. */
export function ThrustChart({ samples, avg, burn }: { samples: [number, number][]; avg: number; burn: number }) {
  const { t } = useTranslation();
  const u = useUnits();
  const dims = { width: 460, height: 150, padL: 34, padR: 10, padT: 10, padB: 22 };
  const { width: W, height: H, padL: PL, padR: PR, padT: PT, padB: PB } = dims;
  const tMax = samples[samples.length - 1]![0] || 1;
  const fMax = Math.max(...samples.map((s) => s[1]), avg) * CHART_HEADROOM || 1;
  const { X, Y } = chartScales(dims, tMax, fMax);
  const line = linePath(samples, X, Y);
  const area = baselineArea(samples, X, Y, tMax);
  const peak = peakOf(samples);

  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
        <defs>
          <linearGradient id="thrustFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={token('thrust')} stopOpacity="0.45" />
            <stop offset="100%" stopColor={token('thrust')} stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {/* initial-thrust window (0–0.5 s) */}
        {0.5 < tMax && (
          <rect x={X(0)} y={PT} width={X(0.5) - X(0)} height={H - PT - PB} fill={token('thrust-band')} opacity="0.06" />
        )}
        <ChartAxes dims={dims} tMax={tMax} fMax={fMax} X={X} Y={Y} fScale={u.factor('force')} />
        <path d={area} fill="url(#thrustFill)" />
        <line
          x1={PL}
          y1={Y(avg)}
          x2={W - PR}
          y2={Y(avg)}
          stroke={token('thrust-average')}
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        {burn > 0 && burn <= tMax && (
          <line
            x1={X(burn)}
            y1={PT}
            x2={X(burn)}
            y2={H - PB}
            stroke={token('thrust-burnout')}
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}
        <path d={line} fill="none" stroke={token('thrust')} strokeWidth="1.75" />
        <circle cx={X(peak[0])} cy={Y(peak[1])} r="3" fill={token('thrust')} />
        <text x={X(peak[0])} y={Y(peak[1]) - 6} textAnchor="middle" className="fill-ink text-[9px] font-semibold">
          {u.fmtSym('force', peak[1], 1)}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-muted">
        <LegendSwatch color={token('thrust')} width={14}>
          {t('motorDlg.chartThrust')}
        </LegendSwatch>
        <LegendSwatch color={token('thrust-average')} width={14} dash>
          {t('motorDlg.chartAvg')}
        </LegendSwatch>
        <LegendSwatch color={token('thrust-burnout')} width={14} dash>
          {t('motorDlg.chartBurn')}
        </LegendSwatch>
      </div>
    </div>
  );
}
