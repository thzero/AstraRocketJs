import { useWorkspaceStore } from '../../src/state/store';
import { newFlightConfig } from '../../src/services/flight/flightConfigs';
import { findMounts } from '../../src/services/design/treeEdit';
import type { MotorSpec } from '../../src/engine/openRocketEngine';

/**
 * Give the named simulation a flight configuration of its own, with `spec` in
 * every mount.
 *
 * A row's motors live in the configuration it points at, and several rows can
 * point at one, so a fixture that wants one row flying a curve-less motor (what
 * an unresolved `.ork` import leaves behind) has to mint a configuration for it
 * rather than reach into the row.
 */
export function seatMotor(name: string, spec: MotorSpec): void {
  const st = useWorkspaceStore.getState();
  const motors = Object.fromEntries(findMounts(st.tree).map((m) => [m.id as string, { spec }]));
  const config = newFlightConfig(motors);
  useWorkspaceStore.setState({
    configs: [...st.configs, config],
    sims: st.sims.map((x) => (x.name === name ? { ...x, configId: config.id } : x)),
  });
}

/** A motor with no thrust curve: the run gate refuses it ("no motor"). */
export const CURVELESS: MotorSpec = {
  designation: 'unresolved',
  diameter: 0.024,
  length: 0.07,
  times: [],
  thrusts: [],
  masses: [],
  cgX: 0.035,
  ejectionDelay: 3,
};
