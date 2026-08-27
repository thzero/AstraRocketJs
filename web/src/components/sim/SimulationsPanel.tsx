import type { StaticInfo, FlightResult } from '../../engine/api';
import type { MotorSpec } from '../../engine/openRocketEngine';
import type { LaunchConditions } from '../../services/orkTree';
import type { Simulation } from '../../services/simulations';
import { SimulationsList } from './SimulationsList';
import { MotorRow } from './MotorRow';
import { LaunchPanel } from './LaunchPanel';
import { SimPanel } from './SimPanel';

/** Right pane: the simulations list, then the active sim's motor, launch conditions,
 *  run button and results. */
export function SimulationsPanel({
  sims, activeId, motor, launch, runLabel, result, info, busy,
  onSelectSim, onAddSim, onDeleteSim, onRenameSim, onMotorChange, onLaunchChange, onRun, onError,
}: {
  sims: Simulation[];
  activeId: string;
  motor: MotorSpec;
  launch: LaunchConditions;
  runLabel: string;
  result: FlightResult | null;
  info: StaticInfo | null;
  busy: boolean;
  onSelectSim: (id: string) => void;
  onAddSim: () => void;
  onDeleteSim: (id: string) => void;
  onRenameSim: (id: string, name: string) => void;
  onMotorChange: (m: MotorSpec) => void;
  onLaunchChange: (p: Partial<LaunchConditions>) => void;
  onRun: () => void;
  onError: (msg: string | null) => void;
}) {
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
