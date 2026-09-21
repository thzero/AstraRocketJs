import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions } from '../../services/orkTree';
import { getLaunchLocationStore, locationFrom, type LaunchLocation } from '../../services/launchLocationStore';
import { useLocationList } from './useLocationList';
import { DesignPropertiesDialog } from '../layout/DesignPropertiesDialog';
import { LocationsDialog } from './LocationsDialog';

/**
 * Saved launch locations, at the top of the launch panel's Site group.
 *
 * The three site fields (latitude, longitude, elevation) are properties of the
 * FIELD, not of a flight, and they were the only launch inputs with no memory:
 * every new simulation meant retyping coordinates from memory, which is exactly
 * how they come out wrong. A location is those three plus a name.
 *
 * Deliberately NOT the rod, the wind or the atmosphere. Those are conditions on
 * the day; a location that restored last month's wind would be worse than one that
 * restored nothing, because it would look authoritative.
 *
 * Selecting a location writes through the panel's own `onChange` / `onCommit`, so
 * applying one is an ordinary edit: undoable, and subject to the same
 * multi-selection rules as typing the numbers by hand.
 */
export function LocationPicker({
  launch,
  onChange,
  onCommit,
}: {
  launch: LaunchConditions;
  onChange: (patch: Partial<LaunchConditions>) => void;
  onCommit?: () => void;
}) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Shared with the manage dialog, and ordered: see `useLocationList` for why a
  // late-landing first read would otherwise empty this dropdown.
  const { locations: loaded, refresh } = useLocationList();
  const locations = loaded ?? [];

  const apply = (location: LaunchLocation) => {
    onChange({
      latitudeDeg: location.latitudeDeg,
      longitudeDeg: location.longitudeDeg,
      launchAltitudeM: location.launchAltitudeM,
    });
    onCommit?.();
  };

  /**
   * "Custom location" CLEARS the three site fields.
   *
   * It used to be inert: the select's value is derived from the fields, so
   * choosing it did nothing and React snapped the dropdown straight back to the
   * matching location. An option you can highlight but not pick reads as broken
   * however good the reason, and clearing is the only thing the choice can
   * sensibly mean — "I am somewhere else, and I have not said where yet".
   *
   * One undoable edit like any other, and the Run button already names a blank
   * required launch field, so the half-filled state it leaves is a state the
   * app explains rather than one it hides.
   */
  const clear = () => {
    onChange({ latitudeDeg: null, longitudeDeg: null, launchAltitudeM: null });
    onCommit?.();
  };

  const store = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch {
      // The store reports a refused write by throwing; told nothing, the user
      // would see a list that simply does not contain what they just saved.
      setErr(t('location.saveFailed'));
    }
  };

  /**
   * Which saved location the current fields correspond to, if any.
   *
   * Compared on the numbers rather than remembered as a selection: the fields
   * can be edited directly, imported from a `.ork` or replaced by "use my
   * location", and a remembered id would keep claiming a location that is no longer
   * what is on screen. Rounded to ~1 m of latitude, since a location's stored
   * precision and a typed one need not match bit for bit.
   */
  const near = (a: number | null | undefined, b: number, eps: number) => a != null && Math.abs(a - b) < eps;
  const current = locations.find(
    (p) =>
      near(launch.latitudeDeg, p.latitudeDeg, 1e-4) &&
      near(launch.longitudeDeg, p.longitudeDeg, 1e-4) &&
      near(launch.launchAltitudeM, p.launchAltitudeM, 0.5),
  );

  /**
   * A location is a PLACE, so it cannot be captured from a half-filled site.
   *
   * `locationFrom` has to produce numbers, and both coordinates are required launch
   * fields now, so saving with one blank would mint a location at 0°,0° - the Gulf
   * of Guinea - which would then apply itself silently every time it was
   * picked. Refusing to save is the honest answer, and the fields are already
   * marked as the ones to fill.
   */
  const savable = launch.latitudeDeg != null && launch.longitudeDeg != null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <select
          aria-label={t('location.label')}
          value={current?.id ?? ''}
          onChange={(e) => {
            const location = locations.find((p) => p.id === e.target.value);
            if (location) apply(location);
            else clear();
          }}
          className="min-w-0 flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-200 ring-1 ring-white/10"
        >
          {/* Both a STATE and a CHOICE: it is what the dropdown shows whenever
              the fields match no saved location, and picking it clears them. */}
          <option value="">{t('location.custom')}</option>
          {locations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setNaming(true)}
          disabled={!savable}
          title={savable ? t('location.save') : t('location.needsSite')}
          aria-label={t('location.save')}
          className="rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-40"
        >
          💾
        </button>
        <button
          onClick={() => setManaging(true)}
          disabled={locations.length === 0}
          title={t('location.manage')}
          aria-label={t('location.manage')}
          className="rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-40"
        >
          ⚙
        </button>
      </div>
      {err && (
        <p role="status" aria-live="polite" className="text-[11px] leading-snug text-amber-400">
          {err}
        </p>
      )}

      {naming && (
        <DesignPropertiesDialog
          title={t('location.save')}
          confirmLabel={t('common.save')}
          initialName={current?.name ?? ''}
          takenNames={locations.filter((p) => p.id !== current?.id).map((p) => p.name)}
          onCancel={() => setNaming(false)}
          onConfirm={(name) => {
            setNaming(false);
            // Saving under an existing location's name UPDATES it, rather than
            // leaving two entries a user cannot tell apart in the dropdown.
            const existing = locations.find((p) => p.name === name.trim());
            void store(async () => {
              const location = locationFrom(name, launch);
              await getLaunchLocationStore().save(existing ? { ...location, id: existing.id } : location);
            });
          }}
        />
      )}

      {/* The shared dialog, also reachable from the menu. It owns its own
          loading, renaming and deleting, so this only has to say when it is
          open and refresh the dropdown once it closes. */}
      {managing && (
        <LocationsDialog
          onClose={() => {
            setManaging(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
