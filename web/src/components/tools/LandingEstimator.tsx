import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import { useSettings } from '../../state/SettingsProvider';
import type { LaunchConditions } from '../../services/design/orkTree';
import { hourInZone, WeatherError, ymdInZone } from '../../services/weather/openMeteo';
import { readWeatherKey } from '../../services/weather/weatherKey';
import { runLandingEstimate, type LandingRun } from '../../services/landing/landingEstimate';
import type { DescentPlan } from '../../services/landing/descentDrift';
import { LAUNCH_SITE_LIMITS } from '../../services/storage/launchLocationStore';
import { LocationPicker } from '../sim/LocationPicker';
import { SiteMapDialog } from '../sim/SiteMapDialog';
import { Num, QNum } from '../sim/LaunchPanel';
import { LandingMap } from './LandingMap';

/**
 * Where a rocket will come down, for a flight that has not been designed here:
 * a site, a date and hour, how high it goes and how fast it falls, and the
 * forecast wind for that hour does the rest (services/landing). An estimate
 * from typed rates, and it says so; a designed rocket's landing comes from the
 * engine, on its Results tab.
 */

const btn =
  'rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-50';
const input =
  'rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';

const nextHour = () => Date.now() + 3_600_000;
const today = () => ymdInZone(Date.now(), undefined);

type Recovery = 'single' | 'dual';
type State =
  { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; run: LandingRun };

/**
 * The inputs and the last result, kept for the page's life. The estimator is
 * mounted only while the Tools tab is open (hidden, its fields would be a second
 * Latitude and Longitude in the document), so this is what lets a trip to
 * another tab come back to the estimate as it was left.
 */
interface Remembered {
  site: { latitudeDeg: number | null; longitudeDeg: number | null; launchAltitudeM: number | null };
  date: string;
  hour: number;
  apogee: number | null;
  recovery: Recovery;
  singleRate: number | null;
  drogueRate: number | null;
  mainRate: number | null;
  mainAgl: number | null;
  state: State;
}
let remembered: Remembered | null = null;

