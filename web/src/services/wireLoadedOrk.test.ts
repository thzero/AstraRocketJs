import { describe, it, expect } from 'vitest';
import { C6 } from '../engine/api';
import type { ComponentNode, MotorSpec, RocketTree } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import type { LoadedOrk, MountMotor } from './loadOrk';
import { wireLoadedOrk } from './wireLoadedOrk';

const node = (o: object) => o as unknown as ComponentNode;
const spec = (designation: string): MotorSpec => ({ designation }) as unknown as MotorSpec;
// First motorMount = primary; 'pod' is a second mount that should ride in extraMotors.
const tree = {
  components: [
    node({ type: 'bodytube', id: 'primary', motorMount: true }),
    node({ type: 'innertube', id: 'pod', motorMount: true }),
  ],
} as unknown as RocketTree;

const launchDefaults = { launchRodAngleDeg: 5, windAverage: 3 } as unknown as LaunchConditions;

const loaded = (over: Partial<LoadedOrk>): LoadedOrk =>
  ({ name: 'Rocket', notes: ['note'], tree, motors: {}, motorSpecs: {}, ...over }) as unknown as LoadedOrk;

describe('wireLoadedOrk', () => {
  it('puts the primary motor on the sim (with its ignition) and other mounts in extraMotors', () => {
    const motorA = spec('A');
    const motorB = spec('B');
    const res = loaded({
      motorSpecs: {
        primary: { spec: motorA, ignitionEvent: 'launch', ignitionDelay: 2 } as MountMotor,
        pod: { spec: motorB } as MountMotor,
      },
    });
    const w = wireLoadedOrk(res, launchDefaults);

    expect(w.sim0.motor).toBe(motorA); // primary drives the Motor panel
    expect(w.sim0.ignitionEvent).toBe('launch'); // ignition lifted onto the sim...
    expect(w.sim0.ignitionDelay).toBe(2);
    expect(Object.keys(w.extraMotors)).toEqual(['pod']); // ...NOT into extraMotors
    expect(w.extraMotors.pod!.spec).toBe(motorB);
    expect(w.tree).toBe(tree);
    expect(w.loadedMeta).toEqual({ name: 'Rocket', notes: ['note'], exportMotors: {} });
  });

  it('falls back to a default C6 when the primary mount has no motor, seeding the other mount', () => {
    const w = wireLoadedOrk(loaded({ motorSpecs: {} }), launchDefaults);
    expect(w.sim0.motor).toBe(C6);
    expect(w.sim0.ignitionEvent).toBeUndefined();
    expect(w.extraMotors.pod!.spec).toBe(C6); // reconcileMounts seeds an empty non-primary mount
  });

  it('drops a motor whose mount no longer exists in the tree', () => {
    const w = wireLoadedOrk(loaded({ motorSpecs: { ghost: { spec: spec('G') } as MountMotor } }), launchDefaults);
    expect(w.extraMotors.ghost).toBeUndefined(); // 'ghost' isn't a mount in the tree
    expect(Object.keys(w.extraMotors)).toEqual(['pod']); // only the real non-primary mount remains (seeded C6)
  });

  it('merges launch defaults under the file’s launch conditions', () => {
    const w = wireLoadedOrk(
      loaded({ launch: { windAverage: 9 } as Partial<LaunchConditions> }),
      launchDefaults,
    );
    expect(w.sim0.launch.windAverage).toBe(9); // file wins
    expect((w.sim0.launch as unknown as { launchRodAngleDeg: number }).launchRodAngleDeg).toBe(5); // default fills the rest
  });
});
