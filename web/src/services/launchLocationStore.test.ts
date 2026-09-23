import { describe, it, expect, beforeEach } from 'vitest';
import { KeyValueLaunchLocationStore, locationFrom, type LaunchLocation } from './launchLocationStore';
import type { KeyValueStore } from './keyValueStore';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  /** Set to make every write fail, the way a full or blocked store does. */
  refuse = false;
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async set(k: string, v: string) {
    if (this.refuse) return false;
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

const KEY = 'locations';
const location = (over: Partial<LaunchLocation> = {}): LaunchLocation => ({
  id: 'p1',
  name: 'Home field',
  latitudeDeg: 39.05,
  longitudeDeg: -104.8,
  launchAltitudeM: 1830,
  ...over,
});

let kv: FakeKv;
let store: KeyValueLaunchLocationStore;
beforeEach(() => {
  kv = new FakeKv();
  store = new KeyValueLaunchLocationStore(KEY, kv);
});

describe('KeyValueLaunchLocationStore', () => {
  it('saves and lists a location', async () => {
    await store.save(location());
    expect(await store.list()).toEqual([location()]);
  });

  it('puts the most recently saved location first', async () => {
    await store.save(location({ id: 'a', name: 'A' }));
    await store.save(location({ id: 'b', name: 'B' }));
    expect((await store.list()).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('replaces by id, not by name', async () => {
    // A rename is a save of the same location, and two fields can legitimately share
    // a name ("Club field") while being different places.
    await store.save(location({ id: 'a', name: 'Old name' }));
    await store.save(location({ id: 'a', name: 'New name' }));
    await store.save(location({ id: 'b', name: 'New name', latitudeDeg: 1 }));
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.id === 'a')!.name).toBe('New name');
    expect(list.find((p) => p.id === 'b')!.latitudeDeg).toBe(1);
  });

  it('removes by id', async () => {
    await store.save(location({ id: 'a' }));
    await store.save(location({ id: 'b' }));
    await store.remove('a');
    expect((await store.list()).map((p) => p.id)).toEqual(['b']);
  });

  it('reports a refused write instead of resolving over it', async () => {
    // The caller holds the only copy of what the user just typed. Told nothing,
    // it re-renders a list that does not contain it and there is no error
    // anywhere — the failure `materialStore` was fixed for.
    kv.refuse = true;
    await expect(store.save(location())).rejects.toThrow(/storage-full/);
  });

  it('survives an absent or corrupt blob', async () => {
    expect(await store.list()).toEqual([]);
    await kv.set(KEY, 'not json');
    expect(await store.list()).toEqual([]);
    await kv.set(KEY, '{"not":"an array"}');
    expect(await store.list()).toEqual([]);
  });

  it('drops entries that are not locations, and keeps the ones that are', async () => {
    // Hand-edited storage, an older schema, or a half-written blob: one bad
    // entry must not cost the user every location they saved.
    await kv.set(KEY, JSON.stringify([location({ id: 'good' }), { id: 'bad', name: 'No coordinates' }, null, 7]));
    expect((await store.list()).map((p) => p.id)).toEqual(['good']);
  });

  it('refuses coordinates outside the ranges the launch fields enforce', async () => {
    // A latitude past ±90 reaches the kernel's gravity and Coriolis terms AND
    // the KML origin, which Google Earth rejects outright.
    for (const bad of [
      { latitudeDeg: 91 },
      { latitudeDeg: -91 },
      { longitudeDeg: 181 },
      { launchAltitudeM: 20000 },
      { launchAltitudeM: -600 },
      { latitudeDeg: Number.NaN },
      { name: 123 as unknown as string, latitudeDeg: 0 },
    ]) {
      await expect(store.save(location(bad as Partial<LaunchLocation>)), JSON.stringify(bad)).rejects.toThrow(
        /invalid-location/,
      );
    }
    expect(await store.list()).toEqual([]);
  });
});

describe('locationFrom', () => {
  it('takes the three site fields and mints an id', () => {
    const p = locationFrom('  Field  ', { latitudeDeg: 12.5, longitudeDeg: -1.25, launchAltitudeM: 300 });
    expect(p.name).toBe('Field'); // trimmed
    expect(p.id).toMatch(/[0-9a-f-]{8,}/);
    expect(p).toMatchObject({ latitudeDeg: 12.5, longitudeDeg: -1.25, launchAltitudeM: 300 });
  });

  it('still produces a complete location from a half-filled site', () => {
    // A `LaunchLocation` is a PLACE, so every field has to be a number. The zeroes are a
    // last resort rather than a default: both coordinates are required launch
    // fields and `LocationPicker` disables its save button while either is blank,
    // so a location at 0,0 is not reachable from the panel. Altitude genuinely does
    // default to sea level, which is a real answer for a coastal field.
    const p = locationFrom('Bare', { latitudeDeg: null, longitudeDeg: null, launchAltitudeM: null });
    expect(p).toMatchObject({ latitudeDeg: 0, longitudeDeg: 0, launchAltitudeM: 0 });
  });
});
