// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveSettings, loadSettings, DEFAULT_SETTINGS } from '../../../src/services/storage/settings';
import { KeyValueMotorStore, type CustomMotor } from '../../../src/services/motors/motorStore';
import type { KeyValueStore } from '../../../src/services/storage/keyValueStore';
import { scaleNode } from '../../../src/tree/scaleRocket';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * The small ones, each a thing that failed quietly.
 *
 * None of these is dramatic on its own. What they share is that the failure left
 * no trace: a refused write that resolved cleanly, a quadratic import that merely
 * felt slow, a scaled node that shared an array with the node it came from. A
 * silent failure is the kind that gets found by an audit rather than by a user.
 */

describe('saveSettings reports a refused write', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true on an ordinary write', () => {
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(true);
  });

  it('returns false rather than swallowing a quota failure', () => {
    // The bare `catch {}` this replaces meant the panel showed the new value for
    // the rest of the session and the next session came up with the old one.
    // Spied on `Storage.prototype`, where jsdom defines it: assigning to the
    // instance does not shadow it.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });

  it('still round-trips what it did store', () => {
    const next = { ...DEFAULT_SETTINGS, simulation: { ...DEFAULT_SETTINGS.simulation, maxTime: 123 } };
    expect(saveSettings(next)).toBe(true);
    expect(loadSettings().simulation.maxTime).toBe(123);
  });
});

describe('a custom-motor import is ONE write', () => {
  /** Every field `isCustomMotor` requires, so a stored row survives the read back. */
  const motor = (id: string): CustomMotor =>
    ({
      id,
      manufacturer: 'M',
      designation: id,
      class: 'C',
      diameter: 0.018,
      length: 0.07,
      totalWeightG: 20,
      propWeightG: 10,
      samples: [
        { time: 0, thrust: 0 },
        { time: 0.1, thrust: 10 },
        { time: 0.2, thrust: 0 },
      ],
      source: 'eng',
    }) as unknown as CustomMotor;

  /** A key-value store that counts the atomic read-modify-writes it is asked for. */
  const countingKv = () => {
    let value: string | null = null;
    let updates = 0;
    const kv: KeyValueStore = {
      get: async () => value,
      set: async (_key, v) => {
        value = v;
        return true;
      },
      remove: async () => {
        value = null;
      },
      update: async (_key, fn) => {
        updates++;
        value = fn(value);
        return true;
      },
    };
    return { kv, updates: () => updates };
  };

  it('stores a whole engine range in ONE read-modify-write', async () => {
    // The quadratic shape this replaces: one `kv.update` per motor, each parsing
    // and re-serializing the entire stored array. A `.rse` engine database is a
    // manufacturer's whole range, so that is hundreds of round trips through the
    // same JSON.
    const { kv, updates } = countingKv();
    const store = new KeyValueMotorStore(kv);
    await store.addCustomMotors([motor('A'), motor('B'), motor('C'), motor('D')]);
    expect(updates()).toBe(1);
    // Newest first, which is the order repeated single adds produced: each one
    // prepended, so A then B then C then D left D at the front. The batch reverses
    // itself to keep that, rather than quietly changing the order of the list the
    // picker shows.
    expect((await store.listCustomMotors()).map((m) => m.id)).toEqual(['D', 'C', 'B', 'A']);
  });

  it('is all-or-nothing, so a refused write stores no part of the batch', async () => {
    const { kv } = countingKv();
    const refusing: KeyValueStore = { ...kv, update: async () => false };
    const store = new KeyValueMotorStore(refusing);
    await expect(store.addCustomMotors([motor('A'), motor('B')])).rejects.toThrow(/storage-full/);
    expect(await store.listCustomMotors()).toEqual([]);
  });

  it('replaces by id within the batch and against what is stored', async () => {
    const { kv } = countingKv();
    const store = new KeyValueMotorStore(kv);
    await store.addCustomMotors([motor('A'), motor('B')]);
    await store.addCustomMotors([{ ...motor('B'), designation: 'B2' }, motor('C')]);
    const ids = (await store.listCustomMotors()).map((m) => m.id);
    expect([...ids].sort()).toEqual(['A', 'B', 'C']);
    expect((await store.listCustomMotors()).find((m) => m.id === 'B')?.designation).toBe('B2');
  });

  it('writes nothing at all for an empty batch', async () => {
    const { kv, updates } = countingKv();
    await new KeyValueMotorStore(kv).addCustomMotors([]);
    expect(updates()).toBe(0);
  });

  it('routes a single add through the same batch path', async () => {
    const { kv, updates } = countingKv();
    const store = new KeyValueMotorStore(kv);
    await store.addCustomMotor(motor('A'));
    expect(updates()).toBe(1);
    expect((await store.listCustomMotors()).map((m) => m.id)).toEqual(['A']);
  });
});

