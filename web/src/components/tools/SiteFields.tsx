import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import type { LaunchConditions } from '../../services/design/orkTree';
import { LAUNCH_SITE_LIMITS } from '../../services/storage/launchLocationStore';
import { LocationPicker } from '../sim/LocationPicker';
import { SiteMapDialog } from '../sim/SiteMapDialog';
import { QNum } from '../sim/LaunchPanel';
import { LatLonRows } from '../sim/LatLonRows';

export const toolBtn =
  'rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-50';

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
      <LatLonRows
        latitudeDeg={site.latitudeDeg}
        longitudeDeg={site.longitudeDeg}
        onChange={(patch) => onChange((s) => ({ ...s, ...patch }))}
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
