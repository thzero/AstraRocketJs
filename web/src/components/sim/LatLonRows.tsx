import { useTranslation } from 'react-i18next';
import { LAUNCH_SITE_LIMITS } from '../../services/storage/launchLocationStore';
import { NumberRow } from '../common/NumberRow';
import { latHemisphere, lonHemisphere } from '../../services/map/slippyMap';

type LatLonKey = 'latitudeDeg' | 'longitudeDeg';

/** The markers a row can carry: mixed across a multi-edit, required and missing. */
interface RowMarks {
  mixed?: boolean;
  required?: boolean;
  missing?: boolean;
}

/**
 * A launch site's latitude and longitude, bounded to the stored site limits.
 *
 * The unit names the hemisphere the typed sign puts the site in, as you type.
 * A dropped minus sign is the usual way a site lands on the wrong side of the
 * world (105 for the western US is central China), and the box alone does not
 * show it; "° W" against "° E" does.
 */
export function LatLonRows({
  latitudeDeg,
  longitudeDeg,
  onChange,
  marks,
}: {
  latitudeDeg: number | null | undefined;
  longitudeDeg: number | null | undefined;
  onChange: (patch: Partial<Record<LatLonKey, number | null>>) => void;
  marks?: (key: LatLonKey) => RowMarks;
}) {
  const { t } = useTranslation();
  const row = (key: LatLonKey, label: string, value: number | null | undefined) => (
    <NumberRow
      label={label}
      unit={value == null ? '°' : `° ${key === 'latitudeDeg' ? latHemisphere(value) : lonHemisphere(value)}`}
      step={1}
      min={LAUNCH_SITE_LIMITS[key].min}
      max={LAUNCH_SITE_LIMITS[key].max}
      {...marks?.(key)}
      value={value ?? null}
      onChange={(v) => onChange({ [key]: v })}
    />
  );
  return (
    <>
      {row('latitudeDeg', t('launch.latitude'), latitudeDeg)}
      {row('longitudeDeg', t('launch.longitude'), longitudeDeg)}
    </>
  );
}
