import { describe, it, expect } from 'vitest';
import { migrateWorkspace } from '../../../src/services/storage/workspaceMigrate';
import { flightKey } from '../../../src/services/flight/simulations';
import type { ComponentNode, MotorSpec, RocketTree } from '../../../src/engine/openRocketEngine';
import type { Workspace } from '../../../src/services/storage/workspaceStore';

const node = (o: object) => o as unknown as ComponentNode;
const spec = (designation: string): MotorSpec =>
  ({ designation, manufacturer: 'Estes', diameter: 0.024, length: 0.07, ejectionDelay: 5 }) as unknown as MotorSpec;

/** Two mounts, so "the first one apart from the rest" has something to be wrong about. */
const tree = {
  components: [
    node({ type: 'bodytube', id: 'aft', motorMount: true }),
    node({ type: 'innertube', id: 'pod', motorMount: true }),
  ],
} as unknown as RocketTree;

/** A version-1 simulation: its loadout inline, the first mount held apart. */
const simV1 = (over: object = {}) => ({ id: 'a', name: 'A', motor: spec('C6'), launch: {}, result: null, ...over });

const v1 = (over: object = {}) => ({ version: 1, tree, sims: [simV1()], activeId: 'a', loadedMeta: null, ...over });

describe('migrateWorkspace', () => {
  it('refuses a blob that is not a workspace', () => {
    expect(migrateWorkspace(null)).toBeNull();
    expect(migrateWorkspace({ version: 1, tree: { components: 'nope' }, sims: [simV1()] })).toBeNull();
    expect(migrateWorkspace({ version: 1, tree, sims: [] })).toBeNull();
  });

  // Every reader after this one dereferences each entry, so a null entry has to
  // be refused here rather than throw later in the load.
  it('refuses a blob whose simulations, configurations or components are not objects', () => {
    expect(migrateWorkspace(v1({ sims: [simV1(), null] }))).toBeNull();
    expect(migrateWorkspace(v1({ sims: [{ ...simV1(), id: 7 }] }))).toBeNull();
    expect(migrateWorkspace(v1({ tree: { components: [null] } }))).toBeNull();
    expect(migrateWorkspace(v1({ tree: { components: [node({ type: 'bodytube', children: [null] })] } }))).toBeNull();
    expect(migrateWorkspace(v1({ tree: null }))).toBeNull();
    const w2 = { ...v1(), version: 2, sims: [{ id: 'a', configId: 'c1' }] };
    expect(migrateWorkspace({ ...w2, configs: [null] })).toBeNull();
    expect(migrateWorkspace({ ...w2, configs: [{ name: 'no id' }] })).toBeNull();
    expect(migrateWorkspace({ ...w2, configs: [{ id: 'c1', motors: {} }] })).not.toBeNull();
  });

  it('refuses a version this build does not know, rather than half-reading it', () => {
    // An installed PWA can have an older build cached, so a newer workspace is a
    // live possibility. Reading it as far as it parses would overwrite the user's
    // design with a partial copy of itself.
    expect(migrateWorkspace({ ...v1(), version: 4 })).toBeNull();
  });

  it('keeps a version-3 workspace as it is', () => {
    const w2 = {
      version: 3,
      tree,
      sims: [{ id: 'a', name: 'A', configId: 'c1', launch: {}, result: null }],
      configs: [{ id: 'c1', name: null, motors: {} }],
      activeId: 'a',
      loadedMeta: null,
    } as unknown as Workspace;
    expect(migrateWorkspace(w2)).toBe(w2);
  });

  it('refuses a version-2 workspace with no configurations, which cannot fly', () => {
    expect(migrateWorkspace({ ...v1(), version: 2, configs: [] })).toBeNull();
  });

  it('lifts one inline loadout into one configuration, ignition and all', () => {
    const w = migrateWorkspace(
      v1({
        sims: [
          simV1({
            ignitionEvent: 'launch',
            ignitionDelay: 2,
            extraMotors: { pod: { spec: spec('D12'), ignitionEvent: 'burnout' } },
          }),
        ],
      }),
    )!;
    expect(w.version).toBe(3);
    expect(w.configs).toHaveLength(1);
    const c = w.configs[0]!;
    expect(c.name).toBeNull(); // unnamed: naming it would invent a name nobody typed
    expect(Object.keys(c.motors).sort()).toEqual(['aft', 'pod']);
    expect(c.motors.aft).toEqual({ spec: spec('C6'), ignitionEvent: 'launch', ignitionDelay: 2 });
    expect(c.motors.pod!.ignitionEvent).toBe('burnout');
    expect(w.sims[0]!.configId).toBe(c.id);
    // The inline fields are gone, not left beside the configuration to drift.
    expect('motor' in w.sims[0]!).toBe(false);
    expect('extraMotors' in w.sims[0]!).toBe(false);
  });

  it('gives rows that flew the same loadout ONE configuration', () => {
    const w = migrateWorkspace(
      v1({ sims: [simV1({ id: 'a' }), simV1({ id: 'b' }), simV1({ id: 'c' })], activeId: 'a' }),
    )!;
    expect(w.configs).toHaveLength(1);
    expect(new Set(w.sims.map((x) => x.configId)).size).toBe(1);
  });

  it('keeps a configuration each for rows that differ below the first mount', () => {
    const w = migrateWorkspace(
      v1({
        sims: [
          simV1({ id: 'a', extraMotors: { pod: { spec: spec('C6') } } }),
          simV1({ id: 'b', extraMotors: { pod: { spec: spec('D12') } } }),
        ],
      }),
    )!;
    expect(w.configs).toHaveLength(2);
    expect(w.sims[0]!.configId).not.toBe(w.sims[1]!.configId);
  });

  it('folds the oldest shape, one workspace-wide map, into every row', () => {
    // It applied to every simulation, so that is where it has to land.
    const w = migrateWorkspace(
      v1({
        sims: [simV1({ id: 'a' }), simV1({ id: 'b' })],
        extraMotors: { pod: { spec: spec('D12') } },
      }),
    )!;
    expect(w.configs).toHaveLength(1);
    expect(w.configs[0]!.motors.pod!.spec.designation).toBe('D12');
  });

  it('drops a lingering entry for the first mount, which no v1 reader flew', () => {
    const w = migrateWorkspace(v1({ sims: [simV1({ extraMotors: { aft: { spec: spec('NEVER-FLOWN') } } })] }))!;
    expect(w.configs[0]!.motors.aft!.spec.designation).toBe('C6'); // the row's own motor
  });

  it('still produces a configuration to point at when the design has no mounts', () => {
    const noMounts = { components: [node({ type: 'bodytube', id: 'body' })] } as unknown as RocketTree;
    const w = migrateWorkspace(v1({ tree: noMounts }))!;
    expect(w.configs).toHaveLength(1);
    expect(w.configs[0]!.motors).toEqual({});
    expect(w.sims[0]!.configId).toBe(w.configs[0]!.id);
  });
});

