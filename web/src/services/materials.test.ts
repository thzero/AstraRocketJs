import { describe, it, expect, beforeEach } from 'vitest';
import { builtinsForType, addCustom, removeCustom, materialsForType, findMaterial } from './materials';
import { KeyValueMaterialStore, setMaterialStore } from './materialStore';
import type { KeyValueStore } from './keyValueStore';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  async set(k: string, v: string) { this.map.set(k, v); }
  async remove(k: string) { this.map.delete(k); }
}

// Fresh in-memory material store per test (avoids cross-test bleed via the singleton).
beforeEach(() => setMaterialStore(new KeyValueMaterialStore('astrarrocketjs:materials:custom', new FakeKv())));

describe('builtinsForType', () => {
  it('returns only built-ins of the requested type', () => {
    const bulk = builtinsForType('bulk');
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
  it('lists custom materials before built-ins', async () => {
    await addCustom('ZZZ Custom', 'bulk', 999);
    const list = await materialsForType('bulk');
    expect(list[0]!.name).toBe('ZZZ Custom'); // custom first regardless of alpha
    expect(list.length).toBeGreaterThan(1);
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
