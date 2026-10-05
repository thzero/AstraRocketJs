import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions } from '../../services/design/orkTree';
import { sourceStatus } from '../../services/weather/weatherSource';

/** How often the "old forecast" check is looked at again. */
const TICK_MS = 60_000;

/**
 * Where a simulation's weather came from: the forecast's hour and place, when
 * it was fetched, Open-Meteo's credit, and anything since that makes it read
 * differently (an edit, a moved site, a newer forecast likely). Shown on the
 * Atmosphere card, where Refresh reopens the Weather dialog on the same date,
 * hour and groups, and in the Results Environment view, which has no Refresh.
 */
export function WeatherSourceLine({
  launch,
  onRefresh,
  summary = true,
}: {
  launch: LaunchConditions;
  /**
   * The "forecast for … at …, fetched …" sentence. The Environment view leaves
   * it out: its own row already shows the date, time and coordinates.
   */
  summary?: boolean;
  /** Absent where the Weather dialog is not offered. */
  onRefresh?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const source = launch.weatherSource;
  useEffect(() => {
    if (!source) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [source]);
  const status = sourceStatus(launch, now);
  if (!source || !status) return null;

  const fmt = (iso: string, timeZone: string | undefined) => {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    };
    try {
      return new Intl.DateTimeFormat(i18n.language, { ...opts, timeZone }).format(new Date(iso));
    } catch {
      return new Intl.DateTimeFormat(i18n.language, opts).format(new Date(iso));
    }
  };
  const notes = [
    status.edited && t('weather.source.edited'),
    status.otherSite && t('weather.source.otherSite'),
    status.old && t('weather.source.old'),
  ].filter(Boolean);

  return (
    <div className="space-y-1 rounded-md bg-slate-800/60 p-2 ring-1 ring-white/10">
      {summary && (
        <p className="text-xs text-slate-300">
          {t(source.endpoint === 'archive' ? 'weather.source.record' : 'weather.source.forecast', {
            when: fmt(source.validAt, source.timezone),
            where: `${source.latitudeDeg.toFixed(3)}°, ${source.longitudeDeg.toFixed(3)}°`,
            fetched: fmt(source.fetchedAt, undefined),
          })}
        </p>
      )}
      {notes.map((n) => (
        <p key={n as string} className="text-xs text-amber-400">
          {n}
        </p>
      ))}
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-sky-300 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('weather.source.refresh')}
        </button>
      )}
      {/* CC BY 4.0 asks for the credit wherever the data is shown, and this
          line goes wherever values from it are. */}
      <p className="text-[11px] text-slate-500">
        <a className="text-sky-400 hover:underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
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
  );
}
