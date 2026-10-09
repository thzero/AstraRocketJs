import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtGroundDistance, useUnits } from '../../prefs/useUnits';
import { configOf, selectOutdated, useWorkspaceStore } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import type { ResultFlight } from '../../services/flight/simulations';
import {
  type GroundPoint,
  bearingFromPad,
  distanceFromPad,
  landingLatLon,
  landingPoint,
  trackPoints,
} from '../../services/flight/groundTrack';
import { driftEllipse } from '../../services/flight/driftEllipse';
import { isComplete } from '../../services/flight/requiredLaunch';
import { flyForecastHours, refusalKeys, type HourLanding } from '../../services/flight/forecastHours';
import { offsetToLatLon } from '../../services/map/geodesy';
import { readWeatherKey } from '../../services/weather/weatherKey';
import { LandingMap } from '../tools/LandingMap';
import { formatCoord } from '../../services/map/slippyMap';
import { unitScope } from '../../prefs/units';
import { weatherErrorText } from '../../services/weather/weatherErrorText';
import { fmtSiteTime } from '../../i18n/format';
import { type FlightSeries } from '../../engine/openRocketEngine';
import { useLatest } from '../common/useLatest';
import { TermRow } from '../common/TermRow';
import { flightBranches } from '../../services/flight/flightColumns';
import { useOnline } from '../common/useOnline';

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
  'rounded-md bg-raised px-3 py-1.5 text-xs font-medium text-accent-300 ring-1 ring-line/10 hover:bg-elevated disabled:opacity-50';

export function EnvironmentLanding({ flight }: { flight: ResultFlight }) {
  const { t } = useTranslation();
  const online = useOnline();
  const u = useUnits();
  // The flight's distance unit, as Ground Track reads this same landing.
  const dist = u.at(unitScope('sim', 'apogee'), 'distance');
  const { settings } = useSettings();
  const tree = useWorkspaceStore((s) => s.tree);
  const configs = useWorkspaceStore((s) => s.configs);
  const sim = useWorkspaceStore((s) => s.sims.find((x) => x.id === flight.id));
  // The hours are flown with the design and the row's conditions as they are
  // now. Against an outdated result that is a different rocket or site than
  // the landing beside it, so the action waits for a fresh run.
  const outdated = useWorkspaceStore((s) => {
    const row = s.sims.find((x) => x.id === flight.id);
    return row ? selectOutdated(s, row) : false;
  });
  // Each state remembers the result it was for: a different flight, or a
  // re-run, is a different question, and its answer reads as not asked yet.
  const [held, setHeld] = useState<{ for: unknown; run: Run }>({ for: null, run: { kind: 'idle' } });
  const run: Run = held.for === flight.result ? held.run : { kind: 'idle' };
  const setRun = (r: Run, forResult: unknown = flight.result) => setHeld({ for: forResult, run: r });
  const request = useLatest();

  const branches = flightBranches(flight.result);
  const main = branches[0]!.series;
  const path = trackPoints(main);
  const landing = landingPoint(main);
  const { latitudeDeg: lat, longitudeDeg: lon } = flight.launch;
  const source = flight.launch.weatherSource;
  if (!landing || lat == null || lon == null) return null;

  const fmtM = (m: number) => fmtGroundDistance(dist, m);
  const bearing = (p: GroundPoint) => `${Math.round(bearingFromPad(p))}°`;
  // The kernel's own landing coordinate when the result carries it; a result
  // without one (an older saved result) falls back to projecting the offset.
  const where = (series: FlightSeries | undefined, p: GroundPoint) => {
    const ll = landingLatLon(series) ?? offsetToLatLon(lat, lon, p);
    return formatCoord(ll.lat, ll.lon, 5);
  };

  const fly = async () => {
    if (!source || !sim || outdated || !isComplete(sim.launch)) return;
    const signal = request.claimSignal();
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
            if (!signal.aborted) setRun({ kind: 'running', done, total }, forResult);
          },
        },
        { signal },
      );
      if (!signal.aborted) setRun({ kind: 'done', hours }, forResult);
    } catch (err) {
      if (signal.aborted) return;
      setRun(
        {
          kind: 'error',
          // Its own fallback: this run flies the simulations too, and any
          // failure that is not the weather is one of those.
          message: weatherErrorText(err, t, 'env.landing.failed'),
        },
        forResult,
      );
    }
  };

  const hourLandings = run.kind === 'done' ? run.hours.flatMap((h) => (h.landings[0] ? [h.landings[0]] : [])) : [];
  const spread = hourLandings.length >= 3 ? driftEllipse(hourLandings) : null;
  const hourLabel = (ms: number) => fmtSiteTime(ms, source?.timezone, { timeOnly: true });

  return (
    <section className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-line/10">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('env.landing.title')}</h3>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-1 text-xs">
        {branches.map((b, i) => {
          const p = landingPoint(b.series);
          if (!p) return null;
          return (
            <TermRow
              key={i}
              label={branches.length > 1 ? t('env.landing.stage', { stage: i + 1 }) : t('landing.lands')}
              detail={`${fmtM(distanceFromPad(p))}, ${bearing(p)}`}
            >
              {where(b.series, p)}
            </TermRow>
          );
        })}
      </dl>

      {source?.endpoint === 'forecast' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={btn}
              disabled={run.kind === 'running' || !sim || outdated || !online}
              title={online ? undefined : t('common.needsConnection')}
              onClick={() => void fly()}
            >
              {run.kind === 'running'
                ? t('env.landing.flying', { done: run.done, total: run.total })
                : t('env.landing.flyHours')}
            </button>
            <p className="text-xs text-ink-muted">
              {outdated ? t('env.landing.outdated') : t('env.landing.flyHoursNote')}
            </p>
          </div>
          <p role="status" aria-live="polite" className="text-xs text-warn-400">
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
                  <tr className="text-left text-ink-muted">
                    <th className="font-normal">{t('env.landing.hour')}</th>
                    <th className="font-normal">{t('landing.distance')}</th>
                    <th className="font-normal">{t('landing.bearing')}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-ink-strong">
                  {run.hours.map((h) => {
                    const p = h.landings[0];
                    // An hour outside the safety codes is not flown; the row says which code.
                    const refused = refusalKeys(h).map((k) => t(k));
                    return (
                      <tr key={h.offset} className={h.offset === 0 ? 'text-accent-300' : ''}>
                        <td>{hourLabel(h.validMs)}</td>
                        {refused.length ? (
                          <td colSpan={2} className="text-ink-muted">
                            {refused.join('; ')}
                          </td>
                        ) : (
                          <>
                            <td>{p ? fmtM(distanceFromPad(p)) : '—'}</td>
                            <td>{p ? bearing(p) : '—'}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-muted">{t('env.landing.noForecast')}</p>
      )}
    </section>
  );
}
