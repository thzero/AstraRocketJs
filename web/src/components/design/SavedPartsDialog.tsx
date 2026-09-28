import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { confirm } from '../../state/confirmStore';
import { Dialog } from '../common/Dialog';
import { fmtNum } from '../../i18n/format';
import { useUnits, type Units } from '../../prefs/useUnits';
import { DEFAULT_CHUTE_CD } from '../../services/componentFilter';
import { deleteCustomPart, type SavedPartEntry } from '../../services/customParts';
import type { Component } from '../../services/componentDb';
import { SavedPartEditor } from './SavedPartEditor';
import { useSavedParts } from './useSavedParts';

/**
 * The parts the user saved, all of them, in one place: the list on the left,
 * the selected part's editor on the right.
 *
 * It exists for the reason `LocationsDialog` exists: a library you can only
 * see from the one panel that happens to use it is a library nobody finds.
 * Saved parts were worse than that, because the component picker only opens
 * when a component of a MATCHING type is selected — so a saved bulkhead was
 * invisible, and could not be deleted, on any design that had no bulkhead in
 * it. Reaching it meant adding a throwaway part to get at the picker.
 *
 * Master-detail rather than a list of dialogs: editing a library is a thing
 * you do to SEVERAL parts in a sitting, comparing one against the next, and a
 * modal per part makes each edit a separate errand. Saving leaves the part
 * selected and the list under your cursor.
 *
 * Applying a part is still the picker's job, which knows what the part has to
 * fit. This lists, describes, edits and removes.
 */
