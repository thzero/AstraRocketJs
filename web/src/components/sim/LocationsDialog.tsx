import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { useFocusTrap } from '../common/useFocusTrap';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { LAUNCH_SI } from '../../prefs/launchUnits';
import { LocationEditDialog } from './LocationEditDialog';
import { getLaunchLocationStore, type LaunchLocation } from '../../services/launchLocationStore';
import { useLocationList } from './useLocationList';

/**
 * The saved launch locations, listed and managed.
 *
 * Self-contained on purpose: it loads from the `LaunchLocationStore` itself and applies a
 * location through `patchLaunch`, so it works both from the launch panel's ⚙ (where
 * the site fields are on screen) and from the menu (where they are not). That
 * is why it exists as its own component rather than living inside `LocationPicker`
 * — a manage view reachable only from the one panel that already has a
 * dropdown is a manage view nobody finds.
 *
 * Applying from here targets the ACTIVE simulation, which is what
 * `patchLaunch` patches — the same single undoable edit the dropdown makes.
 */
export function LocationsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const patchLaunch = useWorkspaceStore((s) => s.patchLaunch);
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });
  // The launch panel's own altitude unit and scope, so this list reads in feet
  // for somebody who works in feet rather than always in meters.
  const altUnit = useUnits().at(unitScope('launch', 'altitude'), LAUNCH_SI.distance.q);

  const { locations, refresh } = useLocationList();
  // `undefined` = closed. `null` = creating one. A LaunchLocation = editing that one.
  const [editing, setEditing] = useState<LaunchLocation | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const store = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch {
      setErr(t('location.saveFailed'));
    }
  };

  const remove = async (location: LaunchLocation) => {
    // A location can be the only record of coordinates somebody measured at a field.
    const ok = await confirm({
      message: t('location.deleteConfirm', { name: location.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) await store(() => getLaunchLocationStore().remove(location.id));
  };

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('location.manage')}
    >
      <div
        ref={panelRef}
        className="dialog-panel flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="font-semibold text-slate-100">{t('location.manage')}</h2>
          <div className="flex items-center gap-2">
            {/* The only way to add a location from the MENU, where no launch field is
                on screen to capture. From the launch panel the 💾 button is
                still the quicker route, since the numbers are already there. */}
            <button
              onClick={() => setEditing(null)}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
            >
              {t('location.new')}
            </button>
            <button
              onClick={onClose}
              className="px-2 text-slate-400 hover:text-slate-200"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>
        </div>

        {locations === null ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
        ) : locations.length === 0 ? (
          // Reachable from the menu before anything is saved, so it has to say
          // what a location is and where they come from rather than show a void.
          <p className="px-4 py-8 text-center text-sm leading-snug text-slate-400">{t('location.empty')}</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
            {locations.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-4 py-2.5">
                <button
                  onClick={() => {
                    patchLaunch({
                      latitudeDeg: p.latitudeDeg,
                      longitudeDeg: p.longitudeDeg,
                      launchAltitudeM: p.launchAltitudeM,
                    });
                    onClose();
                  }}
                  title={t('location.apply')}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm text-slate-100">{p.name}</span>
                  {/* Plain coordinates: the row that lets you tell two fields
                      both called "the club field" apart. */}
                  <span className="block text-xs tabular-nums text-slate-500">
                    {p.latitudeDeg.toFixed(4)}°, {p.longitudeDeg.toFixed(4)}° · {altUnit.fmt(p.launchAltitudeM, 0)}{' '}
                    {altUnit.sym}
                  </span>
                </button>
                <button
                  onClick={() => setEditing(p)}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  {t('location.edit')}
                </button>
                <button
                  onClick={() => void remove(p)}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:text-red-300"
                >
                  {t('common.delete')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {err && (
          <p role="status" aria-live="polite" className="border-t border-white/10 px-4 py-2 text-xs text-amber-400">
            {err}
          </p>
        )}
      </div>

      {editing !== undefined && (
        <LocationEditDialog
          location={editing}
          takenNames={(locations ?? []).filter((p) => p.id !== editing?.id).map((p) => p.name)}
          onCancel={() => setEditing(undefined)}
          onSave={(location) => {
            setEditing(undefined);
            // Save replaces by id, so this is the one call for both editing an
            // existing location and adding a new one.
            void store(() => getLaunchLocationStore().save(location));
          }}
        />
      )}
    </div>
  );
}
