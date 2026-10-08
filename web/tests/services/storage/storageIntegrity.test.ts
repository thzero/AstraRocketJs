import { STORAGE_PREFIX, nsKey } from '../../../src/services/storage/storageKeys';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDbKeyValueStore, __resetIdbForTests } from '../../../src/services/storage/idbKeyValueStore';
import { DesignLibrary } from '../../../src/services/storage/designLibrary';
import { KeyValueMaterialStore } from '../../../src/services/materials/materialStore';
import { KeyValueTemplateStore } from '../../../src/services/exports/templateStore';
import type { KeyValueStore } from '../../../src/services/storage/keyValueStore';
import type { Workspace } from '../../../src/services/storage/workspaceStore';
import type { FlightResult } from '../../../src/engine/openRocketEngine';
import 'fake-indexeddb/auto';

/**
 * The storage tier's shared failure mode: silent data loss.
 *
 * Each case here looks fine from the outside: a refused write resolves cleanly,
 * a stale copy shadows a newer one, an index loses an entry to a concurrent tab,
 * a delete leaves the library pointing at bytes that are gone. Nothing throws,
 * nothing warns; the user finds out a session later.
 *
 * These tests assert the observable contract rather than the mechanism: what
 * comes back out after a write that storage refused, and what survives two
 * writers.
 */

/** A fallback store that can be told to refuse writes, like a full quota. */
class FakeLocal implements KeyValueStore {
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
  async update(k: string, fn: (raw: string | null) => string | null) {
    const next = fn(await this.get(k));
    if (next === null) {
      await this.remove(k);
      return true;
    }
    return await this.set(k, next);
  }
}

beforeEach(async () => {
  await __resetIdbForTests();
  indexedDB.deleteDatabase(STORAGE_PREFIX);
});

/** Make IndexedDB writes fail while reads keep working, as a full quota does. */
async function withFailingWrites<T>(fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- saved to patch the prototype; called back with .call(this, ...)
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function put() {
    throw new Error('QuotaExceededError');
  } as unknown as typeof realPut;
  try {
    return await fn();
  } finally {
    IDBObjectStore.prototype.put = realPut;
  }
}

describe('a save refused by IndexedDB is not shadowed by the stale copy', () => {
  it('serves the newer fallback value, not the older IndexedDB one', async () => {
    const fallback = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(fallback);

    expect(await kv.set('k', 'v1')).toBe(true);
    expect(await kv.get('k')).toBe('v1');

    // The quota case: the write transaction aborts, reads keep working.
    await withFailingWrites(async () => {
      expect(await kv.set('k', 'v2')).toBe(true); // the fallback took it
    });
    expect(fallback.map.get('k')).toBe('v2');

    // Reading IndexedDB first would hand back 'v1': the save lost, with every
    // layer above reporting success.
    expect(await kv.get('k')).toBe('v2');
  });

  it('does not resurrect the stale value in a later session', async () => {
    const fallback = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(fallback);
    await kv.set('k', 'v1');
    await withFailingWrites(async () => {
      await kv.set('k', 'v2');
    });

    // A fresh instance has no memory of the fallback, so the stale IndexedDB
    // entry has to be gone from the store itself.
    expect(await new IndexedDbKeyValueStore(fallback).get('k')).toBe('v2');
  });

  it('reports failure when BOTH tiers refuse, rather than claiming success', async () => {
    const fallback = new FakeLocal();
    fallback.full = true;
    const kv = new IndexedDbKeyValueStore(fallback);
    await withFailingWrites(async () => {
      expect(await kv.set('k', 'v')).toBe(false);
    });
  });
});

describe('the design index survives two concurrent writers', () => {
  it('keeps both designs when two tabs save at the same time', async () => {
    // Two libraries over the same IndexedDB is what two tabs are.
    const a = new DesignLibrary(new IndexedDbKeyValueStore());
    const b = new DesignLibrary(new IndexedDbKeyValueStore());

    await Promise.all([a.write('A', 'Alpha', ws()), b.write('B', 'Bravo', ws())]);

    const ids = (await a.list()).map((m) => m.id).sort();
    // Read-modify-write through a plain get/set loses one of these: both read
    // the empty index, then each writes its own single entry over the other.
    expect(ids).toEqual(['A', 'B']);
  });

  it('keeps concurrent renames from dropping each other', async () => {
    const lib = new DesignLibrary(new IndexedDbKeyValueStore());
    await lib.write('A', 'Alpha', ws());
    await lib.write('B', 'Bravo', ws());

    const other = new DesignLibrary(new IndexedDbKeyValueStore());
    await Promise.all([lib.rename('A', 'Alpha2'), other.rename('B', 'Bravo2')]);

    const byId = Object.fromEntries((await lib.list()).map((m) => [m.id, m.name]));
    expect(byId).toEqual({ A: 'Alpha2', B: 'Bravo2' });
  });
});

