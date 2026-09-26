import { describe, it, expect, vi, afterEach } from 'vitest';
import { samplesToMotorSpec, fetchMotorSpec, isCachedMotorSpec } from '../../src/services/thrustcurve';
import type { CatalogMotor } from '../../src/services/motorDb';
import { getMotorStore } from '../../src/services/motorStore';

// samplesToMotorSpec's TcMotor param is module-internal; build a shaped literal.
const motor = (over: Record<string, unknown> = {}) =>
  ({
    motorId: 'x',
    designation: 'C6',
    commonName: 'C6',
    manufacturerAbbrev: 'Estes',
    diameter: 18, // mm
    length: 70, // mm
    totalWeightG: 20,
    propWeightG: 10,
    availability: 'regular',
    ...over,
  }) as never;

describe('samplesToMotorSpec', () => {
  it('converts mm→m and sets cg at half length', () => {
    const spec = samplesToMotorSpec(
      motor(),
      [
        { time: 0, thrust: 10 },
        { time: 1, thrust: 10 },
      ],
      5,
    );
    expect(spec.diameter).toBeCloseTo(0.018, 9);
    expect(spec.length).toBeCloseTo(0.07, 9);
    expect(spec.cgX).toBeCloseTo(0.035, 9);
    expect(spec.ejectionDelay).toBe(5);
    expect(spec.manufacturer).toBe('Estes');
  });

  it('interpolates mass from loaded down to burnout proportional to cumulative impulse', () => {
    const spec = samplesToMotorSpec(
      motor(),
      [
        { time: 0, thrust: 10 },
        { time: 1, thrust: 10 },
      ],
      0,
    );
    expect(spec.masses[0]).toBeCloseTo(0.02, 9); // loaded mass
    expect(spec.masses[spec.masses.length - 1]).toBeCloseTo(0.01, 9); // loaded − prop
  });

  it('prepends a {0,0} sample when the curve does not start at t=0', () => {
    const spec = samplesToMotorSpec(
      motor(),
      [
        { time: 0.5, thrust: 10 },
        { time: 1, thrust: 10 },
      ],
      0,
    );
    expect(spec.times[0]).toBe(0);
    expect(spec.thrusts[0]).toBe(0);
    expect(spec.times).toHaveLength(3);
  });

  it('sorts unordered samples by time', () => {
    const spec = samplesToMotorSpec(
      motor(),
      [
        { time: 1, thrust: 10 },
        { time: 0, thrust: 0 },
      ],
      0,
    );
    expect(spec.times).toEqual([0, 1]);
  });

  it('keeps mass constant when total impulse is zero', () => {
    const spec = samplesToMotorSpec(
      motor(),
      [
        { time: 0, thrust: 0 },
        { time: 1, thrust: 0 },
      ],
      0,
    );
    expect(spec.masses.every((m) => Math.abs(m - 0.02) < 1e-12)).toBe(true);
  });

  it('throws with no samples', () => {
    expect(() => samplesToMotorSpec(motor(), [], 0)).toThrow(/no thrust samples/i);
  });

  it('throws on non-finite catalog weights (guards a TeaVM BigInt crash)', () => {
    expect(() =>
      samplesToMotorSpec(
        motor({ totalWeightG: NaN }),
        [
          { time: 0, thrust: 1 },
          { time: 1, thrust: 1 },
        ],
        0,
      ),
    ).toThrow(/no loaded\/propellant weight/i);
  });

  it('throws when propellant exceeds loaded mass (negative burnout mass)', () => {
    expect(() =>
      samplesToMotorSpec(
        motor({ totalWeightG: 10, propWeightG: 20 }),
        [
          { time: 0, thrust: 1 },
          { time: 1, thrust: 1 },
        ],
        0,
      ),
    ).toThrow(/more propellant/i);
  });
});

