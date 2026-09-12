import { describe, it, expect, beforeEach } from 'vitest';
import { DesignLibrary } from './designLibrary';
import type { KeyValueStore } from './keyValueStore';
import type { Workspace } from './workspaceStore';

class FakeKv implements KeyValueStore {
  readonly map = new Map<string, string>();
  full = false;
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    if (this.full) return false;
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    this.map.delete(k);
  }
}

const ws = (name: string, loadedName?: string): Workspace =>
  ({
    version: 1,
    tree: { components: [{ id: 'n1', name }] },
    sims: [{ id: 's1', name: 'Simulation 1', result: null }],
    activeId: 's1',
    extraMotors: {},
    loadedMeta: loadedName ? { name: loadedName, notes: [], exportMotors: {} } : null,
  }) as unknown as Workspace;

const treeName = (w: Workspace | null) =>
  (w?.tree as unknown as { components: { name: string }[] } | undefined)?.components[0]?.name;

let kv: FakeKv;
let lib: DesignLibrary;
beforeEach(() => {
  kv = new FakeKv();
  lib = new DesignLibrary(kv);
});

describe('design library', () => {
  it('starts empty', async () => {
    expect(await lib.list()).toEqual([]);
    expect(await lib.activeId()).toBeNull();
  });

  it('creates, reads back, and makes the new design active', async () => {
    const meta = await lib.create('Big Bertha', ws('bertha'));
    expect(meta.name).toBe('Big Bertha');
    expect(await lib.activeId()).toBe(meta.id);
    expect(treeName(await lib.read(meta.id))).toBe('bertha');
  });

  it('keeps designs independent — saving one does not touch another', async () => {
    const a = await lib.create('A', ws('a'));
    const b = await lib.create('B', ws('b'));
    await lib.write(b.id, 'B', ws('b-edited'));

    expect(treeName(await lib.read(a.id))).toBe('a');
    expect(treeName(await lib.read(b.id))).toBe('b-edited');
  });

  it('lists most recently updated first', async () => {
    const a = await lib.create('A', ws('a'));
    await lib.create('B', ws('b'));
    await lib.write(a.id, 'A', ws('a2')); // touching A floats it to the top

    expect((await lib.list()).map((m) => m.name)).toEqual(['A', 'B']);
  });

  it('renames without disturbing the design', async () => {
    const a = await lib.create('Old', ws('a'));
    await lib.rename(a.id, 'New');
    expect((await lib.list())[0]!.name).toBe('New');
    expect(treeName(await lib.read(a.id))).toBe('a');
  });

  it('removes a design and its index entry', async () => {
    const a = await lib.create('A', ws('a'));
    await lib.remove(a.id);
    expect(await lib.list()).toEqual([]);
    expect(await lib.read(a.id)).toBeNull();
  });

  it('does not leave the active id pointing at a deleted design', async () => {
    const a = await lib.create('A', ws('a'));
    await lib.remove(a.id);
    // Otherwise the app opens a workspace it cannot save back to.
    expect(await lib.activeId()).toBeNull();
  });

  it('ignores an active id whose design is gone from the index', async () => {
    await lib.create('A', ws('a'));
    kv.map.set('astrarrocketjs:designs:active', 'ghost');
    expect(await lib.activeId()).toBeNull();
  });

  it('reports a refused write rather than pretending it saved', async () => {
    const a = await lib.create('A', ws('a'));
    kv.full = true;
    expect(await lib.write(a.id, 'A', ws('a2'))).toBe(false);
  });

  it('survives a corrupt index without losing addressable designs', async () => {
    const a = await lib.create('A', ws('a'));
    kv.map.set('astrarrocketjs:designs:index', '{not json');
    expect(await lib.list()).toEqual([]);
    expect(treeName(await lib.read(a.id))).toBe('a');
  });
});

describe('migrating the pre-library single workspace', () => {
  const LEGACY = 'astrarrocketjs:workspace';

  it('adopts an existing workspace as the first design and opens it', async () => {
    kv.map.set(LEGACY, JSON.stringify(ws('existing-work')));

    const list = await lib.list();
    expect(list).toHaveLength(1);
    // The user's one design must survive the upgrade.
    expect(treeName(await lib.read(list[0]!.id))).toBe('existing-work');
    expect(await lib.activeId()).toBe(list[0]!.id);
    // And the old key is reclaimed once it is safely copied.
    expect(kv.map.has(LEGACY)).toBe(false);
  });

  it('names the migrated design after the .ork it came from', async () => {
    kv.map.set(LEGACY, JSON.stringify(ws('x', 'Fireball ZL1')));
    expect((await lib.list())[0]!.name).toBe('Fireball ZL1');
  });

  it('falls back to a default name for a design with no .ork origin', async () => {
    kv.map.set(LEGACY, JSON.stringify(ws('x')));
    expect((await lib.list())[0]!.name).toBe('My Rocket');
  });

  it('keeps the legacy blob if the migrating write fails', async () => {
    kv.map.set(LEGACY, JSON.stringify(ws('precious')));
    kv.full = true;
    await lib.list();
    expect(kv.map.get(LEGACY)).toBeTruthy();
  });

  it('does not re-seed a library the user has emptied', async () => {
    kv.map.set(LEGACY, JSON.stringify(ws('old')));
    const a = await lib.create('A', ws('a')); // library now exists
    await lib.remove(a.id);

    // A fresh instance must not resurrect the legacy design into the empty library.
    expect(await new DesignLibrary(kv).list()).toEqual([]);
  });

  it('runs at most once per instance', async () => {
    kv.map.set(LEGACY, JSON.stringify(ws('one')));
    await Promise.all([lib.list(), lib.list(), lib.list()]);
    expect(await lib.list()).toHaveLength(1);
  });
});