describe('deleting a design never leaves the library pointing at nothing', () => {
  it('removes the index entry before the bytes, and says so', async () => {
    const kv = new FakeLocal();
    const lib = new DesignLibrary(kv);
    await lib.write('A', 'Alpha', ws());
    expect(await lib.remove('A')).toBe(true);
    expect(await lib.list()).toEqual([]);
  });

  it('deletes NOTHING when the index write is refused', async () => {
    const kv = new FakeLocal();
    const lib = new DesignLibrary(kv);
    await lib.write('A', 'Alpha', ws());

    kv.full = true;
    expect(await lib.remove('A')).toBe(false);

    // Deleting the blob first would let a refused index write leave the library
    // listing a design whose bytes are gone: activeId() returns it, read()
    // returns null, and the app opens on `unreadable-design`.
    kv.full = false;
    expect((await lib.list()).map((m) => m.id)).toEqual(['A']);
    expect(await lib.read('A')).not.toBeNull();
  });
});

describe('a refused write is reported, not swallowed', () => {
  it('setActive and rename both report refusal', async () => {
    const kv = new FakeLocal();
    const lib = new DesignLibrary(kv);
    await lib.write('A', 'Alpha', ws());

    kv.full = true;
    expect(await lib.setActive('A')).toBe(false);
    expect(await lib.rename('A', 'Renamed')).toBe(false);
  });
});

describe('stored flight results are shape-checked before they are trusted', () => {
  const good = (): FlightResult =>
    ({
      summary: {
        maxAltitude: 120,
        maxVelocity: 60,
        maxAcceleration: 90,
        maxMachNumber: 0.18,
        timeToApogee: 4.5,
        flightTime: 30,
        groundHitVelocity: 5,
        launchRodVelocity: 18,
        deploymentVelocity: null,
        optimumDelay: null,
      },
      events: [],
      series: { time: [0, 1], altitude: [0, 1], velocity: [0, 1], acceleration: [0, 1] },
    }) as unknown as FlightResult;

  const readBack = async (stored: unknown) => {
    const kv = new FakeLocal();
    kv.map.set(nsKey('designs:A:results'), JSON.stringify(stored));
    return await new DesignLibrary(kv).readResults('A');
  };

  it('keeps a well-formed result', async () => {
    expect(Object.keys(await readBack({ s1: good() }))).toEqual(['s1']);
  });

  it('drops a result whose summary went through JSON as null', async () => {
    // NaN and Infinity serialize to null, so a summary number comes back null
    // and the first `.toFixed()` on it throws in the middle of an export.
    const nan = good();
    (nan.summary as unknown as Record<string, unknown>)['maxVelocity'] = NaN;
    expect(await readBack({ s1: nan })).toEqual({});
  });

  it('drops a result from a different build shape, keeping the good ones', async () => {
    expect(Object.keys(await readBack({ s1: good(), s2: { series: {} }, s3: 'nonsense' }))).toEqual(['s1']);
  });

  it('reads a non-object blob as no results at all', async () => {
    expect(await readBack([1, 2, 3])).toEqual({});
    expect(await readBack('nope')).toEqual({});
  });
});

const ws = (): Workspace =>
  ({
    version: 1,
    tree: { components: [{ id: 'n1', name: 'R' }] },
    sims: [{ id: 's1', name: 'Simulation 1', result: null }],
    activeId: 's1',
    loadedMeta: null,
  }) as unknown as Workspace;

/**
 * The material and template stores, like the motor store, must not swallow a
 * refused write: `kv.set` reports refusal by returning false, and a store that
 * discards it lets the dialog await the save, get a clean resolve, and re-render
 * a list without the thing the user just added.
 */
describe('custom material and template writes report a refused write', () => {
  it('throws storage-full instead of resolving cleanly', async () => {
    const kv = new FakeLocal();
    const materials = new KeyValueMaterialStore('mat', kv);
    const templates = new KeyValueTemplateStore('tpl', kv);

    const material = { name: 'Balsa', type: 'bulk', density: 170, custom: true } as never;
    const template = { id: 't1', name: 'T', ext: 'kml', source: '{{x}}' } as never;
    await materials.add(material);
    await templates.add(template);
    expect(await materials.list()).toHaveLength(1);

    kv.full = true;
    await expect(materials.add({ ...(material as object), name: 'Ply' } as never)).rejects.toThrow('storage-full');
    await expect(materials.remove('Balsa', 'bulk' as never)).rejects.toThrow('storage-full');
    await expect(templates.add({ ...(template as object), id: 't2' } as never)).rejects.toThrow('storage-full');
    await expect(templates.remove('t1')).rejects.toThrow('storage-full');
  });
});
