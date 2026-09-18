import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { useSettings } from '../../state/SettingsProvider';
import { SimulationsTable } from './SimulationsTable';
import { SimEditor } from './SimEditor';
import { RunButton } from './RunButton';
import { useIsDesktop } from '../common/useMediaQuery';

/**
 * The Simulations tab: a toolbar, the table of runs, and — on a phone — the
 * selected simulation's editor underneath it. At lg+ the editor is the tab's
 * right column instead (see App.tsx), so the table gets the full width.
 */
export function SimulationsPane() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  // At lg+ the editor is the tab's right column (App.tsx). Below that there is
  // no right column, so it goes inline under the table — rendered ONCE either
  // way, never two copies with one hidden. See useMediaQuery.
  const desktop = useIsDesktop();
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const tree = useWorkspaceStore((s) => s.tree);
  const simRuns = useWorkspaceStore((s) => s.simRuns);
  const selectedIds = useWorkspaceStore((s) => s.selectedSimIds);

  const onSelect = useWorkspaceStore((s) => s.setActiveId);
  const setTab = useWorkspaceStore((s) => s.setTab);
  const onToggle = useWorkspaceStore((s) => s.toggleSimSelected);
  const setSelected = useWorkspaceStore((s) => s.setSimsSelected);
  const onAdd = useWorkspaceStore((s) => s.addSim);
  const onDuplicate = useWorkspaceStore((s) => s.duplicateSim);
  const deleteSim = useWorkspaceStore((s) => s.deleteSim);
  const runOutdated = useWorkspaceStore((s) => s.runOutdated);
  const busy = useWorkspaceStore((s) => s.simBusy);
  // How many rows are not current: never flown, or flown against a design that
  // has since changed. Counted in the label so the button says what it will do
  // rather than leaving you to work it out from the dots.
  const staleCount = sims.filter((x) => !x.result || x.outdated).length;

  const onDelete = async () => {
    if (
      !settings.simulation.confirmDelete ||
      (await confirm({ message: t('sims.deleteConfirm'), confirmLabel: t('common.delete'), danger: true }))
    ) {
      deleteSim(activeId);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
        <ToolBtn onClick={onAdd}>{t('sims.new')}</ToolBtn>
        <ToolBtn onClick={() => onDuplicate(activeId)}>{t('sims.duplicate')}</ToolBtn>
        <ToolBtn
          onClick={onDelete}
          disabled={sims.length <= 1}
          title={sims.length <= 1 ? t('sims.deleteLast') : t('sims.delete')}
          danger
        >
          {t('sims.delete')}
        </ToolBtn>
        {/* Independent of the tick boxes on purpose: "bring this workspace up
            to date" is a different question from "fly these rows", and making it
            reuse the selection would mean clearing and restoring whatever the
            user had ticked. */}
        <ToolBtn
          onClick={() => runOutdated(settings.simulation)}
          disabled={busy || staleCount === 0}
          title={staleCount === 0 ? t('sims.runOutdatedNone') : t('sims.runOutdated', { count: staleCount })}
        >
          {t('sims.runOutdated', { count: staleCount })}
        </ToolBtn>
        {/* At lg+ Run heads the right column, beside the simulation it flies.
            A phone has no right column, so it keeps the button here where it is
            reachable without scrolling past the table. One instance either way
            (see useMediaQuery). */}
        {!desktop && <RunButton className="w-full" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
        <SimulationsTable
          sims={sims}
          activeId={activeId}
          selectedIds={selectedIds}
          runs={simRuns}
          tree={tree}
          onSelect={onSelect}
          onToggle={onToggle}
          onToggleAll={(all) => setSelected(all ? sims.map((x) => x.id) : [])}
          onOpenResults={(id) => {
            // The Results tab shows the ACTIVE simulation, so opening a row's
            // flight means pointing the workspace at it first.
            onSelect(id);
            setTab('results');
          }}
        />

        {!desktop && <SimEditor />}
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-white/10 disabled:cursor-not-allowed disabled:text-slate-600 ${
        danger ? 'bg-slate-800 text-red-300 hover:bg-slate-700' : 'bg-slate-800 text-sky-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
