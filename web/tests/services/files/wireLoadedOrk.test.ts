import { describe, it, expect } from 'vitest';
import type { ComponentNode, MotorSpec, RocketTree } from '../../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import type { LoadedOrk } from '../../../src/services/files/loadOrk';
import { primaryMotor, type MountMotor } from '../../../src/services/flight/flightConfigs';
import { hasThrustCurve, unflyable } from '../../../src/services/flight/runnability';
import { wireLoadedOrk } from '../../../src/services/files/wireLoadedOrk';
import { axialFrameOf } from '../../../src/tree/axialRebase';

const node = (o: object) => o as unknown as ComponentNode;
const spec = (designation: string): MotorSpec => ({ designation }) as unknown as MotorSpec;
// Two mounts: the aft one, and 'pod' as a second.
const tree = {
  components: [
    node({ type: 'bodytube', id: 'primary', motorMount: true }),
    node({ type: 'innertube', id: 'pod', motorMount: true }),
  ],
} as unknown as RocketTree;

const launchDefaults = { launchRodAngleDeg: 5, windAverage: 3 } as unknown as LaunchConditions;

const config = (over: Partial<LoadedOrk['configs'][number]> = {}) => ({
  id: 'cfg-1',
  name: null,
  motors: {} as Record<string, MountMotor>,
  ...over,
});

const loaded = (over: Partial<LoadedOrk>): LoadedOrk =>
  ({
    name: 'Rocket',
    notes: ['note'],
    tree,
    motors: {},
    configs: [config()],
    chosenConfigId: 'cfg-1',
    ...over,
  }) as unknown as LoadedOrk;

describe('wireLoadedOrk', () => {
  it('keeps each configuration’s motors, ignition and FILE id', () => {
    const motorA = spec('A');
    const motorB = spec('B');
    const w = wireLoadedOrk(
      loaded({
        configs: [
          config({
            motors: {
              primary: { spec: motorA, ignitionEvent: 'launch', ignitionDelay: 2 },
              pod: { spec: motorB },
            },
          }),
        ],
      }),
      launchDefaults,
    );

    expect(w.configs).toHaveLength(1);
    const c = w.configs[0]!;
    expect(c.id).toBe('cfg-1'); // the file's own configid, so a save writes it back
    expect(Object.keys(c.motors).sort()).toEqual(['pod', 'primary']);
    expect(c.motors.primary!.spec).toBe(motorA);
    expect(c.motors.primary!.ignitionEvent).toBe('launch'); // ignition rides with its motor
    expect(c.motors.primary!.ignitionDelay).toBe(2);
    expect(c.motors.pod!.spec).toBe(motorB);
    expect(w.tree).toBe(tree);
    expect(w.loadedMeta).toEqual({ name: 'Rocket', notes: ['note'], exportMotors: {} });
  });

  /**
   * A configuration is a way the rocket is set up to fly, so importing three and
   * opening one would leave two setups visible in the table with no run to put
   * numbers against.
   */
  it('gives every configuration a simulation of its own', () => {
    const w = wireLoadedOrk(
      loaded({
        configs: [
          config({ id: 'a', name: 'Contest', motors: { primary: { spec: spec('A') } } }),
          config({ id: 'b', motors: { primary: { spec: spec('B') }, pod: { spec: spec('') } } }),
          config({ id: 'c', name: 'Contest', motors: { primary: { spec: spec('C') } } }),
        ],
        chosenConfigId: 'b',
      }),
      launchDefaults,
    );

    expect(w.sims).toHaveLength(3);
    expect(w.sims.map((x) => x.configId)).toEqual(['a', 'b', 'c']);
    // The one the file marks default is the one the app opens on.
    expect(w.activeId).toBe(w.sims[1]!.id);
    // Named after the configuration: its name, else its motors. Two
    // configurations named the same are still two rows you can tell apart.
    expect(w.sims.map((x) => x.name)).toEqual(['Contest', 'B', 'Contest 2']);
  });

  it('carries a configuration’s deployment overrides through untouched', () => {
    // Dropping them would rewrite another configuration's recovery settings on
    // the first save.
    const deployments = { chute: { deployAltitude: 120 } };
    const w = wireLoadedOrk(loaded({ configs: [config({ deployments })] }), launchDefaults);
    expect(w.configs[0]!.deployments).toEqual(deployments);
  });

  it('carries the separation overrides and the grounded stages with them', () => {
    // All three are settings of this configuration. Forwarding only one of the
    // three would silently reset the other two, so a staged design would open
    // with its booster flying and its separation back on the design default.
    const separations = { booster: { separationDelay: 2 } };
    const grounded = ['booster'];
    const w = wireLoadedOrk(loaded({ configs: [config({ separations, grounded })] }), launchDefaults);
    expect(w.configs[0]!.separations).toEqual(separations);
    expect(w.configs[0]!.grounded).toEqual(grounded);
  });

  /**
   * A mount the file left empty flies nothing, not a default. Seating a C6 in it
   * opens a design saved without motors as a flyable rocket on motors the file
   * never named, which is what loadOrk refuses to do for a motor it cannot
   * resolve.
   */
  it('keeps a curve-less placeholder, and never seeds a C6 over it', () => {
    const empty = { spec: spec('') };
    const w = wireLoadedOrk(loaded({ configs: [config({ motors: { primary: empty, pod: empty } })] }), launchDefaults);
    for (const id of ['primary', 'pod']) {
      const seated = w.configs[0]!.motors[id];
      expect(seated).toBeDefined(); // present, so reconcileConfig has no hole to fill
      expect(hasThrustCurve(seated!.spec)).toBe(false);
    }
  });

  it('is blocked by the run gate until a motor is picked', () => {
    const empty = { spec: spec('') };
    const w = wireLoadedOrk(loaded({ configs: [config({ motors: { primary: empty, pod: empty } })] }), launchDefaults);
    expect(unflyable(w.sims[0]!, primaryMotor(w.tree, w.configs[0]!), 'model')).toEqual({ kind: 'noMotor' });
  });

  it('drops a motor whose mount no longer exists in the tree', () => {
    const w = wireLoadedOrk(loaded({ configs: [config({ motors: { ghost: { spec: spec('G') } } })] }), launchDefaults);
    expect(w.configs[0]!.motors.ghost).toBeUndefined(); // 'ghost' isn't a mount in the tree
    expect(Object.keys(w.configs[0]!.motors).sort()).toEqual(['pod', 'primary']); // the real mounts
  });

  it('merges launch defaults under the file’s launch conditions', () => {
    const w = wireLoadedOrk(loaded({ launch: { windAverage: 9 } as Partial<LaunchConditions> }), launchDefaults);
    expect(w.sims[0]!.launch.windAverage).toBe(9); // file wins
    expect((w.sims[0]!.launch as unknown as { launchRodAngleDeg: number }).launchRodAngleDeg).toBe(5); // default fills the rest
  });
});

