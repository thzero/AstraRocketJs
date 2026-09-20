import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyValueMotorStore, type CustomMotor } from './motorStore';
import type { KeyValueStore } from './keyValueStore';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  full = false;
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
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

const custom = (id: string): CustomMotor => ({
  id,
  designation: 'X',
  manufacturer: 'Me',
  class: 'C',
  diameter: 18,
  length: 70,
  totalWeightG: 20,
  propWeightG: 10,
  samples: [
    { time: 0, thrust: 1 },
    { time: 1, thrust: 0 },
  ],
  source: 'eng',
});

let kv: FakeKv;
let store: KeyValueMotorStore;
beforeEach(() => {
  kv = new FakeKv();
  store = new KeyValueMotorStore(kv, 1000);
});
afterEach(() => vi.useRealTimers());

describe('per-entry TTL freshness', () => {
  it('marks entries fresh within the TTL and stale past it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    await store.writeEntry('m:1', { spec: 1 });

    vi.setSystemTime(500);
    const fresh = await store.readEntry<{ spec: number }>('m:1', () => true);
    expect(fresh).toEqual({ value: { spec: 1 }, stale: false });

    vi.setSystemTime(2000); // now − t = 2000 > ttl 1000
    const stale = await store.readEntry<{ spec: number }>('m:1', () => true);
    expect(stale!.stale).toBe(true);
  });

  it('drops and returns null for a malformed envelope or invalid value', async () => {
    await kv.set('m:2', JSON.stringify({ v: { spec: 1 } })); // no timestamp
    expect(await store.readEntry('m:2', () => true)).toBeNull();
    expect(kv.map.has('m:2')).toBe(false); // evicted

    await kv.set('m:3', JSON.stringify({ t: 0, v: { spec: 1 } }));
    expect(await store.readEntry('m:3', () => false)).toBeNull(); // fails validator
    expect(kv.map.has('m:3')).toBe(false);
  });

  it('returns null for a missing key', async () => {
    expect(await store.readEntry('absent', () => true)).toBeNull();
  });
});

describe('custom motors', () => {
  it('adds newest-first and de-dupes by id', async () => {
    await store.addCustomMotor(custom('a'));
    await store.addCustomMotor(custom('b'));
    await store.addCustomMotor(custom('a')); // replace, not duplicate
    const list = await store.listCustomMotors();
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('removes by id', async () => {
    await store.addCustomMotor(custom('a'));
    await store.removeCustomMotor('a');
    expect(await store.listCustomMotors()).toEqual([]);
  });

  it('filters out invalid custom-motor rows', async () => {
    await kv.set(
      'astrarrocketjs:motors:custom',
      JSON.stringify([custom('ok'), { id: 'bad' }, { designation: 'no-id' }]),
    );
    const list = await store.listCustomMotors();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('ok');
  });
});

describe('custom motors report refused writes', () => {
  // `kv.set` REPORTS failure by returning false rather than throwing, and the
  // boolean was discarded — so MotorDialog awaited the import, got a clean
  // resolve, and re-rendered a catalog that simply did not contain the motor.
  it('throws when an import cannot be stored', async () => {
    const kv = new FakeKv();
    const store = new KeyValueMotorStore(kv, 1000);
    kv.full = true;
    await expect(store.addCustomMotor(custom('m1'))).rejects.toThrow(/storage-full/);
  });

  it('throws when a removal cannot be stored', async () => {
    const kv = new FakeKv();
    const store = new KeyValueMotorStore(kv, 1000);
    await store.addCustomMotor(custom('m1'));
    kv.full = true;
    await expect(store.removeCustomMotor('m1')).rejects.toThrow(/storage-full/);
  });
});

/**
 * Custom motors are the one store whose payload reaches `simulate()` without a
 * second gate, so what `isCustomMotor` lets through is what the kernel gets.
 */
describe('isCustomMotor rejects what would reach the kernel broken', () => {
  const good = () => ({
    id: 'custom:Test:A1',
    designation: 'A1',
    manufacturer: 'Test',
    class: 'A',
    diameter: 18,
    length: 70,
    totalWeightG: 24,
    propWeightG: 12,
    samples: [
      { time: 0, thrust: 0 },
      { time: 1, thrust: 10 },
    ],
    source: 'eng',
  });

  const survives = async (motor: unknown) => {
    const fresh = new FakeKv();
    await fresh.set('astrarrocketjs:motors:custom', JSON.stringify([motor]));
    return (await new KeyValueMotorStore(fresh).listCustomMotors()).length;
  };

  it('keeps a well-formed motor', async () => {
    expect(await survives(good())).toBe(1);
  });

  it('drops a sample that is not a {time, thrust} pair', async () => {
    // `samples: [{}]` became `times: [undefined]` and NaN masses in the kernel.
    expect(await survives({ ...good(), samples: [{}] })).toBe(0);
    expect(await survives({ ...good(), samples: [null] })).toBe(0);
    expect(await survives({ ...good(), samples: [[0, 1]] })).toBe(0);
  });

  it('drops a sample whose time or thrust is null', async () => {
    // Written as NaN/Infinity by whatever produced the blob; JSON.stringify
    // turns both into null on the way to storage, so null is what the store
    // actually reads back. `typeof null === 'object'`, so the OLD per-field
    // checks would have caught these — what did not catch them is that the old
    // isCustomMotor never looked inside `samples` at all.
    expect(await survives({ ...good(), samples: [{ time: 0, thrust: null }] })).toBe(0);
    expect(await survives({ ...good(), samples: [{ time: null, thrust: 1 }] })).toBe(0);
    expect(await survives({ ...good(), samples: [{ time: 0 }] })).toBe(0);
  });

  it('drops a row with no class — motorDb sorts on it and would throw', async () => {
    const { class: _drop, ...noClass } = good();
    expect(await survives(noClass)).toBe(0);
  });

  it('drops a row with no manufacturer', async () => {
    const { manufacturer: _drop, ...noMfr } = good();
    expect(await survives(noMfr)).toBe(0);
  });

  it('drops a dimension or weight that is absent, null or not a number', async () => {
    // NOT tested with NaN: JSON.stringify writes it as null, so a NaN can never
    // be read back out of the store — the same reason engineBoundary.test.ts
    // records that Infinity cannot reach the kernel. These three CAN arrive.
    for (const k of ['diameter', 'length', 'totalWeightG', 'propWeightG'] as const) {
      expect(await survives({ ...good(), [k]: null }), `${k}=null`).toBe(0);
      expect(await survives({ ...good(), [k]: '18' }), `${k}="18"`).toBe(0);
      const { [k]: _drop, ...missing } = good();
      expect(await survives(missing), `${k} absent`).toBe(0);
    }
  });
});
