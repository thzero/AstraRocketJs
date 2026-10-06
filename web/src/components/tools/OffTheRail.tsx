import { useState } from 'react';
import { defaultToolSite, rememberedSlot, useRemembered } from './remembered';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import { useSettings } from '../../state/SettingsProvider';
import type { MotorSpec } from '../../engine/openRocketEngine';
import { fmtNum, fmtSiteTime } from '../../i18n/format';
import { hourInZone, nextHourMs, todayYmd, ymdInZone } from '../../services/weather/openMeteo';
import { readWeatherKey } from '../../services/weather/weatherKey';
import {
  maxDryMassKg,
  maxWindMs,
  MIN_THRUST_TO_WEIGHT,
  railExit,
  weathercockDeg,
  WEATHERCOCK_LIMIT_DEG,
} from '../../services/tools/railExit';
import { fetchSurfaceWind, type SurfaceWind } from '../../services/tools/surfaceWind';
import { MotorDialog } from '../sim/MotorDialog';
import { QNum } from '../sim/LaunchPanel';
import { SiteFields, toolBtn, type ToolSite } from './SiteFields';
import { WhenFields } from '../sim/WhenFields';
import { CardGroup } from '../common/CardGroup';
import { OpenMeteoCredit } from '../common/OpenMeteoCredit';
import { weatherErrorText } from '../../services/weather/weatherErrorText';
import { roundTo } from '../../services/app/numbers';
import { useLatest } from '../common/useLatest';
import { motorName } from '../../services/motors/motorName';

/**
 * Off the rail, for a rocket that has not been designed here: a motor from the
 * catalog, the rest of the rocket's mass and the rail give the thrust-to-weight,
 * the rail exit speed and, with a wind, the weathercock angle (services/tools).
 * An estimate without drag or rail friction, and it says so; a designed rocket
 * gets these from the engine, on its rail departure event.
 */

type Fetch =
  { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; wind: SurfaceWind };

interface Remembered {
  motor: MotorSpec | null;
  dryMassKg: number | null;
  railLengthM: number | null;
  windMs: number | null;
  site: ToolSite;
  date: string;
  hour: number;
  fetched: Fetch;
}
const remembered = rememberedSlot<Remembered>();

/** Clears the remembered inputs, so each test starts from the defaults. */
export function forgetOffTheRail(): void {
  remembered.forget();
}

