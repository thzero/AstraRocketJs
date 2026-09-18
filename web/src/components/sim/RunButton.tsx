import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { findMounts } from '../../services/treeEdit';
import { unflyableSims, unflyableText } from '../../services/runnability';

/**
 * Runs whatever the table has selected: the ticked rows, or the active
 * simulation when nothing is ticked (see `selectRunIds`).
 *
 * The label counts them, because "Run flight simulation" over a batch of six was
 * a lie about what the click would do.
 */
export function RunButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  // Subscribe to the two STABLE pieces and derive the list here. Subscribing to
  // `selectRunIds` directly loops forever: it builds a fresh array on every
  // call, zustand compares by reference, so every render schedules another.
  const selectedIds = useWorkspaceStore((s) => s.selectedSimIds);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const runIds = useMemo(() => (selectedIds.length ? selectedIds : [activeId]), [selectedIds, activeId]);
  const sims = useWorkspaceStore((s) => s.sims);
  const tree = useWorkspaceStore((s) => s.tree);
  const busy = useWorkspaceStore((s) => s.simBusy);
  const info = useWorkspaceStore((s) => s.info);
  const runSims = useWorkspaceStore((s) => s.runSims);

  // Every row about to fly, judged by the same rule the run loop applies, so
  // the button and the loop cannot disagree about what is flyable.
  const about = useMemo(
    () => runIds.map((id) => sims.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x),
    [runIds, sims],
  );
  const refused = useMemo(() => unflyableSims(about), [about]);
  const flyable = about.length - refused.length;

  // No mount at all is a DESIGN fault: there is nowhere to seat a motor, so no
  // simulation of this rocket can fly and there is nothing to let through.
  const noMount = findMounts(tree).length === 0;
  // Otherwise the button only goes dead when NOTHING in the selection can fly.
  // Disabling a batch of twelve because one row is out of limits would refuse
  // eleven perfectly good flights; the loop already skips the bad ones, so the
  // button's job is to say which and why, not to veto the rest.
  const blocked = noMount || flyable === 0;
  const notice = noMount ? t('sim.noMount') : refused.length ? refused.map((u) => unflyableText(u, t)).join(' ') : null;

  const label = busy ? t('sim.running') : flyable > 1 ? t('sim.runMany', { count: flyable }) : t('sim.run');

  return (
    <div className={`space-y-2 ${className}`}>
      <button
        onClick={() => runSims(runIds, settings.simulation)}
        disabled={busy || !info || blocked}
        className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>
      {notice && !busy && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs leading-snug text-amber-300 ring-1 ring-amber-400/30">
          ⚠{' '}
          {/* Says what the click will actually do. Blocked, this is the whole
              story; with some rows still flyable it names what gets left out,
              so a batch is never quietly shorter than the tick count. */}
          {!blocked && refused.length ? `${t('sim.skipping', { count: refused.length })} ` : ''}
          {notice}
        </p>
      )}
    </div>
  );
}