describe('wireLoadedOrk: absolute positions', () => {
  // `.ork` positions a component with method="absolute" in the rocket frame.
  // It stays that way: every reader measures it from the nose tip, as the
  // engine does, and the part keeps its station when its parent moves.
  const absoluteTree = () =>
    ({
      components: [
        node({ type: 'nosecone', id: 'nose', length: 0.3, outerRadius: 0.012 }),
        node({
          type: 'bodytube',
          id: 'body',
          length: 0.4,
          outerRadius: 0.012,
          children: [
            node({
              type: 'trapezoidfinset',
              id: 'fins',
              rootChord: 0.05,
              position: { method: 'absolute', offset: 0.35 },
            }),
          ],
        }),
      ],
    }) as unknown as RocketTree;

  const fins = (t: RocketTree) =>
    (t.components[1]!.children![0]! as ComponentNode).position as {
      method: string;
      offset: number;
      ork?: { method: string; offset: number; resolved: number };
    };

  it('keeps an absolute offset as the file wrote it, at its station from the nose tip', () => {
    const out = wireLoadedOrk(loaded({ tree: absoluteTree() }), launchDefaults);
    expect(fins(out.tree)).toEqual({ method: 'absolute', offset: 0.35 });
    // The body tube starts 0.3 m back (behind the nose cone); the fins are
    // 0.05 m along it, 0.35 m from the tip.
    expect(axialFrameOf(out.tree, 'fins')!.start).toBeCloseTo(0.35, 12);
  });

  it('leaves an ordinary parent-relative position completely alone', () => {
    const plain = {
      components: [
        node({
          type: 'bodytube',
          id: 'body',
          length: 0.4,
          children: [
            node({ type: 'trapezoidfinset', id: 'fins', rootChord: 0.05, position: { method: 'bottom', offset: 0 } }),
          ],
        }),
      ],
    } as unknown as RocketTree;
    const out = wireLoadedOrk(loaded({ tree: plain }), launchDefaults);
    const p = fins({ components: [null, out.tree.components[0]] } as unknown as RocketTree);
    expect(p).toEqual({ method: 'bottom', offset: 0 }); // no `ork` marker added
  });
});