export function OffTheRail() {
  const { t } = useTranslation();
  const u = useUnits();
  const { settings } = useSettings();
  const minExit = settings.simulation.railExitVelocityMin;
  const defaults = settings.launchDefaults;
  const [motor, setMotor] = useRemembered(remembered, 'motor', null);
  const [dryMassKg, setDryMassKg] = useRemembered(remembered, 'dryMassKg', 0.5);
  const [railLengthM, setRailLengthM] = useRemembered(remembered, 'railLengthM', defaults.launchRodLengthM ?? 1);
  const [windMs, setWindMs] = useRemembered(remembered, 'windMs', 4);
  const [site, setSite] = useRemembered(remembered, 'site', defaultToolSite(defaults));
  const [date, setDate] = useRemembered(remembered, 'date', ymdInZone(nextHourMs(), undefined));
  const [hour, setHour] = useRemembered(remembered, 'hour', hourInZone(nextHourMs(), undefined));
  // A request still out when the tab closed was aborted, so it comes back idle.
  const [fetched, setFetched] = useRemembered(remembered, 'fetched', { kind: 'idle' }, (f): Fetch =>
    f.kind === 'loading' ? { kind: 'idle' } : f,
  );
  const [motorOpen, setMotorOpen] = useState(false);
  const [motorError, setMotorError] = useState<string | null>(null);
  const request = useLatest();

  const getWind = async () => {
    if (site.latitudeDeg == null || site.longitudeDeg == null) return;
    const signal = request.claimSignal();
    setFetched({ kind: 'loading' });
    try {
      const wind = await fetchSurfaceWind(
        {
          latitudeDeg: site.latitudeDeg,
          longitudeDeg: site.longitudeDeg,
          date,
          hour,
          today: todayYmd(),
          apiKey: readWeatherKey(),
        },
        { signal },
      );
      if (signal.aborted) return;
      if (wind === 'noHour') {
        setFetched({ kind: 'error', message: t('weather.noHour') });
        return;
      }
      setFetched({ kind: 'ready', wind });
      setWindMs(roundTo(wind.speedMs, 1));
    } catch (err) {
      if (signal.aborted) return;
      setFetched({ kind: 'error', message: weatherErrorText(err, t) });
    }
  };

  const ready = motor != null && dryMassKg != null && dryMassKg >= 0 && railLengthM != null && railLengthM > 0;
  const exit = ready ? railExit({ motor, dryMassKg, railLengthM }) : null;
  const ok = exit != null && typeof exit !== 'string' ? exit : null;
  const heaviest = ready && ok ? maxDryMassKg(motor, railLengthM, minExit) : null;
  const angle = ok && windMs != null ? weathercockDeg(windMs, ok.exitSpeedMs) : null;
  const gustAngle =
    ok && fetched.kind === 'ready' && fetched.wind.gustMs != null
      ? weathercockDeg(fetched.wind.gustMs, ok.exitSpeedMs)
      : null;

  const speed = u.plain('velocity');
  const wind = u.plain('windspeed');
  const mass = u.plain('mass');
  const fmtSpeed = (ms: number) => `${speed.fmtSym(ms, 1)}`;
  const fmtWind = (ms: number) => `${wind.fmtSym(ms, 1)}`;
  const fmtMass = (kg: number) => `${mass.fmtSym(kg)}`;
  const ratio = (r: number) => `${fmtNum(r, 1)} : 1`;
  const warn = 'text-amber-400';

  const validTime =
    fetched.kind === 'ready'
      ? fmtSiteTime(fetched.wind.validUnix * 1000, fetched.wind.answer.timezone, { year: false })
      : '';

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,28rem)]">
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">{t('rail.title')}</h2>
          <p className="mt-1 text-xs text-slate-400">{t('rail.intro')}</p>
        </div>

        <CardGroup title={t('rail.motor')}>
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-slate-200">
              {motor ? `${motor.manufacturer ? `${motor.manufacturer} ` : ''}${motorName(motor)}` : t('rail.noMotor')}
            </span>
            <button className={toolBtn} onClick={() => setMotorOpen(true)}>
              {motor ? t('sims.changeMotor') : t('rail.chooseMotor')}
            </button>
          </div>
          {motorError && <p className="text-xs text-rose-400">{motorError}</p>}
        </CardGroup>

        <CardGroup title={t('rail.rocket')}>
          <QNum
            label={t('rail.dryMass')}
            hint={t('rail.dryMassHint')}
            field="railDryMass"
            kind="mass"
            u={u}
            stepSi={0.01}
            minSi={0}
            maxSi={1000}
            required
            missing={dryMassKg == null}
            value={dryMassKg}
            onChange={setDryMassKg}
          />
          <QNum
            label={t('launch.rodLengthName')}
            field="railLength"
            kind="length"
            u={u}
            stepSi={0.1}
            minSi={0.1}
            maxSi={20}
            required
            missing={railLengthM == null}
            value={railLengthM}
            onChange={setRailLengthM}
          />
        </CardGroup>

        <CardGroup title={t('launch.wind')}>
          <QNum
            label={t('rail.wind')}
            field="railWind"
            kind="windspeed"
            u={u}
            stepSi={0.5}
            minSi={0}
            maxSi={60}
            value={windMs}
            onChange={setWindMs}
          />
          <details className="rounded-md bg-slate-950/40 p-2" open={fetched.kind !== 'idle' || undefined}>
            <summary className="cursor-pointer text-xs font-medium text-sky-300">{t('rail.fromForecast')}</summary>
            <div className="mt-2 space-y-2">
              <SiteFields site={site} onChange={setSite} />
              <WhenFields date={date} hour={hour} onDate={setDate} onHour={setHour} />
              <button
                className={`${toolBtn} w-full`}
                disabled={site.latitudeDeg == null || site.longitudeDeg == null || fetched.kind === 'loading'}
                onClick={() => void getWind()}
              >
                {fetched.kind === 'loading' ? t('rail.fetching') : t('rail.fetchWind')}
              </button>
              {fetched.kind === 'error' && <p className="text-xs text-rose-400">{fetched.message}</p>}
              {fetched.kind === 'ready' && (
                <>
                  <p className="text-xs text-slate-400">
                    {t(fetched.wind.gustMs != null ? 'rail.forecastWindGust' : 'rail.forecastWind', {
                      wind: fmtWind(fetched.wind.speedMs),
                      gust: fetched.wind.gustMs != null ? fmtWind(fetched.wind.gustMs) : '',
                      when: validTime,
                    })}
                  </p>
                  <OpenMeteoCredit />
                </>
              )}
            </div>
          </details>
        </CardGroup>
      </div>

      <section className="h-fit rounded-xl bg-slate-900 p-3 ring-1 ring-white/10" aria-label={t('rail.result')}>
        {!ready ? (
          <p className="text-xs text-slate-400">{t('rail.empty')}</p>
        ) : exit === 'noLiftoff' ? (
          <p className={`text-sm ${warn}`}>{t('rail.noLiftoff')}</p>
        ) : exit === 'stalls' ? (
          <p className={`text-sm ${warn}`}>{t('rail.stalls')}</p>
        ) : ok ? (
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <Stat label={t('rail.liftoffMass')}>{fmtMass(ok.liftoffMassKg)}</Stat>
              <Stat label={t('rail.twrAverage')}>
                <span className={ok.thrustToWeightAverage < MIN_THRUST_TO_WEIGHT ? warn : undefined}>
                  {ratio(ok.thrustToWeightAverage)}
                </span>
              </Stat>
              <Stat label={t('rail.twrPeak')}>{ratio(ok.thrustToWeightPeak)}</Stat>
              <Stat label={t('rail.twrAtExit')}>{ratio(ok.thrustToWeightAtExit)}</Stat>
              <Stat label={t('rail.exitSpeed')}>
                <span className={ok.exitSpeedMs < minExit ? warn : undefined}>{fmtSpeed(ok.exitSpeedMs)}</span>
              </Stat>
              <Stat label={t('rail.exitTime')}>{`${fmtNum(ok.exitS, 2)} s`}</Stat>
              {angle != null && (
                <Stat label={t('rail.weathercock')}>
                  <span className={angle > WEATHERCOCK_LIMIT_DEG ? warn : undefined}>{`${fmtNum(angle, 1)}°`}</span>
                </Stat>
              )}
              {gustAngle != null && (
                <Stat label={t('rail.weathercockGust')}>
                  <span className={gustAngle > WEATHERCOCK_LIMIT_DEG ? warn : undefined}>
                    {`${fmtNum(gustAngle, 1)}°`}
                  </span>
                </Stat>
              )}
              <Stat label={t('rail.maxWind', { angle: WEATHERCOCK_LIMIT_DEG })}>
                {fmtWind(maxWindMs(ok.exitSpeedMs))}
              </Stat>
              <Stat label={t('rail.maxDryMass')}>{heaviest != null ? fmtMass(heaviest) : t('rail.none')}</Stat>
            </dl>
            <p className="text-[11px] text-slate-500">
              {t('rail.rules', {
                ratio: MIN_THRUST_TO_WEIGHT,
                speed: fmtSpeed(minExit),
                angle: WEATHERCOCK_LIMIT_DEG,
              })}
            </p>
            <p className="text-[11px] text-slate-500">{t('rail.estimateNote')}</p>
          </div>
        ) : null}
      </section>

      {motorOpen && (
        <MotorDialog
          onClose={() => setMotorOpen(false)}
          onSelect={(m) => {
            setMotor(m);
            setMotorError(null);
            setMotorOpen(false);
          }}
          onError={setMotorError}
          mount={null}
          current={motor}
        />
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right tabular-nums text-slate-200">{children}</dd>
    </>
  );
}