/**
 * A stored design can hold a rail button or centering ring whose linked
 * dimensions disagree. Loading holds them as the kernel builds them, so the panel shows
 * what flies, and a result flown from the stored design stays current.
 */
describe('migrateWorkspace linked dimensions', () => {
  const stored = (parts: object[]) =>
    ({
      version: 3,
      tree: {
        components: [
          node({
            type: 'stage',
            id: 's',
            children: [node({ type: 'bodytube', id: 'b', outerRadius: 0.03, children: parts.map(node) })],
          }),
        ],
      },
      sims: [{ id: 'a', name: 'A', configId: 'c1', launch: {}, result: null }],
      configs: [{ id: 'c1', name: null, motors: {} }],
      activeId: 'a',
      loadedMeta: null,
    }) as unknown as Workspace;
  const part = (w: Workspace | null, id: string) =>
    (w!.tree.components[0]!.children![0]!.children as ComponentNode[]).find((n) => n.id === id)!;

  it('settles a rail button and a fixed ring the way the bridge builds them', () => {
    const w = migrateWorkspace(
      stored([
        {
          type: 'railbutton',
          id: 'rb',
          outerDiameter: 0.006,
          innerDiameter: 0.008,
          height: 0.01,
          baseHeight: 0.009,
          flangeHeight: 0.002,
        },
        { type: 'centeringring', id: 'cr', outerRadius: 0.01, innerRadius: 0.015 },
      ]),
    );
    expect(part(w, 'rb')).toMatchObject({ innerDiameter: 0.006, height: 0.01, baseHeight: 0.009 });
    expect(part(w, 'rb')['flangeHeight']).toBeCloseTo(0.001, 15);
    expect(part(w, 'cr')).toMatchObject({ outerRadius: 0.015, innerRadius: 0.015 });
  });

  it('leaves an automatic ring outer radius to follow the bore, as the kernel does', () => {
    const w = stored([
      { type: 'centeringring', id: 'cr', outerRadiusAuto: true, outerRadius: 0.01, innerRadius: 0.015 },
    ]);
    expect(migrateWorkspace(w)).toBe(w);
  });

  it('returns a consistent workspace as the same object', () => {
    const w = stored([
      { type: 'railbutton', id: 'rb', outerDiameter: 0.01, height: 0.003, baseHeight: 0, flangeHeight: 0 },
      { type: 'centeringring', id: 'cr', outerRadius: 0.02, innerRadius: 0.01 },
    ]);
    expect(migrateWorkspace(w)).toBe(w);
  });

  it('keys the settled design as the stored one, so its results do not age', () => {
    const w = stored([{ type: 'railbutton', id: 'rb', height: 0.01, baseHeight: 0.009, flangeHeight: 0.002 }]);
    const settled = migrateWorkspace(w)!;
    expect(settled.tree).not.toBe(w.tree);
    expect(flightKey(settled.tree)).toBe(flightKey(w.tree));
  });
});
