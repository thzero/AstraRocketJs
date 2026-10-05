import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions } from '../../services/design/orkTree';
import { Dialog } from '../common/Dialog';
import { useUnits } from '../../prefs/useUnits';
import {
  fetchWeather,
  hourInZone,
  sampleAt,
  WeatherError,
  ymdInZone,
  type WeatherAnswer,
} from '../../services/weather/openMeteo';
import {
  hasGroup,
  PROPOSAL_GROUPS,
  proposalFor,
  proposalPatch,
  type ProposalGroup,
} from '../../services/weather/weatherProposal';
import { readWeatherKey } from '../../services/weather/weatherKey';
import { sourceFor } from '../../services/weather/weatherSource';
import { formatLat, formatLon } from '../../services/map/slippyMap';

/**
 * Launch conditions from an Open-Meteo forecast for a date and hour at the
 * launch site. Desktop OpenRocket's "Use Current Conditions" (PR #3211) is the
 * model: fetch, show every value with its time and source and a checkbox each,
 * and change nothing until Apply.
 *
 * Mounted only while open, so a closed dialog holds no request: unmounting
 * aborts one still running.
 *
 * Apply writes a `weatherSource` beside the values, so the Atmosphere card can
 * say where they came from. Opened from that card's Refresh, the dialog starts
 * from the recorded date, hour and groups and fetches at once; Apply is still
 * the only thing that writes.
 */

const btn =
  'rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-50';
const input =
  'rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';

/** The next whole hour starts within this one; the dialog opens on it. */
const nextHour = () => Date.now() + 3_600_000;
const today = () => ymdInZone(Date.now(), undefined);

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; answer: WeatherAnswer };

