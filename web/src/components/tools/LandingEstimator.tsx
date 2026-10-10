import { useRef } from 'react';
import { defaultToolSite, rememberedSlot, useRemembered } from './remembered';
import { useTranslation } from 'react-i18next';
import { fmtGroundDistance, useUnits } from '../../prefs/useUnits';
import { useSettings } from '../../state/SettingsProvider';
import { hourInZone, nextHourMs, todayYmd, ymdInZone } from '../../services/weather/openMeteo';
import { readWeatherKey } from '../../services/weather/weatherKey';
import { runLandingEstimate, type LandingRun } from '../../services/landing/landingEstimate';
import type { DescentPlan } from '../../services/landing/descentDrift';
import { QNum } from '../sim/LaunchPanel';
import { LandingMap } from './LandingMap';
import { SiteFields, type ToolSite } from './SiteFields';
import { WhenFields } from '../sim/WhenFields';
import { CardGroup } from '../common/CardGroup';
import { TermRow } from '../common/TermRow';
import { OpenMeteoCredit } from '../common/OpenMeteoCredit';
import { formatCoord } from '../../services/map/slippyMap';
import { weatherErrorText } from '../../services/weather/weatherErrorText';
import { fmtSiteTime } from '../../i18n/format';
import { useLatest } from '../common/useLatest';
import { useOnline } from '../common/useOnline';

/**
 * Where a rocket will come down, for a flight that has not been designed here:
 * a site, a date and hour, how high it goes and how fast it falls, and the
 * forecast wind for that hour does the rest (services/landing). An estimate
 * from typed rates, and it says so; a designed rocket's landing comes from the
 * engine, on its Results tab.
 */

type Recovery = 'single' | 'dual';
type State =
  { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; run: LandingRun };

