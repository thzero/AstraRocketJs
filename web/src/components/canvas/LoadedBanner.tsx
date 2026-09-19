import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { RocketConfigDialog } from '../design/RocketConfigDialog';
import { useSettings } from '../../state/SettingsProvider';

/**
 * The design card at the head of the center pane: the rocket's name, the ✎ that
 * opens its configuration, and — for an imported `.ork` — what the file could
 * not bring across, with a button to dismiss it.
 *
 * The name used to live in the component tree's header as well, which said the
 * same thing twice on the same screen. It belongs here, where it has the width
 * for a long name and sits over the drawing it titles rather than over the
 * parts list.
 *
 * The import notes collapse. They matter most on the import that raised them
 * and less on the tenth look at the same design, and on a file with several they
 * took a third of the canvas with no way to fold them away short of dismissing
 * the card — which also throws away the only record of them.
 *
 * Collapsed or not is a SETTING (`showImportNotes`), not component state: the
 * card unmounts whenever you close a design or leave the Design tab, so local
 * state meant the notes sprang open again on the next import and the fold had
 * to be repeated forever. App-wide rather than per design, for the reasons on
 * the setting itself.
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
      <RocketConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
