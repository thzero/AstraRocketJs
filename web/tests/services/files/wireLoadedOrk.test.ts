import { describe, it, expect } from 'vitest';
import type { ComponentNode, MotorSpec, RocketTree } from '../../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import type { LoadedOrk } from '../../../src/services/files/loadOrk';
import { primaryMotor, type MountMotor } from '../../../src/services/flight/flightConfigs';
import { hasThrustCurve, unflyable } from '../../../src/services/flight/runnability';
import { wireLoadedOrk } from '../../../src/services/files/wireLoadedOrk';

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
    // Not editable here yet, but dropping them would rewrite another
    // configuration's recovery settings on the first save.
    const deployments = { chute: { deployAltitude: 120 } };
    const w = wireLoadedOrk(loaded({ configs: [config({ deployments })] }), launchDefaults);
    expect(w.configs[0]!.deployments).toEqual(deployments);
  });

  it('carries the separation overrides and the grounded stages with them', () => {
    // All three are settings of THIS configuration. Forwarding one of the three
    // silently reset the other two, so a staged design opened with its booster
    // flying and its separation back on the design default.
    const separations = { booster: { separationDelay: 2 } };
    const grounded = ['booster'];
    const w = wireLoadedOrk(loaded({ configs: [config({ separations, grounded })] }), launchDefaults);
    expect(w.configs[0]!.separations).toEqual(separations);
    expect(w.configs[0]!.grounded).toEqual(grounded);
  });

  /**
   * A mount the FILE left empty flies nothing, not a default. Seating a C6 in it
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
    expect(unflyable(w.sims[0]!, primaryMotor(w.tree, w.configs[0]!))).toEqual({ kind: 'noMotor' });
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

describe('wireLoadedOrk — absolute positions', () => {
  // `.ork` positions a component with method="absolute" in the ROCKET frame,
  // but the editor works entirely in the parent frame. Leaving it meant the
  // schematic, 3D view, drag handles and PDF drew the part at
  // parentStart + offset while the engine flew it at offset.
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

  it('resolves an absolute offset into the parent frame the editor works in', () => {
    const out = wireLoadedOrk(loaded({ tree: absoluteTree() }), launchDefaults);
    const p = fins(out.tree);
    // The body tube starts 0.3 m back (behind the nose cone), so a part at an
    // absolute 0.35 m is 0.05 m from the tube's own leading edge.
    expect(p.method).toBe('top');
    expect(p.offset).toBeCloseTo(0.05, 9);
  });

  it('keeps what the file said, so the .ork round-trip stays byte-stable', () => {
    const out = wireLoadedOrk(loaded({ tree: absoluteTree() }), launchDefaults);
    const p = fins(out.tree);
    expect(p.ork!.method).toBe('absolute');
    expect(p.ork!.offset).toBe(0.35); // verbatim, so the exporter can write it back
    // `resolved` is the computed parent-relative value (0.35 - 0.3, float noise
    // and all). It is compared with === at export time, so it must be the SAME
    // value that landed in `offset`, not a rounded one.
    expect(p.ork!.resolved).toBe(p.offset);
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
