import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readWeatherKey, writeWeatherKey } from '../../services/weather/weatherKey';

/**
 * The Open-Meteo API key, for someone with a paid plan. Blank is the free tier.
 *
 * Saved on blur to its own storage entry (services/weather/weatherKey), never
 * into the settings object, so the Settings dialog's reset and every settings
 * copy leave it alone and no export can carry it.
 */
export function WeatherKeyField() {
  const { t } = useTranslation();
  const [value, setValue] = useState(() => readWeatherKey() ?? '');
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-1 border-t border-white/10 pt-2">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('weather.keyLabel')}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={t('weather.keyPlaceholder')}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setFailed(!writeWeatherKey(value))}
          className="w-56 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
      </label>
      <p className="text-[11px] leading-snug text-slate-500">{t('weather.keyNote')}</p>
      <p role="status" aria-live="polite" className="text-[11px] leading-snug text-amber-400">
        {failed ? t('weather.keyNotSaved') : ''}
      </p>
    </div>
  );
}
