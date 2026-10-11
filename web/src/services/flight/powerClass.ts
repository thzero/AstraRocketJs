import type { ComponentNode, MotorSpec, RocketTree } from '../../engine/openRocketEngine';
import { clusterCount } from '../../tree/cluster';
import { curveStats } from '../motors/motorMath';
import type { FlightConfig } from './flightConfigs';

/**
 * Whether a configuration flies as a model rocket or a high power rocket, in
 * the safety codes' terms.
 *
 * The NAR Model Rocket Safety Code and the NAR High Power Rocket Safety Code
 * (with Tripoli's, which follows it) set different flying limits, so which code
 * applies decides what the run gate allows. The class is a property of what is
 * flown: the motors a configuration seats and what the rocket weighs with them,
 * so two configurations of one design can fall on either side.
 */
export type PowerClass = 'model' | 'highPower';

/**
 * Where high power starts, in SI. A rocket is high power when any one of these
 * is exceeded: a single motor over 160 N·s of total impulse (H and up) or over
 * 80 N of average thrust, more than 320 N·s or more than 125 g of propellant
 * installed in all, or more than 1,500 g at liftoff.
 */
const HIGH_POWER = {
  motorImpulseNs: 160,
  motorAvgThrustN: 80,
  installedImpulseNs: 320,
  installedPropellantKg: 0.125,
  liftoffMassKg: 1.5,
} as const;

/** One seated motor and how many copies of it fly. */
export interface SeatedMotor {
  spec: MotorSpec;
  /** Cluster positions times every pod set or parallel stage around the mount. */
  count: number;
}

const instancesOf = (n: ComponentNode): number => {
  if (n.type !== 'podset' && n.type !== 'parallelstage') return 1;
  const c = Number(n['instanceCount']);
  return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;
};

/**
 * Every motor a configuration puts on the pad, with its copy count. A mount in
 * a stage the configuration grounds carries nothing into the air and is left
 * out.
 */
export function seatedMotors(tree: RocketTree, config: FlightConfig): SeatedMotor[] {
  const grounded = new Set(config.grounded ?? []);
  const out: SeatedMotor[] = [];
  const walk = (nodes: readonly ComponentNode[], copies: number) => {
    for (const n of nodes) {
      if ((n.type === 'stage' || n.type === 'parallelstage') && typeof n.id === 'string' && grounded.has(n.id)) {
        continue;
      }
      const here = copies * instancesOf(n);
      if (n.motorMount === true && typeof n.id === 'string') {
        const seated = config.motors[n.id];
        if (seated) out.push({ spec: seated.spec, count: here * clusterCount(n['cluster'] as string | undefined) });
      }
      if (n.children) walk(n.children, here);
    }
  };
  walk(tree.components, 1);
  return out;
}

/**
 * The class those motors put a rocket in.
 *
 * `dryMassKg` is the kernel's mass of the rocket with no motors; the motors'
 * loaded masses are added to it for the liftoff mass. Null when the engine has
 * not answered yet, and the motors alone decide.
 */
export function powerClass(motors: readonly SeatedMotor[], dryMassKg: number | null | undefined): PowerClass {
  let installed = 0;
  let loaded = 0;
  let propellant = 0;
  for (const { spec, count } of motors) {
    const stats = curveStats(spec.times.map((t, i) => [t, spec.thrusts[i] ?? 0]));
    if (stats.impulse > HIGH_POWER.motorImpulseNs || stats.avg > HIGH_POWER.motorAvgThrustN) return 'highPower';
    installed += stats.impulse * count;
    loaded += (spec.masses[0] ?? 0) * count;
    // The propellant is what the motor burns: its loaded mass less its lightest.
    propellant += Math.max(0, (spec.masses[0] ?? 0) - Math.min(...spec.masses)) * count;
  }
  if (installed > HIGH_POWER.installedImpulseNs) return 'highPower';
  if (propellant > HIGH_POWER.installedPropellantKg) return 'highPower';
  if (dryMassKg != null && dryMassKg + loaded > HIGH_POWER.liftoffMassKg) return 'highPower';
  return 'model';
}

/** The class of the rocket a configuration flies. */
export function configPowerClass(
  tree: RocketTree,
  config: FlightConfig,
  dryMassKg: number | null | undefined,
): PowerClass {
  return powerClass(seatedMotors(tree, config), dryMassKg);
}
