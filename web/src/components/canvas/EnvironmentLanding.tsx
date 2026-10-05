import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtGroundDistance, useUnits } from '../../prefs/useUnits';
import { configOf, useWorkspaceStore } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import type { ResultFlight } from '../../services/flight/simulations';
import { landingPoint, trackPoints, type GroundPoint } from '../../services/flight/groundTrack';
import { driftEllipse } from '../../services/flight/driftEllipse';
import { isComplete } from '../../services/flight/requiredLaunch';
import { flyForecastHours, type HourLanding } from '../../services/flight/forecastHours';
import { offsetToLatLon } from '../../services/landing/descentDrift';
import { WeatherError } from '../../services/weather/openMeteo';
import { readWeatherKey } from '../../services/weather/weatherKey';
import { LandingMap } from '../tools/LandingMap';
import { formatCoord } from '../../services/map/slippyMap';
import { unitScope } from '../../prefs/units';

/**
 * Where the flight came down, and, when its conditions came from a forecast,
 * where it would have come down an hour or two either side: the same design
 * flown by the engine under each of those hours' forecast. The spread is what
 * moving the launch inside the window would do to the walk.
 */

type Run =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'error'; message: string }
  | { kind: 'done'; hours: HourLanding[] };

const btn =
  'rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-50';

export function EnvironmentLanding({ flight }: { flight: ResultFlight }) {
  const { t, i18n } = useTranslation();
  const u = useUnits();
  // The flight's distance unit, as Ground Track reads this same landing.
  const dist = u.at(unitScope('sim', 'apogee'), 'distance');
  const { settings } = useSettings();
  const tree = useWorkspaceStore((s) => s.tree);
  const configs = useWorkspaceStore((s) => s.configs);
  const sim = useWorkspaceStore((s) => s.sims.find((x) => x.id === flight.id));
  // Each state remembers the result it was for: a different flight, or a
  // re-run, is a different question, and its answer reads as not asked yet.
  const [held, setHeld] = useState<{ for: unknown; run: Run }>({ for: null, run: { kind: 'idle' } });
  const run: Run = held.for === flight.result ? held.run : { kind: 'idle' };
  const setRun = (r: Run, forResult: unknown = flight.result) => setHeld({ for: forResult, run: r });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const branches = flight.result.branches?.length ? flight.result.branches : [{ series: flight.result.series }];
  const main = branches[0]!.series;
  const path = trackPoints(main);
  const landing = landingPoint(main);
  const { latitudeDeg: lat, longitudeDeg: lon } = flight.launch;
  const source = flight.launch.weatherSource;
  if (!landing || lat == null || lon == null) return null;

  const fmtM = (m: number) => fmtGroundDistance(dist, m);
  const bearing = (p: GroundPoint) =>
    `${Math.round(((((Math.atan2(p.east, p.north) * 180) / Math.PI) % 360) + 360) % 360)}°`;
  const where = (p: GroundPoint) => {
    const ll = offsetToLatLon(lat, lon, p);
    return formatCoord(ll.lat, ll.lon, 5);
  };

  const fly = async () => {
    if (!source || !sim || !isComplete(sim.launch)) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const forResult = flight.result;
    setRun({ kind: 'running', done: 0, total: 0 }, forResult);
    try {
      const hours = await flyForecastHours(
        {
          tree,
          config: configOf(configs, sim),
          launch: sim.launch,
          source,
          prefs: { ...settings.simulation, ...sim.prefs },
          apiKey: readWeatherKey(),
          onProgress: (done, total) => {
            if (!ctl.signal.aborted) setRun({ kind: 'running', done, total }, forResult);
          },
        },
        { signal: ctl.signal },
      );
      if (!ctl.signal.aborted) setRun({ kind: 'done', hours }, forResult);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setRun(
        {
          kind: 'error',
          message:
            err instanceof WeatherError
              ? t(`weather.error.${err.kind}`, { detail: err.detail ?? '' })
              : t('env.landing.failed'),
        },
        forResult,
      );
    }
  };

  const hourLandings = run.kind === 'done' ? run.hours.flatMap((h) => (h.landings[0] ? [h.landings[0]] : [])) : [];
  const spread = hourLandings.length >= 3 ? driftEllipse(hourLandings) : null;
  const hourLabel = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      timeZone: source?.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));

  return (
    <section className="space-y-3 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('env.landing.title')}</h3>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-1 text-xs">
        {branches.map((b, i) => {
          const p = landingPoint(b.series);
          if (!p) return null;
          return (
            <div key={i}>
              <dt className="text-slate-400">
                {branches.length > 1 ? t('env.landing.stage', { stage: i + 1 }) : t('landing.lands')}
              </dt>
              <dd className="tabular-nums text-slate-100">{where(p)}</dd>
              <dd className="tabular-nums text-slate-300">{`${fmtM(Math.hypot(p.east, p.north))}, ${bearing(p)}`}</dd>
            </div>
          );
        })}
      </dl>

      {source?.endpoint === 'forecast' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button className={btn} disabled={run.kind === 'running' || !sim} onClick={() => void fly()}>
              {run.kind === 'running'
                ? t('env.landing.flying', { done: run.done, total: run.total })
                : t('env.landing.flyHours')}
            </button>
            <p className="text-xs text-slate-400">{t('env.landing.flyHoursNote')}</p>
          </div>
          <p role="status" aria-live="polite" className="text-xs text-amber-400">
            {run.kind === 'error' ? run.message : ''}
          </p>
          {run.kind === 'done' && (
            <>
              <LandingMap
                latitudeDeg={lat}
                longitudeDeg={lon}
                path={path}
                landing={landing}
                samples={hourLandings}
                ellipse={spread}
                distanceUnit={dist}
              />
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="font-normal">{t('env.landing.hour')}</th>
                    <th className="font-normal">{t('landing.distance')}</th>
                    <th className="font-normal">{t('landing.bearing')}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-slate-100">
                  {run.hours.map((h) => {
                    const p = h.landings[0];
                    return (
                      <tr key={h.offset} className={h.offset === 0 ? 'text-sky-300' : ''}>
                        <td>{hourLabel(h.validMs)}</td>
                        <td>{p ? fmtM(Math.hypot(p.east, p.north)) : '—'}</td>
                        <td>{p ? bearing(p) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">{t('env.landing.noForecast')}</p>
      )}
    </section>
  );
}