/** Clears the remembered inputs and result, so each test starts from the defaults. */
export function forgetLandingEstimator(): void {
  remembered = null;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function LandingEstimator() {
  const { t, i18n } = useTranslation();
  const u = useUnits();
  const { settings } = useSettings();
  const defaults = settings.launchDefaults;
  const [site, setSite] = useState<Remembered['site']>(
    () =>
      remembered?.site ?? {
        latitudeDeg: defaults.latitudeDeg,
        longitudeDeg: defaults.longitudeDeg,
        launchAltitudeM: null,
      },
  );
  const [date, setDate] = useState(() => remembered?.date ?? ymdInZone(nextHour(), undefined));
  const [hour, setHour] = useState(() => remembered?.hour ?? hourInZone(nextHour(), undefined));
  const [apogee, setApogee] = useState<number | null>(() => (remembered ? remembered.apogee : 300));
  const [recovery, setRecovery] = useState<Recovery>(() => remembered?.recovery ?? 'single');
  // A single chute and a drogue fall at very different rates, so each keeps
  // its own value: switching to dual must not hand the drogue a main's 6 m/s.
  const [singleRate, setSingleRate] = useState<number | null>(() => (remembered ? remembered.singleRate : 6));
  const [drogueRate, setDrogueRate] = useState<number | null>(() => (remembered ? remembered.drogueRate : 25));
  const [mainRate, setMainRate] = useState<number | null>(() => (remembered ? remembered.mainRate : 6));
  const [mainAgl, setMainAgl] = useState<number | null>(() => (remembered ? remembered.mainAgl : 150));
  const [mapOpen, setMapOpen] = useState(false);
  // A request still out when the tab closed is aborted, so it comes back idle.
  const [state, setState] = useState<State>(() =>
    remembered && remembered.state.kind !== 'loading' ? remembered.state : { kind: 'idle' },
  );
  useEffect(() => {
    remembered = { site, date, hour, apogee, recovery, singleRate, drogueRate, mainRate, mainAgl, state };
  }, [site, date, hour, apogee, recovery, singleRate, drogueRate, mainRate, mainAgl, state]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const dual = recovery === 'dual';
  const firstRate = dual ? drogueRate : singleRate;
  const setFirstRate = dual ? setDrogueRate : setSingleRate;
  const resultRef = useRef<HTMLDivElement>(null);
  const plan: DescentPlan | null =
    apogee != null && apogee > 0 && firstRate != null && firstRate > 0
      ? dual
        ? mainRate != null && mainRate > 0 && mainAgl != null && mainAgl > 0 && mainAgl < apogee
          ? { apogeeAglM: apogee, firstRateMs: firstRate, main: { rateMs: mainRate, aglM: mainAgl } }
          : null
        : { apogeeAglM: apogee, firstRateMs: firstRate }
      : null;
  const hasSite = site.latitudeDeg != null && site.longitudeDeg != null;
  const ready = hasSite && plan !== null && /^\d{4}-\d{2}-\d{2}$/.test(date);

  const errorText = (err: unknown): string => {
    if (err instanceof WeatherError) {
      if (
        err.kind === 'refused' &&
        (err.detail === 'tooFarAhead' || err.detail === 'tooEarly' || err.detail === 'badDate')
      ) {
        return t(`weather.dateRefusal.${err.detail}`);
      }
      return t(`weather.error.${err.kind}`, { detail: err.detail ?? '' });
    }
    return t('weather.error.offline');
  };

  const estimate = async () => {
    if (!ready || !plan) return;
    request.current?.abort();
    const ctl = new AbortController();
    request.current = ctl;
    setState({ kind: 'loading' });
    try {
      const run = await runLandingEstimate(
        {
          latitudeDeg: site.latitudeDeg!,
          longitudeDeg: site.longitudeDeg!,
          padElevationM: site.launchAltitudeM,
          date,
          hour,
          today: today(),
          plan,
          apiKey: readWeatherKey(),
        },
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      setState(run === 'noHour' ? { kind: 'error', message: t('weather.noHour') } : { kind: 'ready', run });
      // On a phone the result is below the form, out of sight of the button.
      if (run !== 'noHour') requestAnimationFrame(() => resultRef.current?.scrollIntoView?.({ block: 'nearest' }));
    } catch (err) {
      if (ctl.signal.aborted) return;
      setState({ kind: 'error', message: errorText(err) });
    }
  };

  const dist = u.plain('distance');
  const fmtM = (m: number) => `${dist.fmt(m, Math.abs(dist.toUi(m)) >= 100 ? 0 : 1)} ${dist.sym}`;
  const run = state.kind === 'ready' ? state.run : null;
  const e = run?.estimate;
  const validTime = run
    ? new Intl.DateTimeFormat(i18n.language, {
        timeZone: run.answer.timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(run.validUnix * 1000))
    : '';
  const minutes = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  return (
    <div className="grid h-full gap-4 overflow-auto p-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">{t('landing.title')}</h2>
          <p className="mt-1 text-xs text-slate-400">{t('landing.intro')}</p>
        </div>

        <Group title={t('landing.site')}>
          <LocationPicker
            launch={site as unknown as LaunchConditions}
            onChange={(p) =>
              setSite((s) => ({
                latitudeDeg: p.latitudeDeg !== undefined ? p.latitudeDeg : s.latitudeDeg,
                longitudeDeg: p.longitudeDeg !== undefined ? p.longitudeDeg : s.longitudeDeg,
                launchAltitudeM: p.launchAltitudeM !== undefined ? p.launchAltitudeM : s.launchAltitudeM,
              }))
            }
          />
          <Num
            label={t('launch.latitude')}
            unit="°"
            step={1}
            min={LAUNCH_SITE_LIMITS.latitudeDeg.min}
            max={LAUNCH_SITE_LIMITS.latitudeDeg.max}
            value={site.latitudeDeg}
            onChange={(v) => setSite((s) => ({ ...s, latitudeDeg: v }))}
          />
          <Num
            label={t('launch.longitude')}
            unit="°"
            step={1}
            min={LAUNCH_SITE_LIMITS.longitudeDeg.min}
            max={LAUNCH_SITE_LIMITS.longitudeDeg.max}
            value={site.longitudeDeg}
            onChange={(v) => setSite((s) => ({ ...s, longitudeDeg: v }))}
          />
          <QNum
            label={t('landing.siteElevation')}
            field="landingSiteElevation"
            kind="distance"
            u={u}
            stepSi={10}
            minSi={LAUNCH_SITE_LIMITS.launchAltitudeM.min}
            maxSi={LAUNCH_SITE_LIMITS.launchAltitudeM.max}
            placeholder={t('landing.terrain')}
            hint={t('landing.siteElevationHint')}
            value={site.launchAltitudeM}
            onChange={(v) => setSite((s) => ({ ...s, launchAltitudeM: v }))}
          />
          <button className={`${btn} w-full`} onClick={() => setMapOpen(true)}>
            🗺 {t('map.show')}
          </button>
        </Group>

        <Group title={t('landing.when')}>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('weather.dateLabel')}</span>
            <input type="date" className={input} value={date} onChange={(ev) => setDate(ev.target.value)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('weather.hourLabel')}</span>
            <select className={input} value={hour} onChange={(ev) => setHour(Number(ev.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
        </Group>

        <Group title={t('landing.flight')}>
          <QNum
            label={t('landing.apogee')}
            field="landingApogee"
            kind="distance"
            u={u}
            stepSi={10}
            minSi={1}
            maxSi={30_000}
            required
            missing={apogee == null}
            value={apogee}
            onChange={setApogee}
          />
          <fieldset>
            <legend className="sr-only">{t('landing.recovery')}</legend>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">{t('landing.recovery')}</span>
              <div className="flex gap-3">
                {(['single', 'dual'] as const).map((r) => (
                  <label key={r} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="landingRecovery"
                      checked={recovery === r}
                      onChange={() => setRecovery(r)}
                      className="accent-sky-500"
                    />
                    <span className="text-xs text-slate-400">{t(`landing.recovery_${r}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
          <QNum
            label={t(dual ? 'landing.drogueRate' : 'landing.descentRate')}
            field="landingFirstRate"
            kind="velocity"
            u={u}
            stepSi={0.5}
            minSi={0.1}
            maxSi={150}
            required
            missing={firstRate == null}
            value={firstRate}
            onChange={setFirstRate}
          />
          {dual && (
            <>
              <QNum
                label={t('landing.mainRate')}
                field="landingMainRate"
                kind="velocity"
                u={u}
                stepSi={0.5}
                minSi={0.1}
                maxSi={150}
                required
                missing={mainRate == null}
                value={mainRate}
                onChange={setMainRate}
              />
              <QNum
                label={t('landing.mainAltitude')}
                field="landingMainAltitude"
                kind="distance"
                u={u}
                stepSi={10}
                minSi={1}
                maxSi={30_000}
                required
                missing={mainAgl == null}
                hint={mainAgl != null && apogee != null && mainAgl >= apogee ? t('landing.mainAboveApogee') : undefined}
                value={mainAgl}
                onChange={setMainAgl}
              />
            </>
          )}
        </Group>

        <button
          className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          disabled={!ready || state.kind === 'loading'}
          onClick={() => void estimate()}
        >
          {state.kind === 'loading' ? t('landing.estimating') : t('landing.estimate')}
        </button>
        {!hasSite && <p className="text-xs text-amber-400">{t('weather.needSite')}</p>}
        <p role="status" aria-live="polite" className="text-xs text-amber-400">
          {state.kind === 'error' ? state.message : ''}
        </p>
      </div>

      <div ref={resultRef} className="min-w-0 space-y-3">
        {run && e ? (
          <>
            <LandingMap
              latitudeDeg={site.latitudeDeg!}
              longitudeDeg={site.longitudeDeg!}
              path={e.nominal.path}
              landing={e.nominal.landing}
              samples={e.samples}
              ellipse={e.ellipse}
            />
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2 rounded-xl bg-slate-900 p-3 text-xs ring-1 ring-white/10">
              <Stat label={t('landing.lands')}>
                {`${e.nominal.landingLatDeg.toFixed(5)}°, ${e.nominal.landingLonDeg.toFixed(5)}°`}
              </Stat>
              <Stat label={t('landing.distance')}>{fmtM(e.nominal.distanceM)}</Stat>
              <Stat label={t('landing.bearing')}>{`${Math.round(e.nominal.bearingDeg)}°`}</Stat>
              <Stat label={t('landing.descentTime')}>{minutes(e.nominal.timeS)}</Stat>
              <Stat label={t('landing.zone')}>
                {e.ellipse
                  ? `${fmtM(2 * e.ellipse.semiMajorM)} × ${fmtM(2 * e.ellipse.semiMinorM)}`
                  : t('landing.noZone')}
              </Stat>
              <Stat label={t('landing.groundAtLanding')}>{fmtM(e.nominal.groundElevationM)}</Stat>
              <Stat label={t('env.when')}>{validTime}</Stat>
            </dl>
            <p className="text-xs text-slate-400">
              {t('landing.estimateNote', { descents: e.samples.length, hours: e.hours })}
            </p>
            {!run.terrain && <p className="text-xs text-amber-400">{t('landing.flatGround')}</p>}
            {run.answer.endpoint === 'archive' && (
              <p className="text-xs text-amber-400">{t('landing.surfaceWindOnly')}</p>
            )}
            <p className="text-[11px] text-slate-500">
              <a
                className="text-sky-400 hover:underline"
                href="https://open-meteo.com/"
                target="_blank"
                rel="noreferrer"
              >
                {t('weather.credit')}
              </a>
              {' · '}
              <a
                className="text-sky-400 hover:underline"
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 4.0
              </a>
            </p>
          </>
        ) : (
          <p className="p-4 text-sm text-slate-500">{t('landing.empty')}</p>
        )}
      </div>

      {mapOpen && (
        <SiteMapDialog
          latitudeDeg={site.latitudeDeg}
          longitudeDeg={site.longitudeDeg}
          onPick={(la, lo) => setSite((s) => ({ ...s, latitudeDeg: la, longitudeDeg: lo }))}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="tabular-nums text-slate-100">{children}</dd>
    </div>
  );
}