describe('fetchMotorSpec — bundled catalog motor (offline path)', () => {
  const bundled = {
    designation: 'C6',
    manufacturer: 'Estes',
    class: 'C',
    diameter: 18,
    impulse: 8.8,
    burn: 1,
    mass: 24,
    length: 70,
    propWeightG: 10,
    curves: [
      {
        src: 'Certified · RASP',
        samples: [
          [0, 0],
          [0.5, 20],
          [1, 0],
        ],
      },
    ],
  } as unknown as CatalogMotor;

  it('builds a MotorSpec entirely from bundled data — no thrustcurve.org fetch', async () => {
    const spec = await fetchMotorSpec(bundled, 5);
    expect(spec.designation).toBe('C6');
    expect(spec.diameter).toBeCloseTo(0.018, 9); // mm → m
    expect(spec.length).toBeCloseTo(0.07, 9);
    expect(spec.ejectionDelay).toBe(5);
    expect(spec.times[0]).toBe(0);
    expect(spec.thrusts).toContain(20);
    expect(spec.curveSrc).toBe('Certified · RASP');
  });

  it('builds from the selected curve index and records its source', async () => {
    const multi = {
      designation: 'X',
      manufacturer: 'Y',
      class: 'C',
      diameter: 18,
      impulse: 10,
      burn: 1,
      mass: 20,
      length: 70,
      propWeightG: 10,
      curves: [
        {
          src: 'Certified · RASP',
          samples: [
            [0, 0],
            [1, 10],
          ],
        },
        {
          src: 'User · RockSim',
          samples: [
            [0, 0],
            [0.5, 40],
            [1, 0],
          ],
        },
      ],
    } as unknown as CatalogMotor;

    const first = await fetchMotorSpec(multi, 0, 0);
    expect(first.curveSrc).toBe('Certified · RASP');
    expect(first.thrusts).toContain(10);

    const second = await fetchMotorSpec(multi, 0, 1);
    expect(second.curveSrc).toBe('User · RockSim');
    expect(second.thrusts).toContain(40);
  });
});

/**
 * The FRESH network path must run the same validator the cache read does.
 *
 * `fetchSamplesCached` checked the cached branch with `isSampleArray` and
 * returned the downloaded array unchecked. A garbled or hostile
 * `download.json` carrying a null time therefore went straight into
 * `samplesToMotorSpec`: cumulative impulse NaN, nulls through times and
 * masses, and the whole array across the TeaVM boundary, where it surfaces as
 * the opaque "cannot be converted to a BigInt" blank design this module
 * already documents.
 */
describe('fetchMotorSpec - malformed thrustcurve.org response', () => {
  // No `curves`, so the bundled offline path is skipped and the motor resolves
  // over the network.
  const online = {
    designation: 'K550',
    manufacturer: 'AeroTech',
    class: 'K',
    diameter: 54,
    impulse: 1600,
    burn: 3,
    mass: 1200,
    length: 410,
    propWeightG: 700,
  } as unknown as CatalogMotor;

  const stubApi = (samples: unknown) => {
    const json = (body: unknown) =>
      Promise.resolve({ ok: true, headers: { get: () => null }, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', (url: string) =>
      String(url).includes('search.json')
        ? json({
            results: [
              {
                motorId: 'k550',
                designation: 'K550',
                commonName: 'K550',
                manufacturerAbbrev: 'AeroTech',
                diameter: 54,
                length: 410,
                totalWeightG: 1200,
                propWeightG: 700,
                availability: 'regular',
              },
            ],
          })
        : json({ results: [{ format: 'RASP', samples }] }),
    );
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a curve with a non-numeric time instead of feeding it to the kernel', async () => {
    stubApi([
      { time: null, thrust: 5 },
      { time: 1, thrust: 10 },
    ]);
    await expect(fetchMotorSpec(online, 0)).rejects.toThrow(/malformed/i);
  });

  it('rejects a curve carrying NaN or Infinity', async () => {
    stubApi([
      { time: 0, thrust: 0 },
      { time: Number.POSITIVE_INFINITY, thrust: 10 },
    ]);
    await expect(fetchMotorSpec(online, 0)).rejects.toThrow(/malformed/i);
  });

  it('still accepts a well-formed curve', async () => {
    stubApi([
      { time: 0, thrust: 0 },
      { time: 1, thrust: 600 },
      { time: 3, thrust: 0 },
    ]);
    const spec = await fetchMotorSpec(online, 0);
    expect(spec.designation).toBe('K550');
    expect(spec.times.every(Number.isFinite)).toBe(true);
    expect(spec.thrusts.every(Number.isFinite)).toBe(true);
  });
});

/**
 * The search.json hit is validated BEFORE it is picked, cached or requested.
 *
 * The network `TcMotor[]` was used with no shape check at all; only the cache
 * READ looked for `.motorId`. A hit without one was therefore written to the
 * cache as the motor's metadata and then requested from download.json as
 * `motorIds: [undefined]`, and whatever came back was built into a spec.
 */