export function WeatherDialog({
  launch,
  onChange,
  onCommit,
  onClose,
  refresh = false,
}: {
  launch: LaunchConditions;
  onChange: (patch: Partial<LaunchConditions>) => void;
  onCommit?: () => void;
  onClose: () => void;
  /** Start from `launch.weatherSource` and fetch on opening. */
  refresh?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const u = useUnits();
  const prior = refresh ? launch.weatherSource : undefined;
  const [date, setDate] = useState(() => prior?.date ?? ymdInZone(nextHour(), undefined));
  const [hour, setHour] = useState(() => prior?.hour ?? hourInZone(nextHour(), undefined));
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [useTerrain, setUseTerrain] = useState(prior?.elevationApplied ?? false);
  const [ticked, setTicked] = useState<Set<ProposalGroup>>(() => new Set(prior?.groups ?? PROPOSAL_GROUPS));
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const lat = launch.latitudeDeg;
  const lon = launch.longitudeDeg;
  const siteM = launch.launchAltitudeM ?? 0;
  const hasSite = lat != null && lon != null;

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

  /** `force` asks Open-Meteo even when an answer under 30 minutes old is held. */
  const fetchNow = async (force = false) => {
    if (!hasSite) return;
    request.current?.abort();
    const ctl = new AbortController();
    request.current = ctl;
    setState({ kind: 'loading' });
    try {
      const answer = await fetchWeather(
        {
          latitudeDeg: lat,
          longitudeDeg: lon,
          siteM,
          date,
          today: today(),
          apiKey: readWeatherKey(),
        },
        { signal: ctl.signal, force },
      );
      if (ctl.signal.aborted) return;
      setState({ kind: 'ready', answer });
    } catch (err) {
      if (ctl.signal.aborted) return;
      setState({ kind: 'error', message: errorText(err) });
    }
  };

  // A refresh fetches at once: its date, hour and groups are already chosen.
  // Once per opening, which the ref holds across a strict-mode double mount.
  const started = useRef(false);
  useEffect(() => {
    if (!refresh || started.current) return;
    started.current = true;
    void fetchNow();
  });

  const answer = state.kind === 'ready' ? state.answer : null;
  const variantIndex = answer && useTerrain && answer.variants.length > 1 ? 1 : 0;
  const variant = answer?.variants[variantIndex];
  const sample = answer && variant ? sampleAt(variant, answer.timezone, answer.date, hour) : null;
  const proposal = useMemo(
    () => (sample && variant ? proposalFor(sample, variant.elevationM) : null),
    [sample, variant],
  );
  const offered = proposal ? PROPOSAL_GROUPS.filter((g) => hasGroup(proposal, g)) : [];
  const chosen = new Set(offered.filter((g) => ticked.has(g)));

  const apply = () => {
    if (!proposal || !variant || !answer || !sample || !hasSite) return;
    const elevationApplied = useTerrain && answer.variants.length > 1;
    const patch = proposalPatch(
      proposal,
      chosen,
      elevationApplied ? { launchAltitudeM: variant.elevationM } : undefined,
    );
    const weatherSource = sourceFor({
      endpoint: answer.endpoint,
      date: answer.date,
      hour,
      timezone: answer.timezone,
      latitudeDeg: lat,
      longitudeDeg: lon,
      elevationM: variant.elevationM,
      validUnix: sample.unix,
      fetchedAtMs: answer.fetchedAtMs,
      groups: PROPOSAL_GROUPS.filter((g) => chosen.has(g)),
      elevationApplied,
      applied: patch,
    });
    onChange({ ...patch, weatherSource });
    onCommit?.();
    onClose();
  };

  const toggle = (g: ProposalGroup) => {
    const next = new Set(ticked);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    setTicked(next);
  };

  const temp = (c: number) => `${u.fmtSym('temperature', c + 273.15, 1)}`;
  const pres = (hPa: number) => `${u.fmtSym('pressure', hPa * 100, 1)}`;
  const wind = (ms: number) => `${u.fmtSym('windspeed', ms, 1)}`;
  const alt = (m: number) => `${u.fmtSym('distance', m, 0)}`;

  const describe = (g: ProposalGroup): string => {
    const p = proposal!;
    switch (g) {
      case 'temperature':
        return temp(p.temperatureC!);
      case 'pressure':
        return pres(p.pressureHPa!);
      case 'humidity':
        return `${Math.round(p.relativeHumidity! * 100)} %`;
      case 'wind': {
        const w = p.wind!;
        const top = w.levels[w.levels.length - 1]!;
        return t('weather.windValue', {
          speed: wind(w.surfaceSpeed),
          from: Math.round(w.surfaceFromDeg),
          gust: w.gust === null ? '—' : wind(w.gust),
          top: alt(top.altitudeM),
        });
      }
      case 'atmosphere': {
        const a = p.atmosphere!;
        return t('weather.atmosphereValue', { top: alt(a[a.length - 1]!.altitudeM) });
      }
    }
  };

  const validTime =
    sample && answer
      ? new Intl.DateTimeFormat(i18n.language, {
          timeZone: answer.timezone,
          // Explicit fields: dateStyle and timeStyle refuse a timeZoneName beside them.
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(new Date(sample.unix * 1000))
      : null;

  return (
    <Dialog
      id="weather"
      title={t('weather.title')}
      onClose={onClose}
      layer="over"
      size="lg"
      footer={
        <div className="flex justify-end gap-2 p-3">
          <button className={btn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            disabled={!proposal || chosen.size === 0}
            onClick={apply}
          >
            {t('weather.apply')}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-3 text-sm">
        {!hasSite ? (
          <p className="text-amber-400">{t('weather.needSite')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">{t('weather.dateLabel')}</span>
                <input
                  type="date"
                  className={input}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    // A new date is a new request; the old answer covers only its own days.
                    if (state.kind !== 'loading') setState({ kind: 'idle' });
                  }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">{t('weather.hourLabel')}</span>
                <select className={input} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
              <button className={btn} disabled={state.kind === 'loading'} onClick={() => void fetchNow()}>
                {state.kind === 'loading' ? t('weather.fetching') : t('weather.fetch')}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              {t('weather.siteLine', { lat: formatLat(lat, 3), lon: formatLon(lon, 3), alt: alt(siteM) })}
            </p>
          </>
        )}

        <p role="status" aria-live="polite" className="text-xs text-amber-400">
          {state.kind === 'error' ? state.message : ''}
        </p>

        {answer && !sample && <p className="text-xs text-amber-400">{t('weather.noHour')}</p>}

        {answer && proposal && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              {t(answer.endpoint === 'archive' ? 'weather.validArchive' : 'weather.validForecast', { time: validTime })}
            </p>
            {answer.endpoint === 'archive' && <p className="text-xs text-slate-400">{t('weather.archiveNoAloft')}</p>}
            {/* When the answer came from, and a way past the reuse window: a
                reused answer is not a fresh one, and the user may know a newer
                run is out. */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                {t(answer.reused ? 'weather.reused' : 'weather.fetchedAt', {
                  time: new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
                    new Date(answer.fetchedAtMs),
                  ),
                })}
              </p>
              <button className={btn} onClick={() => void fetchNow(true)}>
                {t('weather.fetchFresh')}
              </button>
            </div>
            {answer.variants.length > 1 && answer.terrainM !== null && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-sky-500"
                  checked={useTerrain}
                  onChange={(e) => setUseTerrain(e.target.checked)}
                />
                <span className="text-xs text-slate-300">
                  {t('weather.useTerrain', { terrain: alt(answer.terrainM), site: alt(siteM) })}
                </span>
              </label>
            )}
            <ul className="space-y-1">
              {offered.map((g) => (
                <li key={g} className="flex items-center justify-between gap-3">
                  {/* The value sits outside the label, so the checkbox is named
                      by its group alone and the value is read after it. */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-sky-500"
                      checked={ticked.has(g)}
                      onChange={() => toggle(g)}
                    />
                    <span className="text-xs text-slate-300">{t(`weather.group.${g}`)}</span>
                  </label>
                  <span className="text-right text-xs tabular-nums text-slate-100">{describe(g)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">{t('weather.forecastNote')}</p>
            <p className="text-xs text-slate-500">
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
          </div>
        )}
      </div>
    </Dialog>
  );
}
