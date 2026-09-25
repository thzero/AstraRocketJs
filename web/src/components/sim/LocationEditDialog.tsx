import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../common/NumberInput';
import { UnitChip } from '../common/UnitChip';
import { Dialog } from '../common/Dialog';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { LAUNCH_SI } from '../../prefs/launchUnits';
import { uuid } from '../../services/uuid';
import { SiteMap } from './SiteMap';
import type { LaunchLocation } from '../../services/launchLocationStore';

/**
 * Edit a saved location in full: name, latitude, longitude and elevation.
 *
 * Renaming alone was not enough. Coordinates get typed wrong, a field's
 * published elevation gets corrected, and a location saved from the launch panel
 * captured whatever was in the boxes at the time — so the one thing you most
 * want to fix about a location is a number, not its name. This also creates one from
 * nothing, which is the only way to add a location from the menu, where there are no
 * launch fields on screen to capture.
 *
 * The bounds are the store's own (`launchLocationStore.isLocation`), which are in turn the ones
 * `LaunchPanel` clamps its fields to. Stating them here as `min`/`max` means a
 * bad value is unreachable rather than rejected after the fact.
 *
 * The map beside the fields is the other half of the same job. Four digits of
 * latitude are unverifiable by reading them, and a club field usually has no
 * published coordinates at all - you know it by the mown strip off the county
 * road. Clicking the map fills both numbers, and the numbers move the pin, so
 * either one can be the thing you know.
 */

/** The ranges `launchLocationStore` validates against, named once. */
const LIMITS = {
  latitudeDeg: { min: -90, max: 90 },
  longitudeDeg: { min: -180, max: 180 },
  /** The Dead Sea shore to above any launch site, matching the altitude field. */
  launchAltitudeM: { min: -500, max: 10000 },
} as const;

function Row({ label, unit, children }: { label: string; unit: ReactNode; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
      <span className="min-w-24">{label}</span>
      <span className="flex items-center gap-1">
        {children}
        <span className="min-w-8 text-slate-500">{unit}</span>
      </span>
    </label>
  );
}

const numberClass =
  'w-28 rounded-md bg-slate-800 px-2 py-1.5 text-right text-sm tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';

export function LocationEditDialog({
  location,
  takenNames = [],
  onCancel,
  onSave,
}: {
  /** The location to edit, or null to create one. */
  location: LaunchLocation | null;
  /** Other locations' names, to warn about a duplicate (not to forbid it). */
  takenNames?: string[];
  onCancel: () => void;
  onSave: (location: LaunchLocation) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(location?.name ?? '');
  const [lat, setLat] = useState<number | null>(location?.latitudeDeg ?? null);
  const [lon, setLon] = useState<number | null>(location?.longitudeDeg ?? null);
  const [alt, setAlt] = useState<number | null>(location?.launchAltitudeM ?? null);

  // Altitude shares the launch panel's own unit and scope, so a user working in
  // feet sees feet in both places rather than meters in one of them.
  const altUnit = u.at(unitScope('launch', 'altitude'), LAUNCH_SI.distance.q);

  /**
   * Focus and select the name SYNCHRONOUSLY, before the browser paints.
   *
   * This was a `requestAnimationFrame`, which left a whole frame in which the
   * dialog was on screen and focus had not arrived yet. Click another field
   * inside that frame and the callback yanked focus away mid-keystroke, so the
   * first thing typed into the latitude landed in the NAME box instead - a
   * location saved as "39.1234". It showed up as an intermittent end-to-end
   * failure, which is the only reason it was ever seen; a person would just
   * have blamed themselves.
   *
   * A layout effect runs after the DOM is in place and before paint, so there
   * is no such gap. `useFocusTrap`'s own pull is a passive effect that skips a
   * panel which already holds focus, so it runs after this and leaves it be.
   */
  useLayoutEffect(() => nameRef.current?.select(), []);

  const trimmed = name.trim();
  const duplicate = trimmed !== '' && takenNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  // Latitude and longitude have no sensible default — a location at 0°,0° is in the
  // Gulf of Guinea, not "unset" — so both are required. Elevation defaults to
  // sea level, which is a real answer for a coastal field.
  const valid = trimmed !== '' && lat !== null && lon !== null;

  const submit = () => {
    if (!valid) return;
    onSave({
      id: location?.id ?? uuid(),
      name: trimmed,
      latitudeDeg: lat,
      longitudeDeg: lon,
      launchAltitudeM: alt ?? 0,
    });
  };

  return (
    <Dialog
      id="locationEdit"
      title={location ? t('location.edit') : t('location.new')}
      onClose={onCancel}
      // It opens from the locations dialog, which is itself opened over the
      // launch panel: the third layer up.
      layer="top"
      size="3xl"
      layout="pad"
    >
      <div
        className="space-y-3"
        // On the wrapper rather than the panel, which the shell owns. Keydown
        // bubbles from whichever field is being typed into, so this still
        // catches Enter anywhere in the form.
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">
              {t('location.name')}
              <input
                ref={nameRef}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 focus:ring-sky-500"
              />
            </label>
            {duplicate && <p className="text-[11px] leading-snug text-amber-400">{t('location.duplicateName')}</p>}

            <Row label={t('launch.latitude')} unit="°">
              <NumberInput
                ariaLabel={t('launch.latitude')}
                value={lat}
                step={0.0001}
                min={LIMITS.latitudeDeg.min}
                max={LIMITS.latitudeDeg.max}
                onChange={setLat}
                className={numberClass}
              />
            </Row>
            <Row label={t('launch.longitude')} unit="°">
              <NumberInput
                ariaLabel={t('launch.longitude')}
                value={lon}
                step={0.0001}
                min={LIMITS.longitudeDeg.min}
                max={LIMITS.longitudeDeg.max}
                onChange={setLon}
                className={numberClass}
              />
            </Row>
            <Row
              label={t('launch.altitude')}
              unit={
                <UnitChip
                  label={t('launch.altitude')}
                  quantity={LAUNCH_SI.distance.q}
                  scope={unitScope('launch', 'altitude')}
                />
              }
            >
              <NumberInput
                ariaLabel={t('launch.altitude')}
                value={alt === null ? null : altUnit.toUi(alt)}
                step={altUnit.step(10)}
                min={altUnit.toUi(LIMITS.launchAltitudeM.min)}
                max={altUnit.toUi(LIMITS.launchAltitudeM.max)}
                onChange={(v) => setAlt(v === null ? null : altUnit.fromUi(v))}
                className={numberClass}
              />
            </Row>
          </div>

          {/* Fed from the draft fields rather than the saved location, so the pin
              tracks a coordinate as it is typed and a mistake shows before the
              location is written. */}
          <SiteMap
            latitudeDeg={lat}
            longitudeDeg={lon}
            onPick={(la, lo) => {
              setLat(la);
              setLon(lo);
            }}
            className="h-64 sm:h-full sm:min-h-[19rem]"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:text-slate-100"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
