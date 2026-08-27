import { useWorkspaceStore, selectActive } from '../../state/store';
import { SimulationsList } from './SimulationsList';
import { MotorRow } from './MotorRow';
import { LaunchPanel } from './LaunchPanel';
import { SimPanel } from './SimPanel';

/** Right pane: the simulations list, then the active sim's motor, launch conditions,
 *  run button and results. Reads the workspace store directly. */
export function SimulationsPanel() {
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  const runLabel = useWorkspaceStore((s) => selectActive(s).name);
  const result = useWorkspaceStore((s) => selectActive(s).result);
  const info = useWorkspaceStore((s) => s.info);
  const busy = useWorkspaceStore((s) => s.simBusy);

  const onSelectSim = useWorkspaceStore((s) => s.setActiveId);
  const onAddSim = useWorkspaceStore((s) => s.addSim);
  const onDeleteSim = useWorkspaceStore((s) => s.deleteSim);
  const onRenameSim = useWorkspaceStore((s) => s.renameSim);
  const onMotorChange = useWorkspaceStore((s) => s.setActiveMotor);
  const onLaunchChange = useWorkspaceStore((s) => s.patchLaunch);
  const onRun = useWorkspaceStore((s) => s.runSim);
  const onError = useWorkspaceStore((s) => s.setErr);

  return (
    <>
      <div className="space-y-4 p-3">
        <SimulationsList sims={sims} activeId={activeId} onSelect={onSelectSim} onAdd={onAddSim} onDelete={onDeleteSim} onRename={onRenameSim} />
        <MotorRow motor={motor} onChange={onMotorChange} onError={onError} />
      </div>
      <LaunchPanel launch={launch} onChange={onLaunchChange} />
      <SimPanel info={info} runLabel={runLabel} sim={result} busy={busy} onRun={onRun} />
    </>
  );
}
