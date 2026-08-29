import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { StaticInfo, FlightResult } from '../../engine/api';
import { Stat } from '../common/Stat';

/** Run button + the active simulation's summary tiles (apogee, max V/A, times, rod exit). */
export function SimPanel({ info, runLabel, sim, busy, onRun }: {
  info: StaticInfo | null;
  runLabel: string;
  sim: FlightResult | null;
  busy: boolean;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const s = sim?.summary;
  return (
    <div className="space-y-4 p-3">
      <button
        onClick={onRun}
        disabled={busy || !info}
        className="w-full rounded-xl bg-sky-600 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? t('sim.running') : t('sim.run', { name: runLabel })}
      </button>

      {s && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
          <Stat label={t('sim.apogee')} value={fmtNum(s.maxAltitude, 0)} sub="m" tone="text-sky-400" />
          <Stat label={t('sim.maxSpeed')} value={fmtNum(s.maxVelocity, 0)} sub="m/s" />
          <Stat label={t('sim.maxAccel')} value={fmtNum(s.maxAcceleration, 0)} sub="m/s²" />
          <Stat label={t('sim.toApogee')} value={fmtNum(s.timeToApogee, 1)} sub="s" />
          <Stat label={t('sim.flightTime')} value={fmtNum(s.flightTime, 1)} sub="s" />
          <Stat label={t('sim.rodExit')} value={fmtNum(s.launchRodVelocity, 1)} sub="m/s" />
        </div>
      )}
      {!s && !busy && <p className="text-center text-sm text-slate-500">{t('sim.prompt')}</p>}
    </div>
  );
}
