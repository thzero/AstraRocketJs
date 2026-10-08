import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, selectOutdated } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { useSettings } from '../../state/SettingsProvider';
import { SimulationsTable } from './SimulationsTable';
import { SimEditor } from './SimEditor';
import { RunButton } from './RunButton';
import { useIsDesktop } from '../common/useMediaQuery';
import { ToolBtn } from '../common/ToolBtn';
import { isOutdated, simStatus, type SimStatus } from '../../services/flight/simulations';
import { loadoutLabel } from '../../services/flight/flightConfigs';
import { configOf, selectDesignName } from '../../state/store';
import { useUnits } from '../../prefs/useUnits';
import { runTableCsv, CSV_MIME } from '../../services/exports/csvExport';
import { download, exportFilename } from '../../services/files/saveFile';
import { launcherKind } from '../../services/design/launcher';

/**
 * The Simulations tab: a toolbar, the table of runs, and (on a phone) the
 * selected simulation's editor underneath it. At lg+ the editor is the tab's
 * right column instead (see App.tsx), so the table gets the full width.
 */
export function SimulationsPane() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  // At lg+ the editor is the tab's right column (App.tsx). Below that there is
  // no right column, so it goes inline under the table: rendered once either
  // way, never two copies with one hidden. See useMediaQuery.
  const desktop = useIsDesktop();
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const tree = useWorkspaceStore((s) => s.tree);
  const configs = useWorkspaceStore((s) => s.configs);
  const simPrefs = useWorkspaceStore((s) => s.simPrefs);
  const setSimConfig = useWorkspaceStore((s) => s.setSimConfig);
  const simRuns = useWorkspaceStore((s) => s.simRuns);
  const selectedIds = useWorkspaceStore((s) => s.selectedSimIds);

  const onSelect = useWorkspaceStore((s) => s.setActiveId);
  const setTab = useWorkspaceStore((s) => s.setTab);
  const setResultSimId = useWorkspaceStore((s) => s.setResultSimId);
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
  const staleCount = useWorkspaceStore((s) => s.sims.filter((x) => !x.result || selectOutdated(s, x)).length);
  const designName = useWorkspaceStore(selectDesignName);
  const u = useUnits();

  /**
   * Every simulation as a row of the run table, in the units on screen. The
   * status is the table's own, so an outdated row says so in the file too.
   */
  const exportRunTable = () => {
    const statusText: Record<SimStatus, string> = {
      upToDate: t('sims.statusUpToDate'),
      outdated: t('sims.statusOutdated'),
      queued: t('sims.statusQueued'),
      running: t('sims.statusRunning'),
      failed: t('sims.statusFailed'),
      notRun: t('sims.notRun'),
      fromFile: t('sims.statusFromFile'),
    };
    const rows = sims.map((s) => {
      const cfg = configOf(configs, s);
      const motors = loadoutLabel(tree, cfg);
      return {
        name: s.name,
        configuration: cfg.name || motors || t('configs.noMotors'),
        motors,
        status: statusText[simStatus(s, simRuns, tree, isOutdated(s, tree, cfg, simPrefs))],
        result: s.result,
        fileSummary: s.fileSummary?.summary,
      };
    });
    download(exportFilename([designName, 'run-table'], 'csv'), runTableCsv(rows, u.all, launcherKind(tree)), CSV_MIME);
  };

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
      <div className="flex flex-wrap items-center gap-2 border-b border-line/10 p-3">
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
        <ToolBtn
          onClick={exportRunTable}
          disabled={!sims.some((s) => s.result || s.fileSummary)}
          title={t('sims.exportRunTable')}
        >
          ⬇ CSV
        </ToolBtn>
        {!desktop && <RunButton className="w-full" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
        <SimulationsTable
          sims={sims}
          activeId={activeId}
          selectedIds={selectedIds}
          runs={simRuns}
          tree={tree}
          configs={configs}
          simPrefs={simPrefs}
          onSetConfig={setSimConfig}
          onSelect={onSelect}
          onToggle={onToggle}
          onToggleAll={(all) => setSelected(all ? sims.map((x) => x.id) : [])}
          onOpenResults={(id) => {
            // Point both at it: the editor follows the active simulation, and
            // the results views follow their own picker. Setting only the first
            // would open whatever the last run was showing.
            onSelect(id);
            setResultSimId(id);
            setTab('results');
          }}
        />

        {!desktop && <SimEditor />}
      </div>
    </div>
  );
}
