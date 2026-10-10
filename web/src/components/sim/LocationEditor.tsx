import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../common/NumberInput';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { LAUNCH_SI } from '../../prefs/launchUnits';
import { uuid } from '../../services/app/uuid';
import { SiteMap } from './SiteMap';
import { LAUNCH_SITE_LIMITS as LIMITS, type LaunchLocation } from '../../services/storage/launchLocationStore';
import { EditorFooter } from '../common/MasterDetail';

/**
 * The detail half of the saved locations dialog: one location in full (name,
 * latitude, longitude and elevation), or a blank one being created.
 *
 * Every field is editable, not just the name. Coordinates get typed wrong, a
 * field's published elevation gets corrected, and a location saved from the
 * launch panel captures whatever was in the boxes at the time, so the thing you
 * most want to fix about a location is usually a number rather than its name.
 *
 * The bounds are the store's own (`LAUNCH_SITE_LIMITS`, checked by
 * `isLocation`), which are also the ones `LaunchPanel` clamps its fields to.
 * Stating them here as `min`/`max` means a bad value is unreachable rather than
 * rejected after the fact.
 *
 * The map under the fields is the other half of the same job. Four digits of
 * latitude are unverifiable by reading them, and a club field usually has no
 * published coordinates at all: you know it by the mown strip off the county
 * road. Clicking the map fills both numbers, and the numbers move the pin, so
 * either one can be the thing you know.
 *
 * The parent mounts this keyed on the location, so selecting another one
 * re-seeds every field by remounting rather than through an effect.
 */
export function LocationEditor({
  location,
  takenNames = [],
  onDirtyChange,
  onSave,
  onDelete,
  onApply,
  onBack,
}: {
  /** The location to edit, or null to create one. */
  location: LaunchLocation | null;
  /** Other locations' names, to warn about a duplicate (not to forbid it). */
  takenNames?: string[];
  /** Lets the list ask before a selection change would discard edits. */
  onDirtyChange: (dirty: boolean) => void;
  onSave: (location: LaunchLocation) => void;
  /** Absent while creating: there is nothing stored yet to remove. */
  onDelete?: () => void;
  /** Absent while creating, and refused while edited: see the button. */
  onApply?: () => void;
  /** Phone only: the two panes share the width, so the list needs a way back. */
  onBack: () => void;
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
   * Focus and select the name synchronously, before the browser paints.
   *
   * A deferred focus (such as `requestAnimationFrame`) leaves a frame in which
   * the dialog is on screen without focus. A click into another field inside
   * that frame would have its focus pulled away mid-keystroke, so the first
   * thing typed into the latitude would land in the name box.
   *
   * A layout effect runs after the DOM is in place and before paint, so there
   * is no such gap. `useFocusTrap`'s own pull is a passive effect that skips a
   * panel which already holds focus, so it runs after this and leaves it be.
   *
   * Only when creating: in a master-detail list, stealing focus on every
   * selection would fight the arrow keys somebody is browsing the list with.
   */
  useLayoutEffect(() => {
    if (!location) nameRef.current?.select();
  }, [location]);

  const trimmed = name.trim();
  const duplicate = trimmed !== '' && takenNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  // Latitude and longitude have no sensible default (a location at 0°,0° is in
  // the Gulf of Guinea, not "unset"), so both are required. Elevation defaults
  // to sea level, which is a real answer for a coastal field.
  const valid = trimmed !== '' && lat !== null && lon !== null;

  // Compared against what is stored rather than tracked by a flag set on every
  // keystroke, so typing a character and deleting it again leaves the editor
  // clean and the discard prompt does not fire over an edit nobody made. A new
  // location is dirty the moment anything is entered.
  const dirty =
    name !== (location?.name ?? '') ||
    lat !== (location?.latitudeDeg ?? null) ||
    lon !== (location?.longitudeDeg ?? null) ||
    alt !== (location?.launchAltitudeM ?? null);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  /**
   * Bumped by Discard to remount the number fields.
   *
   * `NumberInput` holds a text draft while it is focused and only drops it on
   * blur, so putting the prop back is not enough on its own: the field keeps
   * rendering what was typed. Clicking Discard blurs it first, but a Discard
   * reached any other way does not. Remounting throws the draft away outright.
   */
  const [revision, setRevision] = useState(0);

  const revert = () => {
    setName(location?.name ?? '');
    setLat(location?.latitudeDeg ?? null);
    setLon(location?.longitudeDeg ?? null);
    setAlt(location?.launchAltitudeM ?? null);
    setRevision((r) => r + 1);
  };

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
    <>
      <div // eslint-disable-line jsx-a11y-x/no-static-element-interactions -- catches Enter bubbling up from any field in the form; the div itself takes no input
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        // On the wrapper rather than the panel, which the shell owns. Keydown
        // bubbles from whichever field is being typed into, so this still
        // catches Enter anywhere in the form. Only from a field: Enter on a
        // button is that button's, and Enter on the map is a pick it has
        // already handled, which would otherwise save the coordinates from
        // before it.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.defaultPrevented && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            submit();
          }
        }}
      >
        {/* Phone only: at `md` and up the list is beside this. */}
        <button
          onClick={onBack}
          className="-mb-1 self-start rounded px-1 text-sm text-ink-muted hover:text-ink md:hidden"
          aria-label={t('location.back')}
        >
          ‹
        </button>

        <label className="block text-xs text-ink-muted">
          {t('location.name')}
          <input
            ref={nameRef}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg bg-raised px-3 py-2 text-sm text-ink-strong ring-1 ring-line/10 focus:ring-accent-500"
          />
        </label>
        {duplicate && <p className="text-[11px] leading-snug text-warn-400">{t('location.duplicateName')}</p>}

        <div key={revision} className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
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
              onChange={onSi(altUnit, setAlt)}
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
          className="min-h-[14rem] flex-1"
        />
      </div>

      <EditorFooter
        onDelete={onDelete}
        dirty={dirty}
        onRevert={revert}
        onSave={submit}
        saveDisabled={!valid}
        saveTitle={valid ? undefined : t('location.needsSite')}
      >
        {onApply && (
          <button
            onClick={onApply}
            disabled={dirty}
            // Refused mid-edit rather than applying the draft: this list is
            // the sites you have saved, and sending the simulation a set of
            // coordinates that exist nowhere is not what "use this location"
            // offers.
            title={dirty ? t('location.applyNeedsSave') : t('location.apply')}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-accent-300 hover:bg-accent-500/10 disabled:text-ink-faint disabled:hover:bg-transparent"
          >
            {t('location.use')}
          </button>
        )}
      </EditorFooter>
    </>
  );
}

const numberClass =
  'w-28 rounded-md bg-raised px-2 py-1.5 text-right text-sm tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500';

function Row({ label, unit, children }: { label: string; unit: ReactNode; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-ink-soft">
      <span className="min-w-24">{label}</span>
      <span className="flex items-center gap-1">
        {children}
        <span className="min-w-8 text-ink-faint">{unit}</span>
      </span>
    </label>
  );
}
