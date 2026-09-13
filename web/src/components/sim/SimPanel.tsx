import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import type { StaticInfo, FlightResult } from '../../engine/api';
import { lerpAt } from '../../services/interpolate';
import { stabilityTone } from '../../services/simReport';
import { useSettings } from '../../state/SettingsProvider';
import { Stat } from '../common/Stat';

/** Last finite value of a (possibly gappy) series — the value at flight's end. */
function lastFinite(arr?: (number | null)[]): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/** Run button + the active simulation's summary tiles (apogee, max V/A/Mach, times,
 *  rod exit, landing, downrange, deploy speed, optimum delay). */
export function SimPanel({
  info,
  runLabel,
  sim,
  busy,
  onRun,
  blockReason,
}: {
  info: StaticInfo | null;
  runLabel: string;
  sim: FlightResult | null;
  busy: boolean;
  onRun: () => void;
  /** When set, the design can't be simulated (no mount / no motor): the reason
   *  is shown and the Run button is disabled. */
  blockReason?: string | null;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // Each result tile owns its unit: reading apogee in feet should not drag
  // landing speed, downrange and the rest along with it.
  const rodExit = u.at(unitScope('sim', 'rodExit'), 'velocity');
  const railCpUnit = u.at(unitScope('sim', 'railCp'), 'length');
  const apogee = u.at(unitScope('sim', 'apogee'), 'distance');
  const deployVel = u.at(unitScope('sim', 'deployVelocity'), 'velocity');
  const landingVel = u.at(unitScope('sim', 'landing'), 'velocity');
  const downrangeUnit = u.at(unitScope('sim', 'downrange'), 'distance');
  const maxAccel = u.at(unitScope('sim', 'maxAccel'), 'acceleration');
  const maxSpeed = u.at(unitScope('sim', 'maxSpeed'), 'velocity');
  const { settings } = useSettings();
  const { deploymentSpeedWarn, railExitVelocityMin } = settings.simulation;
  const s = sim?.summary;
  // Safe-if-green thresholds (global settings): fast off the rail, gentle at deploy.
  const goodTone = 'text-emerald-400',
    warnTone = 'text-amber-400';
  // Static margin at the instant the rocket clears the rod/rail — the
  // flight-relevant figure (real velocity + partly-burned mass), vs. the on-pad
  // "Stability" tile (Mach 0.3, fully loaded). OpenRocket records the same
  // series but buries it at the "# Event LAUNCHROD" line of a data export.
  const rodTime = sim?.events.find((e) => e.type === 'LAUNCHROD')?.time;
  const railMargin = sim && rodTime != null ? lerpAt(sim.series.time, sim.series.stability, rodTime) : null;
  const railCp = sim && rodTime != null ? lerpAt(sim.series.time, sim.series.cpLocation, rodTime) : null;
  // Downrange (lateral) landing distance from the drift series' final point.
  const px = sim ? lastFinite(sim.series.Px) : null;
  const py = sim ? lastFinite(sim.series.Py) : null;
  const downrange = px != null && py != null ? Math.hypot(px, py) : null;
  return (
    <div className="space-y-4 p-3">
      <button
        onClick={onRun}
        disabled={busy || !info || !!blockReason}
        className="w-full rounded-xl bg-sky-600 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? t('sim.running') : t('sim.run', { name: runLabel })}
      </button>

      {blockReason && !busy && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-300 ring-1 ring-amber-400/30">
          ⚠ {blockReason}
        </p>
      )}

      {s && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
          {/* Chronological: liftoff → boost → apogee → recovery → landing, then peaks. */}
          <Stat
            label={t('sim.rodExit')}
            value={rodExit.fmt(s.launchRodVelocity, 1)}
            sub={<UnitChip quantity="velocity" scope={unitScope('sim', 'rodExit')} />}
            // The threshold is stored in SI, so the comparison stays in SI —
            // only the number on screen changes unit.
            tone={s.launchRodVelocity >= railExitVelocityMin ? goodTone : warnTone}
          />
          {railMargin != null && (
            <Stat
              label={t('sim.railMargin')}
              value={fmtNum(railMargin, 2)}
              sub={
                railCp != null ? (
                  <>
                    {t('stability.caliber')} · CP {railCpUnit.fmt(railCp)}{' '}
                    <UnitChip quantity="length" scope={unitScope('sim', 'railCp')} />
                  </>
                ) : (
                  t('stability.caliber')
                )
              }
              tone={stabilityTone(railMargin)}
            />
          )}
          {s.optimumDelay != null && <Stat label={t('sim.optDelay')} value={fmtNum(s.optimumDelay, 1)} sub="s" />}
          <Stat label={t('sim.toApogee')} value={fmtNum(s.timeToApogee, 1)} sub="s" />
          <Stat
            label={t('sim.apogee')}
            value={apogee.fmt(s.maxAltitude)}
            sub={<UnitChip quantity="distance" scope={unitScope('sim', 'apogee')} />}
            tone="text-sky-400"
          />
          {s.deploymentVelocity != null && (
            <Stat
              label={t('sim.deployVelocity')}
              value={deployVel.fmt(s.deploymentVelocity, 1)}
              sub={<UnitChip quantity="velocity" scope={unitScope('sim', 'deployVelocity')} />}
              tone={s.deploymentVelocity < deploymentSpeedWarn ? goodTone : warnTone}
            />
          )}
          {Number.isFinite(s.groundHitVelocity) && (
            <Stat
              label={t('sim.landing')}
              value={landingVel.fmt(s.groundHitVelocity, 1)}
              sub={<UnitChip quantity="velocity" scope={unitScope('sim', 'landing')} />}
            />
          )}
          <Stat label={t('sim.flightTime')} value={fmtNum(s.flightTime, 1)} sub="s" />
          {Number.isFinite(s.groundHitVelocity) && downrange != null && (
            <Stat
              label={t('sim.downrange')}
              value={downrangeUnit.fmt(downrange)}
              sub={<UnitChip quantity="distance" scope={unitScope('sim', 'downrange')} />}
            />
          )}
          <Stat
            label={t('sim.maxAccel')}
            value={maxAccel.fmt(s.maxAcceleration, 0)}
            sub={<UnitChip quantity="acceleration" scope={unitScope('sim', 'maxAccel')} />}
          />
          <Stat
            label={t('sim.maxSpeed')}
            value={maxSpeed.fmt(s.maxVelocity, 0)}
            sub={<UnitChip quantity="velocity" scope={unitScope('sim', 'maxSpeed')} />}
          />
          <Stat label={t('sim.maxMach')} value={fmtNum(s.maxMachNumber, 2)} sub="Mach" />
        </div>
      )}
      {!s && !busy && !blockReason && <p className="text-center text-sm text-slate-500">{t('sim.prompt')}</p>}
    </div>
  );
}
