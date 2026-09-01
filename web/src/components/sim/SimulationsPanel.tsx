import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findMounts, isUpperStageMount } from '../../services/treeEdit';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { SimulationsList } from './SimulationsList';
import { MotorRow } from './MotorRow';
import { LaunchPanel } from './LaunchPanel';
import { SimPanel } from './SimPanel';

/** Right pane: the simulations list, then — for the selected sim — its name,
 *  motor, launch conditions, run button and results. Reads the store directly. */
export function SimulationsPanel() {
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const ignitionEvent = useWorkspaceStore((s) => selectActive(s).ignitionEvent);
  const ignitionDelay = useWorkspaceStore((s) => selectActive(s).ignitionDelay);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  const runLabel = useWorkspaceStore((s) => selectActive(s).name);
  const result = useWorkspaceStore((s) => selectActive(s).result);
  const info = useWorkspaceStore((s) => s.info);
  const busy = useWorkspaceStore((s) => s.simBusy);
  const tree = useWorkspaceStore((s) => s.tree);
  const extraMotors = useWorkspaceStore((s) => s.extraMotors);
  const setExtraMotor = useWorkspaceStore((s) => s.setExtraMotor);

  // One card per motor mount. The first (primary) mount's motor is the sim's
  // `motor`; the rest live in `extraMotors`, keyed by mount id.
  const mounts = useMemo(() => findMounts(tree), [tree]);
  const primaryId = mounts[0]?.id;

  const onSelectSim = useWorkspaceStore((s) => s.setActiveId);
  const onAddSim = useWorkspaceStore((s) => s.addSim);
  const onDuplicateSim = useWorkspaceStore((s) => s.duplicateSim);
  const deleteSim = useWorkspaceStore((s) => s.deleteSim);
  const onRenameSim = useWorkspaceStore((s) => s.renameSim);
  const onMotorChange = useWorkspaceStore((s) => s.setActiveMotor);
  const setActiveIgnition = useWorkspaceStore((s) => s.setActiveIgnition);
  const setExtraIgnition = useWorkspaceStore((s) => s.setExtraIgnition);
  const onLaunchChange = useWorkspaceStore((s) => s.patchLaunch);
  const runSim = useWorkspaceStore((s) => s.runSim);
  const onError = useWorkspaceStore((s) => s.setErr);
  const { t } = useTranslation();
  const { settings } = useSettings();
  const onRun = () => runSim(settings.simulation);
  const onDeleteSim = (id: string) => { if (!settings.simulation.confirmDelete || window.confirm(t('sims.deleteConfirm'))) deleteSim(id); };

  // The list is an accordion: collapsed (default) it shows only the selected
  // simulation and opens its config below; expanded it lists every sim to switch
  // between. Selecting / adding / duplicating collapses back to that sim.
  const [listOpen, setListOpen] = useState(false);
  const focusSim = (fn: () => void) => { fn(); setListOpen(false); };

  return (
    <>
      {/* Run + results first, so a run's outcome is front-and-centre. */}
      <SimPanel info={info} runLabel={runLabel} sim={result} busy={busy} onRun={onRun} />

      <div className="space-y-4 p-3 pt-0">
        <SimulationsList
          sims={sims} activeId={activeId} open={listOpen}
          onToggleOpen={() => setListOpen((o) => !o)}
          onSelect={(id) => focusSim(() => onSelectSim(id))}
          onAdd={() => focusSim(onAddSim)}
          onDuplicate={(id) => focusSim(() => onDuplicateSim(id))}
          onDelete={onDeleteSim}
        />

        {/* Config for the selected sim — only when the list is collapsed to it. */}
        {!listOpen && (
          <>
            <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">{t('sims.name')}</span>
                <input
                  value={runLabel} onChange={(e) => onRenameSim(activeId, e.target.value)}
                  aria-label={t('sims.rename')}
                  className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                />
              </label>
            </section>
            {mounts.map((mt, i) => {
              const id = mt.id as string;
              const isPrimary = id === primaryId;
              const name = typeof mt.name === 'string' && mt.name ? mt.name : `${t('part.innertube')} ${i + 1}`;
              const or = typeof mt.outerRadius === 'number' ? mt.outerRadius : null;
              const th = typeof mt.thickness === 'number' ? mt.thickness : 0;
              const bore = or != null ? (or - th) * 2 * 1000 : null; // inner diameter, mm
              return (
                <MotorRow
                  key={id}
                  title={mounts.length > 1 ? `${t('sims.motor')} - ${name}` : undefined}
                  motor={isPrimary ? motor : (extraMotors[id]?.spec ?? null)}
                  onChange={isPrimary ? onMotorChange : (m) => setExtraMotor(id, m)}
                  onError={onError}
                  mountDiameter={bore}
                  ignition={isPrimary
                    ? { event: ignitionEvent ?? 'automatic', delay: ignitionDelay ?? 0 }
                    : { event: extraMotors[id]?.ignitionEvent ?? 'automatic', delay: extraMotors[id]?.ignitionDelay ?? 0 }}
                  onIgnitionChange={isPrimary ? setActiveIgnition : (e, d) => setExtraIgnition(id, e, d)}
                  upperStage={isUpperStageMount(tree, id)}
                />
              );
            })}
          </>
        )}
      </div>
      {!listOpen && <LaunchPanel launch={launch} onChange={onLaunchChange} />}
    </>
  );
}
