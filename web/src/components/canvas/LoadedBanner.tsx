import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { RocketConfigDialog } from '../design/RocketConfigDialog';
import { useCanBuildDesign } from '../design/useCanBuildDesign';
import { useSettings } from '../../state/SettingsProvider';

/**
 * The design card at the head of the center pane: the rocket's name, the ✎ that
 * opens its configuration, and — for an imported `.ork` — what the file could
 * not bring across, with a button to dismiss it.
 *
 * The name lives here and not in the component tree's header too, which would say
 * the same thing twice on one screen. Here it has the width for a long name and
 * sits over the drawing it titles rather than over the parts list.
 *
 * It is a control only where the tree is (`useCanBuildDesign`). Naming a design,
 * its designer and its revision history is something you do to a design you are
 * building, and a window that cannot add a part to one is not the place for it;
 * there the line is a plain title.
 *
 * The import notes collapse. They matter most on the import that raised them and
 * less on the tenth look at the same design, and on a file with several they take a
 * third of the canvas; dismissing the card is the only other way to fold them away,
 * and that throws away the only record of them.
 *
 * Collapsed or not is a SETTING (`showImportNotes`), not component state: the card
 * unmounts whenever you close a design or leave the Design tab, so local state lets
 * the notes spring open again on the next import. App-wide rather than per design,
 * for the reasons on the setting itself.
 */
export function LoadedBanner({
  loaded,
  onClose,
}: {
  /** Import metadata, or null for a design that did not come from a file. */
  loaded: { name: string; notes: string[] } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const treeName = useWorkspaceStore((s) => s.tree.name);
  // The name, the designer, the design type and the revision history are things
  // you set on a design you are BUILDING, and the window that cannot add a part
  // to it has no business renaming it either. Where the component tree is not
  // offered the name is a title and nothing more (useCanBuildDesign).
  const canEditMeta = useCanBuildDesign();
  const { settings, update } = useSettings();
  const open = settings.showImportNotes;
  const [configOpen, setConfigOpen] = useState(false);
  const notes = loaded?.notes ?? [];
  const count = notes.length;
  // The tree's name is the live one: it is what the editor changes and what an
  // export writes. `loaded.name` is only the value the file arrived with.
  const name = (typeof treeName === 'string' && treeName) || loaded?.name || t('tree.rocket');

  // A design that came from a file gets the full card: it has a label, notes and
  // a Close. One that did not has only its name, so it gets a slim title row
  // rather than 64px of card chrome around a single line - the drawing below is
  // what the pane is for.
  const shell = loaded ? 'm-3 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10' : 'mx-3 mt-2';

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {loaded && <div className="text-[10px] uppercase tracking-wide text-slate-400">{t('banner.loaded')}</div>}
          {/* A button or a title, never a button that does nothing: the ✎ and
              the sky tint are what say this line is a control, so both go with
              the action rather than being left as a dead affordance. */}
          {canEditMeta ? (
            <button
              onClick={() => setConfigOpen(true)}
              aria-label={t('config.edit')}
              title={t('config.edit')}
              className={`group flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left font-semibold text-sky-400 hover:bg-slate-800/60 focus:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                loaded ? 'text-lg' : 'text-sm'
              }`}
            >
              <span className="min-w-0 truncate">{name}</span>
              <span aria-hidden className="shrink-0 text-xs text-slate-500 group-hover:text-sky-300">
                ✎
              </span>
            </button>
          ) : (
            <div
              className={`min-w-0 truncate px-1 py-0.5 font-semibold text-slate-200 ${loaded ? 'text-lg' : 'text-sm'}`}
            >
              {name}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {count > 0 && (
            <button
              onClick={() => update({ showImportNotes: !open })}
              aria-expanded={open}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-amber-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              <span aria-hidden>⚠</span>
              {t('banner.notes', { count })}
              <span aria-hidden className="text-[9px] text-slate-400">
                {open ? '▾' : '▸'}
              </span>
            </button>
          )}
          {/* Only an imported file can be "closed": it drops the association
              with the .ork, and there is nothing to drop otherwise. */}
          {loaded && (
            <button
              onClick={onClose}
              title={t('banner.closeTitle')}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              {t('banner.close')}
            </button>
          )}
        </div>
      </div>
      {count > 0 && open && (
        <ul className="mt-2 space-y-1 text-xs text-amber-400/90">
          {notes.map((n, i) => (
            <li key={i}>⚠ {n}</li>
          ))}
        </ul>
      )}
      {/* Mounted only while open, so its fields seed from the live design on
          each opening by construction rather than by a reseed effect. Closed
          along with the affordance that opens it, so a window narrowed while it
          is up does not leave it stranded on a design it can no longer edit. */}
      {configOpen && canEditMeta && <RocketConfigDialog onClose={() => setConfigOpen(false)} />}
    </div>
  );
}