interface Remembered {
  site: ToolSite;
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
const remembered = rememberedSlot<Remembered>();

/** Clears the remembered inputs and result, so each test starts from the defaults. */
export function forgetLandingEstimator(): void {
  remembered.forget();
}

/** A duration as m:ss, rounded to the whole second before it is split. */
export function minutesSeconds(s: number): string {
  const total = Math.round(s);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function LandingEstimator() {
  const { t } = useTranslation();
  const online = useOnline();
  const u = useUnits();
  const { settings } = useSettings();
  const defaults = settings.launchDefaults;
  const [site, setSite] = useRemembered(remembered, 'site', defaultToolSite(defaults));
  const [date, setDate] = useRemembered(remembered, 'date', ymdInZone(nextHourMs(), undefined));
  const [hour, setHour] = useRemembered(remembered, 'hour', hourInZone(nextHourMs(), undefined));
  const [apogee, setApogee] = useRemembered(remembered, 'apogee', 300);
  const [recovery, setRecovery] = useRemembered(remembered, 'recovery', 'single');
  // A single chute and a drogue fall at very different rates, so each keeps
  // its own value: switching to dual must not hand the drogue a main's 6 m/s.
  const [singleRate, setSingleRate] = useRemembered(remembered, 'singleRate', 6);
  const [drogueRate, setDrogueRate] = useRemembered(remembered, 'drogueRate', 25);
  const [mainRate, setMainRate] = useRemembered(remembered, 'mainRate', 6);
  const [mainAgl, setMainAgl] = useRemembered(remembered, 'mainAgl', 150);
  // A request still out when the tab closed was aborted, so it comes back idle.
  const [state, setState] = useRemembered(remembered, 'state', { kind: 'idle' }, (s): State =>
    s.kind === 'loading' ? { kind: 'idle' } : s,
  );
  const request = useLatest();

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

  const errorText = (err: unknown): string => weatherErrorText(err, t);

  const estimate = async () => {
    if (!ready || !plan) return;
    const signal = request.claimSignal();
    setState({ kind: 'loading' });
    try {
      const run = await runLandingEstimate(
        {
          latitudeDeg: site.latitudeDeg!,
          longitudeDeg: site.longitudeDeg!,
          padElevationM: site.launchAltitudeM,
          date,
          hour,
          today: todayYmd(),
          plan,
          apiKey: readWeatherKey(),
        },
        { signal },
      );
      if (signal.aborted) return;
      setState(run === 'noHour' ? { kind: 'error', message: t('weather.noHour') } : { kind: 'ready', run });
      // On a phone the result is below the form, out of sight of the button.
      if (run !== 'noHour') requestAnimationFrame(() => resultRef.current?.scrollIntoView?.({ block: 'nearest' }));
    } catch (err) {
      if (signal.aborted) return;
      setState({ kind: 'error', message: errorText(err) });
    }
  };

  const dist = u.plain('distance');
  const fmtM = (m: number) => fmtGroundDistance(dist, m);
  const run = state.kind === 'ready' ? state.run : null;
  const e = run?.estimate;
  const validTime = run ? fmtSiteTime(run.validUnix * 1000, run.answer.timezone) : '';
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t('landing.title')}</h2>
          <p className="mt-1 text-xs text-ink-muted">{t('landing.intro')}</p>
        </div>

        <CardGroup title={t('landing.site')}>
          <SiteFields site={site} onChange={setSite} elevation />
        </CardGroup>

        <CardGroup title={t('landing.when')}>
          <WhenFields date={date} hour={hour} onDate={setDate} onHour={setHour} />
        </CardGroup>

        <CardGroup title={t('landing.flight')}>
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
              <span className="text-xs text-ink-muted">{t('landing.recovery')}</span>
              <div className="flex gap-3">
                {(['single', 'dual'] as const).map((r) => (
                  <label key={r} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="landingRecovery"
                      checked={recovery === r}
                      onChange={() => setRecovery(r)}
                      className="accent-accent-500"
                    />
                    <span className="text-xs text-ink-muted">{t(`landing.recovery_${r}`)}</span>
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
        </CardGroup>

        <button
          className="w-full rounded-md bg-accent-600 px-3 py-2 text-sm font-semibold text-on-accent hover:bg-accent-500 disabled:opacity-50"
          disabled={!ready || state.kind === 'loading' || !online}
          title={online ? undefined : t('common.needsConnection')}
          onClick={() => void estimate()}
        >
          {state.kind === 'loading' ? t('landing.estimating') : t('landing.estimate')}
        </button>
        {!hasSite && <p className="text-xs text-warn-400">{t('weather.needSite')}</p>}
        <p role="status" aria-live="polite" className="text-xs text-warn-400">
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
              distanceUnit={dist}
            />
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2 rounded-xl bg-surface p-3 text-xs ring-1 ring-line/10">
              <TermRow label={t('landing.lands')}>
                {formatCoord(e.nominal.landingLatDeg, e.nominal.landingLonDeg, 5)}
              </TermRow>
              <TermRow label={t('landing.distance')}>{fmtM(e.nominal.distanceM)}</TermRow>
              <TermRow label={t('landing.bearing')}>{`${Math.round(e.nominal.bearingDeg)}°`}</TermRow>
              <TermRow label={t('landing.descentTime')}>{minutesSeconds(e.nominal.timeS)}</TermRow>
              <TermRow label={t('landing.zone')}>
                {e.ellipse
                  ? `${fmtM(2 * e.ellipse.semiMajorM)} × ${fmtM(2 * e.ellipse.semiMinorM)}`
                  : t('landing.noZone')}
              </TermRow>
              <TermRow label={t('landing.groundAtLanding')}>{fmtM(e.nominal.groundElevationM)}</TermRow>
              <TermRow label={t('env.when')}>{validTime}</TermRow>
            </dl>
            <p className="text-xs text-ink-muted">
              {t('landing.estimateNote', { descents: e.samples.length, hours: e.hours })}
            </p>
            {!run.terrain && <p className="text-xs text-warn-400">{t('landing.flatGround')}</p>}
            {run.answer.endpoint === 'archive' && (
              <p className="text-xs text-warn-400">{t('landing.surfaceWindOnly')}</p>
            )}
            <OpenMeteoCredit />
          </>
        ) : (
          <p className="p-4 text-sm text-ink-faint">{t('landing.empty')}</p>
        )}
      </div>
    </div>
  );
}