describe('fetchMotorSpec - search.json hit without a motorId', () => {
  // A motor nothing else in this file resolves, so no cached entry from an
  // earlier case can satisfy the lookup.
  const online = {
    designation: 'H999',
    manufacturer: 'Nobody',
    class: 'H',
    diameter: 29,
    impulse: 300,
    burn: 2,
    mass: 200,
  } as unknown as CatalogMotor;

  const hit = {
    designation: 'H999',
    commonName: 'H999',
    manufacturerAbbrev: 'Nobody',
    diameter: 29,
    length: 200,
    totalWeightG: 200,
    propWeightG: 100,
    availability: 'regular',
  };

  const stubApi = (results: unknown) => {
    const seen: string[] = [];
    const json = (body: unknown) =>
      Promise.resolve({ ok: true, headers: { get: () => null }, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', (url: string) => {
      seen.push(String(url));
      return String(url).includes('search.json')
        ? json({ results })
        : json({
            results: [
              {
                format: 'RASP',
                samples: [
                  { time: 0, thrust: 0 },
                  { time: 1, thrust: 300 },
                  { time: 2, thrust: 0 },
                ],
              },
            ],
          });
    });
    return seen;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is neither cached nor requested from download.json', async () => {
    const seen = stubApi([hit]); // no motorId
    const write = vi.spyOn(getMotorStore(), 'writeEntry');

    await expect(fetchMotorSpec(online, 0)).rejects.toThrow(/could not find/i);
    expect(seen.some((u) => u.includes('download.json'))).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips the bad hit and uses a well-formed one beside it', async () => {
    stubApi([
      { ...hit, motorId: 7 },
      { ...hit, motorId: 'h999-ok' },
      { ...hit, diameter: 'wide', motorId: 'x' },
    ]);
    const write = vi.spyOn(getMotorStore(), 'writeEntry');

    const spec = await fetchMotorSpec(online, 0);
    expect(spec.designation).toBe('H999');
    const meta = write.mock.calls.find(([key]) => key.includes(':meta:'));
    expect((meta?.[1] as { motorId?: unknown })?.motorId).toBe('h999-ok');
  });
});

/**
 * The cache-read validator for a stored MotorSpec checked only that the three
 * arrays were non-empty, while the curve validator beside it checked every
 * sample was finite. A spec whose arrays had been serialized with a null (JSON
 * has no NaN or Infinity) passed the length check and went straight back into
 * the kernel, the BigInt crash the sample guard exists to prevent.
 */
describe('isCachedMotorSpec', () => {
  const good = {
    designation: 'C6',
    diameter: 0.018,
    length: 0.07,
    times: [0, 1, 2],
    thrusts: [0, 10, 0],
    masses: [0.02, 0.015, 0.01],
    cgX: 0.035,
    ejectionDelay: 5,
  };

  it('accepts a spec with three finite, equal-length arrays', () => {
    expect(isCachedMotorSpec(good)).toBe(true);
  });

  it('rejects a null, NaN or Infinity in ANY of the three arrays', () => {
    expect(isCachedMotorSpec({ ...good, times: [0, null, 2] })).toBe(false);
    expect(isCachedMotorSpec({ ...good, thrusts: [0, Number.NaN, 0] })).toBe(false);
    expect(isCachedMotorSpec({ ...good, masses: [0.02, Number.POSITIVE_INFINITY, 0.01] })).toBe(false);
  });

  it('rejects arrays of different lengths, an empty array, and non-objects', () => {
    expect(isCachedMotorSpec({ ...good, masses: [0.02, 0.01] })).toBe(false);
    expect(isCachedMotorSpec({ ...good, times: [] })).toBe(false);
    expect(isCachedMotorSpec(null)).toBe(false);
    expect(isCachedMotorSpec('C6')).toBe(false);
  });
});

/**
 * The timeout error used to be constructed bare, so the abort that caused it
 * was gone: a bug report showed only the friendly text.
 */
describe('post timeout keeps its cause', () => {
  const online = {
    designation: 'J350',
    manufacturer: 'AeroTech',
    class: 'J',
    diameter: 54,
    impulse: 700,
    burn: 2,
    mass: 700,
    length: 300,
    propWeightG: 350,
  } as unknown as CatalogMotor;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('attaches the abort as the error cause', async () => {
    vi.useFakeTimers();
    // A host that never answers: the promise settles only when the signal fires.
    vi.stubGlobal(
      'fetch',
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = fetchMotorSpec(online, 0);
    const outcome = pending.then(
      () => 'resolved',
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(6_000);
    const err = (await outcome) as Error & { cause?: unknown };
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/timed out/);
    expect(err.cause).toBeInstanceOf(DOMException);
    expect((err.cause as DOMException).name).toBe('AbortError');
  });
});
