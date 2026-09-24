import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { builtinsForType, addCustom, removeCustom, materialsForType, findMaterial } from './materials';
import { KeyValueMaterialStore, setMaterialStore } from './materialStore';
import type { KeyValueStore } from './keyValueStore';
import { serveData } from '../testing/serveData';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async set(k: string, v: string) {
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

// The built-in catalog is a runtime file; serve the real one off disk.
beforeAll(serveData);

// Fresh in-memory material store per test (avoids cross-test bleed via the singleton).
beforeEach(() => setMaterialStore(new KeyValueMaterialStore('astrarrocketjs:materials:custom', new FakeKv())));

describe('builtinsForType', () => {
  it('returns only built-ins of the requested type', async () => {
    const bulk = await builtinsForType('bulk');
    expect(bulk.length).toBeGreaterThan(0);
    expect(bulk.every((m) => m.type === 'bulk')).toBe(true);
  });
});

describe('addCustom validation', () => {
  it('rejects a blank name', async () => {
    await expect(addCustom('   ', 'bulk', 500)).rejects.toThrow(/name/i);
  });

  it('rejects non-positive / non-finite density', async () => {
    await expect(addCustom('X', 'bulk', 0)).rejects.toThrow(/density/i);
    await expect(addCustom('X', 'bulk', -5)).rejects.toThrow(/density/i);
    await expect(addCustom('X', 'bulk', Number.NaN)).rejects.toThrow(/density/i);
  });

  it('trims the name and stores the material', async () => {
    const list = await addCustom('  Custom Balsa  ', 'bulk', 160);
    expect(list.some((m) => m.name === 'Custom Balsa')).toBe(true);
  });
});

describe('materialsForType / findMaterial', () => {
  it('lists a custom material inside a real group, not above everything', async () => {
    // It used to be `[...custom, ...builtins]`, which put every custom material
    // at the top under a `Custom` group of its own. The provenance is the star
    // the picker draws, not the material's place in the list. See
    // `materialsMerge.test.ts` for the rule itself.
    await addCustom('ZZZ Custom', 'bulk', 999, 'Woods');
    const list = await materialsForType('bulk');
    const added = list.find((m) => m.name === 'ZZZ Custom');
    expect(added?.group).toBe('Woods');
    expect(added?.custom).toBe(true);
    expect(list[0]!.name).not.toBe('ZZZ Custom');
    expect(list.length).toBeGreaterThan(1);
  });

  it('a custom material named after a built-in replaces it rather than doubling it', async () => {
    await addCustom('Balsa', 'bulk', 185);
    const list = await materialsForType('bulk');
    expect(list.filter((m) => m.name === 'Balsa')).toHaveLength(1);
    expect(list.find((m) => m.name === 'Balsa')!.density).toBe(185);
    expect(list.find((m) => m.name === 'Balsa')!.group).toBe('Woods');
  });

  it('finds a material by name+type across custom and built-ins', async () => {
    await addCustom('Findable', 'bulk', 500);
    expect((await findMaterial('Findable', 'bulk'))?.density).toBe(500);
    expect(await findMaterial('Nope', 'bulk')).toBeUndefined();
  });

  it('removeCustom drops the material', async () => {
    await addCustom('Temp', 'bulk', 500);
    const after = await removeCustom('Temp', 'bulk');
    expect(after.some((m) => m.name === 'Temp')).toBe(false);
  });
});