describe('scaleNode does not alias the node it scaled', () => {
  const node = (o: object): ComponentNode => o as unknown as ComponentNode;

  it('leaves children to the caller instead of sharing the array', () => {
    const kids = [node({ type: 'bodytube', id: 'b', length: 0.3 })];
    const parent = node({ type: 'stage', id: 's', children: kids });
    const scaled = scaleNode(parent, 2);
    // Not a shared reference, and not a stale copy either: absent, which is what
    // the function's own doc says ("Children are handled by the caller").
    expect(scaled.children).toBeUndefined();
  });

  it('copies a point row it cannot scale rather than passing it through', () => {
    const malformed = ['x', 'y'];
    const fin = node({ type: 'freeformfinset', id: 'f', points: [[0, 0], malformed, [0.05, 0]] });
    const scaled = scaleNode(fin, 2);
    const pts = scaled['points'] as unknown[];
    expect(pts[1]).toEqual(malformed); // same content: a row we cannot read is left alone
    expect(pts[1]).not.toBe(malformed); // different array: no shared mutable state
  });

  it('still scales the rows it CAN read', () => {
    const fin = node({
      type: 'freeformfinset',
      id: 'f',
      points: [
        [0, 0],
        [0.05, 0.03],
      ],
    });
    expect(scaleNode(fin, 2)['points']).toEqual([
      [0, 0],
      [0.1, 0.06],
    ]);
  });
});

describe('the traced fin image is bounded', () => {
  /** A solid dark rectangle `w` x `h`, which traces to a rectangular fin. */
  const block = (w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4).fill(0),
  });

  it('traces a small image at full resolution', async () => {
    const { finPointsFromImage } = await import('../../../src/services/design/finImage');
    const pts = finPointsFromImage(block(40, 30));
    expect(pts.length).toBeGreaterThanOrEqual(3);
    // One pixel is one millimeter: upstream's fixed scale.
    const maxX = Math.max(...pts.map((p) => p[0]));
    expect(maxX).toBeGreaterThan(0.03);
  });

  it('traces a photograph-sized image at the SAME size, just coarser', async () => {
    // The point of scaling the points back by the reduction factor: a bounded
    // trace must not change the figure the Scale fin step works from.
    const { finPointsFromImage } = await import('../../../src/services/design/finImage');
    const big = finPointsFromImage(block(4000, 300));
    const maxX = Math.max(...big.map((p) => p[0]));
    // 4000 px is 4 m, within the rounding of an integer reduction factor.
    expect(maxX).toBeGreaterThan(3.5);
    expect(maxX).toBeLessThan(4.1);
  });

  it('finishes a photograph-sized trace promptly', async () => {
    const { finPointsFromImage } = await import('../../../src/services/design/finImage');
    const started = Date.now();
    finPointsFromImage(block(4000, 3000));
    // Generous, because this is a timing assertion on shared CI. The unbounded
    // version was a triply nested scan over a fourteen-thousand-point perimeter.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('still finds a root on a height that is not a multiple of the reduction', async () => {
    // The regression a plain stride would have introduced: with a 300-pixel image
    // reduced by 4, a stride samples rows 0, 4 ... 296, so a fin touching only
    // rows 297 to 299 reads as not touching the bottom edge - a valid image
    // refused with the message for an invalid one. The mapping includes both
    // endpoints, so the reduced bottom row IS the source bottom row.
    const { finPointsFromImage } = await import('../../../src/services/design/finImage');
    const w = 4000;
    const h = 4003; // deliberately shares no factor with any stride this will pick
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    // Dark only in the bottom three rows, and only across part of the width.
    for (let y = h - 3; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
      }
    }
    expect(() => finPointsFromImage({ width: w, height: h, data })).not.toThrow();
  });

  it('reads a channel past the end of the array as background, not as fin', async () => {
    const { finPointsFromImage, FinImageError } = await import('../../../src/services/design/finImage');
    // `data` far too short for the stated size. `?? 0` is pure black, which is
    // FIN, so this used to invent an outline out of bytes that are not there.
    const truncated = { width: 20, height: 20, data: new Uint8ClampedArray(8).fill(0) };
    expect(() => finPointsFromImage(truncated)).toThrow(FinImageError);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
