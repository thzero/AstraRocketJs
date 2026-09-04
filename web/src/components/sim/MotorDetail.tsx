import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { CatalogMotor } from '../../services/motorDb';
import { initialThrust } from '../../services/motorPicker';

const G = 9.80665;

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
  const curves = motor.curves ?? [];
  const samples = (curves[curveIndex] ?? curves[0])?.samples ?? [];
  const title = motor.code || motor.designation;
  const showCommon = !!motor.code && motor.code !== motor.designation;

  // Avg thrust and total impulse are motor-level (certified); peak and initial
  // thrust reflect the specific curve on screen.
  const avg = motor.avgThrust ?? (motor.burn > 0 ? motor.impulse / motor.burn : 0);
  const max = samples.length ? Math.max(...samples.map((s) => s[1])) : (motor.maxThrust ?? 0);
  const init = samples.length ? initialThrust(samples) : null;
  const isp = motor.propWeightG ? motor.impulse / ((motor.propWeightG / 1000) * G) : null;
  const massFrac = motor.propWeightG && motor.mass ? (motor.propWeightG / motor.mass) * 100 : null;
  // ThrustCurve's URL keys on the full designation (e.g. "E26W"), not the common
  // name ("E26") — `code` holds it when they differ.
  const tcUrl = `https://www.thrustcurve.org/motors/${encodeURIComponent(motor.manufacturer)}/${encodeURIComponent(motor.code || motor.designation)}/`;

  const g = (v: number | null | undefined, unit: string, digits = 1) =>
    v == null || !Number.isFinite(v) ? '—' : `${fmtNum(v, digits)} ${unit}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
      {onBack && (
        <button onClick={onBack} className="mb-2 self-start text-xs text-sky-400 hover:underline md:hidden">
          ← {t('motorDlg.backToList')}
        </button>
      )}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">{motor.manufacturer}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-300">
          {motor.class}
        </span>
        <h3 className="text-2xl font-bold text-slate-100">{title}</h3>
      </div>
      <div className="mt-0.5 text-sm text-slate-400">
        {showCommon && (
          <>
            {t('motorDlg.commonName')} {motor.designation} ·{' '}
          </>
        )}
        {motor.type ? t(`motorDlg.${TYPE_KEY[motor.type] ?? ''}`, { defaultValue: motor.type }) : ''}
      </div>
      <a href={tcUrl} target="_blank" rel="noreferrer" className="mt-1 self-start text-sm text-sky-400 hover:underline">
        {t('motorDlg.viewOnTc')} ↗
      </a>

      {curves.length > 1 && (
        <label className="mt-4 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {t('motorDlg.curve')}
          </span>
          <select
            value={curveIndex}
            onChange={(e) => onCurveChange(Number(e.target.value))}
            className="rounded-md bg-slate-950 px-2 py-1 text-xs text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          >
            {curves.map((c, i) => (
              <option key={i} value={i}>
                {c.src} ({c.samples.length})
              </option>
            ))}
          </select>
        </label>
      )}

      {samples.length >= 2 ? (
        <ThrustChart samples={samples} avg={avg} burn={motor.burn} />
      ) : (
        <p className="my-4 rounded-lg bg-slate-800/50 p-3 text-xs text-slate-400">{t('motorDlg.noCurve')}</p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label={t('motorDlg.commonName')} value={motor.designation} />
        <Stat
          label={t('motorDlg.motorType')}
          value={motor.type ? t(`motorDlg.${TYPE_KEY[motor.type] ?? ''}`, { defaultValue: motor.type }) : '—'}
        />
        <Stat label={t('motorDlg.delays')} value={motor.delays ?? '—'} />
        <Stat label={t('prop.diameter')} value={g(motor.diameter, 'mm', 0)} />
        <Stat label={t('prop.length')} value={g(motor.length, 'mm')} />
        <Stat label={t('motorDlg.totalWeight')} value={g(motor.mass, 'g')} />
        <Stat label={t('motorDlg.propWeight')} value={g(motor.propWeightG, 'g')} />
        <Stat label={t('motorDlg.avgThrust')} value={g(avg, 'N')} />
        <Stat label={t('motorDlg.initialThrust') + '*'} value={g(init, 'N')} />
        <Stat label={t('motorDlg.maxThrust')} value={g(max, 'N')} />
        <Stat label={t('motorDlg.totalImpulse')} value={g(motor.impulse, 'N·s')} />
        <Stat label={t('motorDlg.burnTime')} value={g(motor.burn, 's', 2)} />
        <Stat label={t('motorDlg.isp') + '*'} value={g(isp, 's', 0)} />
        <Stat label={t('motorDlg.massFraction') + '*'} value={massFrac == null ? '—' : `${fmtNum(massFrac, 0)}%`} />
        <Stat label={t('motorDlg.propType')} value={motor.propInfo ?? '—'} />
        <Stat label={t('motorDlg.sparky')} value={t(motor.sparky ? 'motorDlg.yes' : 'motorDlg.no')} />
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('motorDlg.calcNote')}</p>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-100">{value}</dd>
    </div>
  );
}

/** Compact thrust-vs-time chart: filled curve, average-thrust line, burn marker. */
export function ThrustChart({ samples, avg, burn }: { samples: [number, number][]; avg: number; burn: number }) {
  const { t } = useTranslation();
  const W = 460,
    H = 150,
    PL = 34,
    PR = 10,
    PT = 10,
    PB = 22;
  const tMax = samples[samples.length - 1]![0] || 1;
  const fMax = Math.max(...samples.map((s) => s[1]), avg) * 1.08 || 1;
  const X = (tt: number) => PL + (tt / tMax) * (W - PL - PR);
  const Y = (f: number) => H - PB - (f / fMax) * (H - PT - PB);
  const line = samples.map((s, i) => `${i ? 'L' : 'M'} ${X(s[0]).toFixed(1)} ${Y(s[1]).toFixed(1)}`).join(' ');
  const area = `M ${X(0).toFixed(1)} ${Y(0).toFixed(1)} ${samples.map((s) => `L ${X(s[0]).toFixed(1)} ${Y(s[1]).toFixed(1)}`).join(' ')} L ${X(tMax).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const peak = samples.reduce((a, b) => (b[1] > a[1] ? b : a));

  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
        <defs>
          <linearGradient id="thrustFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {/* initial-thrust window (0–0.5 s) */}
        {0.5 < tMax && (
          <rect x={X(0)} y={PT} width={X(0.5) - X(0)} height={H - PT - PB} fill="#22d3ee" opacity="0.06" />
        )}
        {[0, 0.5, 1].map((f) => {
          const gy = Y(fMax * f);
          return (
            <g key={f}>
              <line x1={PL} y1={gy} x2={W - PR} y2={gy} className="stroke-white/10" />
              <text x={PL - 4} y={gy + 3} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
                {fmtNum(fMax * f, 0)}
              </text>
            </g>
          );
        })}
        <path d={area} fill="url(#thrustFill)" />
        <line x1={PL} y1={Y(avg)} x2={W - PR} y2={Y(avg)} stroke="#2dd4bf" strokeWidth="1" strokeDasharray="4 3" />
        {burn > 0 && burn <= tMax && (
          <line x1={X(burn)} y1={PT} x2={X(burn)} y2={H - PB} stroke="#eab308" strokeWidth="1" strokeDasharray="2 3" />
        )}
        <path d={line} fill="none" stroke="#f97316" strokeWidth="1.75" />
        <circle cx={X(peak[0])} cy={Y(peak[1])} r="3" fill="#f97316" />
        <text x={X(peak[0])} y={Y(peak[1]) - 6} textAnchor="middle" className="fill-slate-200 text-[9px] font-semibold">
          {fmtNum(peak[1], 1)} N
        </text>
        {[0, tMax / 2, tMax].map((tt, i) => (
          <text key={i} x={X(tt)} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[9px] tabular-nums">
            {fmtNum(tt, tt < 10 ? 1 : 0)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
        <Legend color="#f97316">{t('motorDlg.chartThrust')}</Legend>
        <Legend color="#2dd4bf" dash>
          {t('motorDlg.chartAvg')}
        </Legend>
        <Legend color="#eab308" dash>
          {t('motorDlg.chartBurn')}
        </Legend>
      </div>
    </div>
  );
}

function Legend({ color, dash, children }: { color: string; dash?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg width="14" height="4" aria-hidden>
        <line x1="0" y1="2" x2="14" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dash ? '3 2' : undefined} />
      </svg>
      {children}
    </span>
  );
}
