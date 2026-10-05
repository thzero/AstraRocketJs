import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import type { LaunchConditions } from '../../services/design/orkTree';
import { LAUNCH_SITE_LIMITS } from '../../services/storage/launchLocationStore';
import { LocationPicker } from '../sim/LocationPicker';
import { SiteMapDialog } from '../sim/SiteMapDialog';
import { Num, QNum } from '../sim/LaunchPanel';

export const toolBtn =
  'rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-50';
const toolInput =
  'rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';

export interface ToolSite {
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  launchAltitudeM: number | null;
}

/**
 * A tool's launch site: a saved location, latitude and longitude, a pick on the
 * map, and with `elevation`, the site's height (blank for the terrain model's).
 */
export function SiteFields({
  site,
  onChange,
  elevation = false,
}: {
  site: ToolSite;
  onChange: (update: (s: ToolSite) => ToolSite) => void;
  elevation?: boolean;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <>
      <LocationPicker
        launch={site as unknown as LaunchConditions}
        onChange={(p) =>
          onChange((s) => ({
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
        onChange={(v) => onChange((s) => ({ ...s, latitudeDeg: v }))}
      />
      <Num
        label={t('launch.longitude')}
        unit="°"
        step={1}
        min={LAUNCH_SITE_LIMITS.longitudeDeg.min}
        max={LAUNCH_SITE_LIMITS.longitudeDeg.max}
        value={site.longitudeDeg}
        onChange={(v) => onChange((s) => ({ ...s, longitudeDeg: v }))}
      />
      {elevation && (
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
          onChange={(v) => onChange((s) => ({ ...s, launchAltitudeM: v }))}
        />
      )}
      <button className={`${toolBtn} w-full`} onClick={() => setMapOpen(true)}>
        🗺 {t('map.show')}
      </button>
      {mapOpen && (
        <SiteMapDialog
          latitudeDeg={site.latitudeDeg}
          longitudeDeg={site.longitudeDeg}
          onPick={(la, lo) => onChange((s) => ({ ...s, latitudeDeg: la, longitudeDeg: lo }))}
          onClose={() => setMapOpen(false)}
        />
      )}
    </>
  );
}

/** A forecast's date and hour, in the site's local time. */
export function WhenFields({
  date,
  hour,
  onDate,
  onHour,
}: {
  date: string;
  hour: number;
  onDate: (d: string) => void;
  onHour: (h: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('weather.dateLabel')}</span>
        <input type="date" className={toolInput} value={date} onChange={(ev) => onDate(ev.target.value)} />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('weather.hourLabel')}</span>
        <select className={toolInput} value={hour} onChange={(ev) => onHour(Number(ev.target.value))}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
