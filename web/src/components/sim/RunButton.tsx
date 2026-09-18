import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, hasThrustCurve } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { findMounts } from '../../services/treeEdit';
import { launchLimitViolations, limitText } from '../../services/safetyLimits';

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
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const sims = useWorkspaceStore((s) => s.sims);
  const tree = useWorkspaceStore((s) => s.tree);
  const busy = useWorkspaceStore((s) => s.simBusy);
  const info = useWorkspaceStore((s) => s.info);
  const runSims = useWorkspaceStore((s) => s.runSims);

  // A design with no motor mount (nowhere to seat a motor) or no usable motor on
  // the one you are about to fly can't fly — say why rather than failing on
  // click. A BATCH is judged on the active sim alone: the others are checked as
  // the loop reaches them, and one unflyable row does not block the rest.
  // Launch conditions outside the NAR/Tripoli codes stop the run outright: they
  // are simulation settings, so there is nothing to preserve by flying them.
  // Checked across everything about to fly, not just the active sim — a batch
  // that silently skipped a row would be worse than one that says why.
  const outside = runIds
    .map((id) => sims.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .flatMap((x) => launchLimitViolations(x.launch));

  const blockReason =
    findMounts(tree).length === 0
      ? t('sim.noMount')
      : runIds.length === 1 && !hasThrustCurve(motor)
        ? t('sim.noMotor')
        : outside.length
          ? `${t('limits.blocked')} ${outside.map((v) => limitText(v, t)).join(' ')}`
          : null;

  const label = busy ? t('sim.running') : runIds.length > 1 ? t('sim.runMany', { count: runIds.length }) : t('sim.run');

  return (
    <div className={`space-y-2 ${className}`}>
      <button
        onClick={() => runSims(runIds, settings.simulation)}
        disabled={busy || !info || !!blockReason}
        className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>
      {blockReason && !busy && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-300 ring-1 ring-amber-400/30">
          ⚠ {blockReason}
        </p>
      )}
    </div>
  );
}
