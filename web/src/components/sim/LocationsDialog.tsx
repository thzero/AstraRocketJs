import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { Dialog } from '../common/Dialog';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { LAUNCH_SI } from '../../prefs/launchUnits';
import { LocationEditor } from './LocationEditor';
import { getLaunchLocationStore, type LaunchLocation } from '../../services/launchLocationStore';
import { useLocationList } from './useLocationList';

/**
 * The saved launch locations, listed on the left and edited on the right.
 *
 * Self-contained on purpose: it loads from the `LaunchLocationStore` itself and
 * applies a location through `patchLaunch`, so it works both from the launch
 * panel's ⚙ (where the site fields are on screen) and from the menu (where they
 * are not). That is why it exists as its own component rather than living
 * inside `LocationPicker` — a manage view reachable only from the one panel
 * that already has a dropdown is a manage view nobody finds.
 *
 * Master-detail rather than a list that opens a dialog per row: correcting a
 * set of coordinates is something you do to SEVERAL fields in a sitting, and a
 * modal per location makes each one a separate errand. It also gives the map
 * room to be worth looking at, which a small dialog over a small dialog did
 * not.
 *
 * Applying from here targets the ACTIVE simulation, which is what `patchLaunch`
 * patches — the same single undoable edit the dropdown makes.
 */
export function LocationsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const patchLaunch = useWorkspaceStore((s) => s.patchLaunch);
  // The launch panel's own altitude unit and scope, so this list reads in feet
  // for somebody who works in feet rather than always in meters.
  const altUnit = useUnits().at(unitScope('launch', 'altitude'), LAUNCH_SI.distance.q);

  const { locations, refresh } = useLocationList();
  // `null` = nothing selected. A string = that location. `'new'` = the draft.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Reported by the editor, so the list can ask before a click throws away
  // edits. The editor owns the draft; only IT can know whether one exists.
  const [dirty, setDirty] = useState(false);
  // Stable, because the editor passes it to an effect: a new function every
  // render would re-run that effect on every keystroke.
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  const creating = selectedId === NEW;
  // Resolved from the LIST rather than held as its own copy, so a save (which
  // refreshes the list under this pane) leaves the detail showing what was
  // stored, and a location deleted in another tab clears the selection instead
  // of editing something that is gone.
  const selected = creating ? null : ((locations ?? []).find((p) => p.id === selectedId) ?? null);
  const showsDetail = creating || selected !== null;

  /** Move the selection, asking first if it would throw away an edit. */
  const select = async (id: string | null) => {
    if (dirty && id !== selectedId) {
      const ok = await confirm({
        message: t('location.discardConfirm'),
        confirmLabel: t('common.discard'),
        danger: true,
      });
      if (!ok) return;
      setDirty(false);
    }
    setErr(null);
    setSelectedId(id);
  };

  const store = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch {
      setErr(t('location.saveFailed'));
      return false;
    }
  };

  const save = async (location: LaunchLocation) => {
    // Save replaces by id, so this is the one call for both editing an
    // existing location and adding a new one.
    if (await store(() => getLaunchLocationStore().save(location))) {
      setDirty(false);
      // Stay on what was just written, so a new location becomes the selected
      // one rather than dropping the user back to an empty pane.
      setSelectedId(location.id);
    }
  };

  const remove = async (location: LaunchLocation) => {
    // A location can be the only record of coordinates somebody measured at a field.
    const ok = await confirm({
      message: t('location.deleteConfirm', { name: location.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    if (await store(() => getLaunchLocationStore().remove(location.id))) {
      setDirty(false);
      setSelectedId(null);
    }
  };

  const apply = (location: LaunchLocation) => {
    patchLaunch({
      latitudeDeg: location.latitudeDeg,
      longitudeDeg: location.longitudeDeg,
      launchAltitudeM: location.launchAltitudeM,
    });
    onClose();
  };

  return (
    <Dialog
      id="locations"
      title={t('location.manage')}
      onClose={onClose}
      size="4xl"
      // List beside detail, each scrolling itself and reaching the panel's
      // edges: the body takes the height and does its own padding.
      layout="fill"
      // Fixed rather than the viewport's height: the map wants room, and the
      // list should not become a screen-tall column on a large monitor.
      height={720}
      actions={
        // The only way to add a location from the MENU, where no launch field
        // is on screen to capture. From the launch panel the 💾 button is still
        // the quicker route, since the numbers are already there.
        <button
          onClick={() => void select(NEW)}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('location.new')}
        </button>
      }
      footer={
        err ? (
          <p role="status" aria-live="polite" className="px-4 py-2 text-xs text-amber-400">
            {err}
          </p>
        ) : undefined
      }
    >
      {locations === null ? (
        <p className="grid flex-1 place-items-center p-6 text-sm text-slate-400">{t('common.loading')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* LEFT: the library. On a phone the two panes share the width, so
              only one shows at a time and the detail carries a back control. */}
          <div
            className={`min-h-0 flex-col overflow-y-auto md:flex md:w-[300px] md:shrink-0 md:border-r md:border-white/10 ${
              showsDetail ? 'hidden md:flex' : 'flex'
            }`}
          >
            {locations.length === 0 ? (
              // Reachable from the menu before anything is saved, so it has to
              // say what a location is and where they come from.
              <p className="p-6 text-center text-sm leading-snug text-slate-400">{t('location.empty')}</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {locations.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => void select(p.id)}
                      aria-pressed={p.id === selectedId}
                      className={`block w-full px-4 py-2.5 text-left ${
                        p.id === selectedId ? 'bg-sky-600/25 ring-1 ring-inset ring-sky-500/50' : 'hover:bg-slate-800'
                      }`}
                    >
                      <span className="block truncate text-sm text-slate-100">{p.name}</span>
                      {/* Plain coordinates: the row that lets you tell two
                          fields both called "the club field" apart. */}
                      <span className="block text-xs tabular-nums text-slate-500">
                        {p.latitudeDeg.toFixed(4)}°, {p.longitudeDeg.toFixed(4)}° · {altUnit.fmt(p.launchAltitudeM, 0)}{' '}
                        {altUnit.sym}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* RIGHT: the selected location, or the one being created. */}
          <div className={`min-h-0 min-w-0 flex-1 flex-col ${showsDetail ? 'flex' : 'hidden md:flex'}`}>
            {showsDetail ? (
              <LocationEditor
                // Keyed on the selection, so choosing another location re-seeds
                // every field by remounting rather than through an effect.
                key={selectedId ?? NEW}
                location={selected}
                takenNames={(locations ?? []).filter((p) => p.id !== selected?.id).map((p) => p.name)}
                onDirtyChange={onDirtyChange}
                onSave={(location) => void save(location)}
                onDelete={selected ? () => void remove(selected) : undefined}
                onApply={selected ? () => apply(selected) : undefined}
                onBack={() => void select(null)}
              />
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">
                {t('location.pickHint')}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** The selection token for the location being created, which has no id yet. */
const NEW = 'new';
