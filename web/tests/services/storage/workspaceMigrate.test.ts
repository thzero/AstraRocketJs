import { describe, it, expect } from 'vitest';
import { migrateWorkspace } from '../../../src/services/storage/workspaceMigrate';
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

  it('refuses a version this build does not know, rather than half-reading it', () => {
    // An installed PWA can have an older build cached, so a NEWER workspace is a
    // live possibility. Reading it as far as it parses would overwrite the user's
    // design with a partial copy of itself.
    expect(migrateWorkspace({ ...v1(), version: 3 })).toBeNull();
  });

  it('keeps a version-2 workspace as it is', () => {
    const w2 = {
      version: 2,
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
    expect(w.version).toBe(2);
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