export function SavedPartsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const u = useUnits();
  const { entries } = useSavedParts();
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Reported by the editor, so the list can ask before a click throws away
  // edits. The editor owns the draft; only IT can know whether one exists.
  const [dirty, setDirty] = useState(false);
  // Stable, because the editor passes it to an effect: a new function every
  // render would re-run that effect on every keystroke.
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  // Grouped by catalog type, each group's parts by name. The order of the
  // groups is fixed rather than first-seen, so the list does not rearrange
  // itself as parts are added and removed.
  const groups = useMemo(() => {
    if (!entries) return [];
    const order = ['nosecone', 'bodytube', 'tubecoupler', 'centeringring', 'bulkhead', 'parachute'];
    const by = new Map<string, SavedPartEntry[]>();
    for (const e of entries) {
      if (!by.has(e.part.type)) by.set(e.part.type, []);
      by.get(e.part.type)!.push(e);
    }
    return [...by.entries()]
      .sort((a, b) => {
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        // A type the app no longer knows sorts last rather than first, which
        // is what indexOf's -1 would otherwise do.
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
      })
      .map(([type, list]) => ({
        type,
        list: [...list].sort((a, b) => a.part.partNo.localeCompare(b.part.partNo)),
      }));
  }, [entries]);

  // Resolved from the LIST rather than held as its own copy, so a save (which
  // refreshes the list under this pane) leaves the detail showing the stored
  // part, and a part deleted in another tab clears the selection instead of
  // editing something that is gone.
  const selected = entries?.find((e) => e.part.id === selectedId) ?? null;

  /** Move the selection, asking first if it would throw away an edit. */
  const select = async (id: string | null) => {
    if (dirty && id !== selectedId) {
      const ok = await confirm({
        message: t('picker.savedDiscardConfirm'),
        confirmLabel: t('common.discard'),
        danger: true,
      });
      if (!ok) return;
      setDirty(false);
    }
    setErr(null);
    setSelectedId(id);
  };

  const remove = async (e: SavedPartEntry) => {
    // A saved part can be the only copy of geometry somebody worked out, if
    // the design it came from has since been deleted. Same reasoning as a
    // saved launch location.
    const ok = await confirm({
      message: t('picker.deleteSavedConfirm', { name: e.part.partNo }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    setErr(null);
    try {
      await deleteCustomPart(e.part.id);
      setDirty(false);
      setSelectedId(null);
    } catch (err2) {
      // The store's own message: a refused write is not always "storage full".
      setErr(err2 instanceof Error ? err2.message : String(err2));
    }
  };

  return (
    <Dialog
      id="savedParts"
      title={t('picker.savedManage')}
      onClose={onClose}
      size="4xl"
      // List beside detail, each scrolling itself and reaching the panel's
      // edges: the body takes the height and does its own padding.
      layout="fill"
      // Fixed rather than the viewport's height, the way the motor picker is:
      // the list is the working surface and should not become a screen-tall
      // column on a large monitor.
      height={720}
      footer={
        err ? (
          <p role="status" aria-live="polite" className="px-4 py-2 text-xs text-amber-400">
            {err}
          </p>
        ) : undefined
      }
    >
      {entries === null ? (
        <p className="grid flex-1 place-items-center p-6 text-sm text-slate-400">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        // Reachable from the menu before anything is saved, so it has to say
        // where saved parts come from rather than show a void.
        <p className="grid flex-1 place-items-center p-6 text-center text-sm leading-snug text-slate-400">
          {t('picker.savedEmpty')}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* LEFT: the library. On a phone the two panes share the width, so
              only one shows at a time and the detail carries a back control. */}
          <div
            className={`min-h-0 flex-col overflow-y-auto md:flex md:w-[300px] md:shrink-0 md:border-r md:border-white/10 ${
              selected ? 'hidden md:flex' : 'flex'
            }`}
          >
            {groups.map(({ type, list }) => (
              <section key={type}>
                <h3 className="sticky top-0 bg-slate-900 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {t(`part.${type}`, { defaultValue: type })}
                </h3>
                <ul className="divide-y divide-white/5">
                  {list.map((e) => (
                    <li key={e.part.id}>
                      <button
                        onClick={() => void select(e.part.id)}
                        aria-pressed={e.part.id === selectedId}
                        className={`block w-full px-4 py-2.5 text-left ${
                          e.part.id === selectedId
                            ? 'bg-sky-600/25 ring-1 ring-inset ring-sky-500/50'
                            : 'hover:bg-slate-800'
                        }`}
                      >
                        <span className="block truncate text-sm text-slate-100">
                          <span className="mr-1 text-amber-400" aria-hidden="true">
                            ★
                          </span>
                          {e.part.partNo}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {e.row ? (
                            <>
                              {e.part.mfr} · {describe(e.row, u, t)}
                            </>
                          ) : (
                            // Shown rather than hidden: this is the only list
                            // it can be deleted from, and the picker has
                            // already dropped it.
                            <span className="text-amber-400">{t('picker.savedBrokenShort')}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* RIGHT: the selected part. */}
          <div className={`min-h-0 min-w-0 flex-1 flex-col ${selected ? 'flex' : 'hidden md:flex'}`}>
            {selected ? (
              <>
                {!selected.row && (
                  <p className="border-b border-white/10 bg-amber-500/10 px-4 py-2 text-xs leading-snug text-amber-300">
                    {t('picker.savedBroken')}
                  </p>
                )}
                <SavedPartEditor
                  // Keyed on the part, so selecting another one re-seeds every
                  // field by remounting rather than through an effect.
                  key={selected.part.id}
                  part={selected.part}
                  onDirtyChange={onDirtyChange}
                  onDelete={() => void remove(selected)}
                  onBack={() => void select(null)}
                />
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">
                {t('picker.savedPickHint')}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * The dimensions that tell two saved parts apart, in the user's own units.
 *
 * Short on purpose: it sits on one truncating line under the name, so it
 * carries what identifies the part (the sizes) and not what the type already
 * says. The unit is named once at the end rather than after every number.
 */
function describe(row: Component, u: Units, t: (k: string, o?: Record<string, unknown>) => string): string {
  const len = (v: number) => u.fmt('length', v);
  const sym = u.sym('length');
  switch (row.type) {
    case 'parachute':
      return `⌀ ${len(row.diameter)} ${sym} · ${t('prop.dragCoeff')} ${fmtNum(row.cd ?? DEFAULT_CHUTE_CD, 2)}`;
    case 'nosecone':
      return `${t(`noseShape.${row.shape}`)} · ⌀ ${len(row.outerDiameter)} · ${len(row.length)} ${sym}`;
    case 'bulkhead':
      return `⌀ ${len(row.outerDiameter)} · ${len(row.length)} ${sym}`;
    default:
      // Tube-shaped: the bore is what a coupler or ring IS, so it is named
      // even when the catalog would have left it null.
      return `⌀ ${len(row.outerDiameter)}${
        row.innerDiameter == null ? '' : ` / ${len(row.innerDiameter)}`
      } · ${len(row.length)} ${sym}`;
  }
}
