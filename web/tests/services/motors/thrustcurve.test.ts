import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { samplesToMotorSpec, fetchMotorSpec, isCachedMotorSpec } from '../../../src/services/motors/thrustcurve';
import { PLUGGED_DELAY } from '../../../src/engine/openRocketEngine';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';
import { getMotorStore, KeyValueMotorStore, setMotorStore } from '../../../src/services/motors/motorStore';
import type { KeyValueStore } from '../../../src/services/storage/keyValueStore';

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
    ).toThrow(expect.objectContaining({ key: 'errors.thrustcurve.noWeight', values: { motor: 'C6' } }));
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

describe('samplesToMotorSpec refuses what ThrustCurveMotor.Builder.build() refuses', () => {
  it('a negative thrust sample', () => {
    expect(() =>
      samplesToMotorSpec(
        motor(),
        [
          { time: 0, thrust: 0 },
          { time: 0.5, thrust: -3 },
          { time: 1, thrust: 0 },
        ],
        0,
      ),
    ).toThrow(expect.objectContaining({ key: 'errors.thrustcurve.negativeThrust', values: { motor: 'C6' } }));
  });

  it('a launch CG outside [0, length]', () => {
    const samples = [
      { time: 0, thrust: 1 },
      { time: 1, thrust: 1 },
    ];
    for (const cg of [-0.001, 0.071]) {
      expect(() => samplesToMotorSpec(motor(), samples, 0, [[0, cg]])).toThrow(
        expect.objectContaining({ key: 'errors.thrustcurve.badCg', values: { motor: 'C6', length: 70 } }),
      );
    }
    expect(samplesToMotorSpec(motor(), samples, 0, [[0, 0.07]]).cgX).toBe(0.07);
  });
});

describe('fetchMotorSpec: bundled catalog motor (offline path)', () => {
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

  it('builds a MotorSpec entirely from bundled data: no thrustcurve.org fetch', async () => {
    const spec = await fetchMotorSpec(bundled, 5);
    expect(spec.designation).toBe('C6');
    expect(spec.diameter).toBeCloseTo(0.018, 9); // mm → m
    expect(spec.length).toBeCloseTo(0.07, 9);
    expect(spec.ejectionDelay).toBe(5);
    expect(spec.times[0]).toBe(0);
    expect(spec.thrusts).toContain(20);
    expect(spec.curveSrc).toBe('Certified · RASP');
  });

  it('carries the full designation for display, keeping the common name the kernel and .ork match on', async () => {
    const spec = await fetchMotorSpec({ ...bundled, designation: 'F67', code: 'F67W' } as CatalogMotor, 9);
    expect(spec.designation).toBe('F67');
    expect(spec.code).toBe('F67W');
  });

  it('adds no full designation that only repeats the common name', async () => {
    const spec = await fetchMotorSpec({ ...bundled, code: 'C6' } as CatalogMotor, 5);
    expect(spec.code).toBeUndefined();
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
 * The fresh network path must run the same validator the cache read does.
 *
 * `fetchSamplesCached` checks the cached branch with `isSampleArray`, and the
 * downloaded array needs the same check. Unchecked, a garbled or hostile
 * `download.json` carrying a null time goes straight into
 * `samplesToMotorSpec`: cumulative impulse NaN, nulls through times and
 * masses, and the whole array across the TeaVM boundary, where it surfaces as
 * the opaque "cannot be converted to a BigInt" blank design.
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

/** A download.json answer whose `results` is not an array reads as no data. */
describe('fetchMotorSpec - download.json results not an array', () => {
  const online = {
    designation: 'J777',
    manufacturer: 'Nobody',
    class: 'J',
    diameter: 38,
    impulse: 900,
    burn: 2,
    mass: 600,
    length: 300,
    propWeightG: 400,
  } as unknown as CatalogMotor;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws the keyed no-data error instead of a TypeError', async () => {
    const json = (body: unknown) =>
      Promise.resolve({ ok: true, headers: { get: () => null }, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', (url: string) =>
      String(url).includes('search.json')
        ? json({
            results: [
              {
                motorId: 'j777',
                designation: 'J777',
                commonName: 'J777',
                manufacturerAbbrev: 'Nobody',
                diameter: 38,
                length: 300,
                totalWeightG: 600,
                propWeightG: 400,
                availability: 'regular',
              },
            ],
          })
        : json({ results: { format: 'RASP' } }),
    );
    await expect(fetchMotorSpec(online, 0)).rejects.toThrow(/No thrust-curve data/);
  });
});

/**
 * A reply that parses but is not the documented shape is reported with the
 * keyed bad-data message, the same as a malformed curve, rather than as the
 * browser's English TypeError from reading a property off null.
 */
describe('fetchMotorSpec - null thrustcurve.org reply', () => {
  const online = {
    designation: 'J350',
    manufacturer: 'Nobody',
    class: 'J',
    diameter: 38,
    impulse: 700,
    burn: 2,
    mass: 600,
    length: 300,
    propWeightG: 400,
  } as unknown as CatalogMotor;
  const hit = {
    motorId: 'j350',
    designation: 'J350',
    commonName: 'J350',
    manufacturerAbbrev: 'Nobody',
    diameter: 38,
    length: 300,
    totalWeightG: 600,
    propWeightG: 400,
    availability: 'regular',
  };
  const stub = (search: unknown, download: unknown) => {
    const json = (body: unknown) =>
      Promise.resolve({ ok: true, headers: { get: () => null }, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', (url: string) => json(String(url).includes('search.json') ? search : download));
  };
  const keyOf = async () =>
    ((await fetchMotorSpec(online, 0).catch((e: unknown) => e)) as Error & { key?: string }).key;

  afterEach(() => vi.unstubAllGlobals());

  it('a null search.json body', async () => {
    stub(null, null);
    expect(await keyOf()).toBe('errors.thrustcurve.badData');
  });

  it('a null download.json body', async () => {
    stub({ results: [hit] }, null);
    expect(await keyOf()).toBe('errors.thrustcurve.badData');
  });

  it('a null element in download.json results is skipped', async () => {
    stub({ results: [hit] }, { results: [null] });
    expect(await keyOf()).toBe('errors.thrustcurve.noData');
  });
});

/**
 * The search.json hit is validated before it is picked, cached or requested.
 *
 * Without a shape check on the network `TcMotor[]`, a hit with no `.motorId`
 * would be written to the cache as the motor's metadata and then requested from
 * download.json as `motorIds: [undefined]`, and whatever came back would be
 * built into a spec.
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
 * A catalog can list one maker's motor under one common name in two diameters
 * (a 29 mm and a 38 mm case of the same propellant load), or under two codes.
 * They are different motors, with their own thrustcurve records, and each
 * caches under its own key, so the second pick is not served the first's
 * length, masses and curve for the life of the cache.
 */
describe('fetchMotorSpec caches each catalog row apart', () => {
  const kv = new Map<string, string>();
  const memory: KeyValueStore = {
    get: (k) => Promise.resolve(kv.get(k) ?? null),
    set: (k, v) => Promise.resolve(!!kv.set(k, v)),
    remove: (k) => Promise.resolve(void kv.delete(k)),
    update: (k, fn) => {
      const next = fn(kv.get(k) ?? null);
      if (next === null) kv.delete(k);
      else kv.set(k, next);
      return Promise.resolve(true);
    },
  };
  const row = (diameter: number, code?: string) =>
    ({
      designation: 'K550',
      manufacturer: 'Nobody',
      class: 'K',
      diameter,
      impulse: 1500,
      burn: 3,
      mass: 1000,
      ...(code ? { code } : {}),
    }) as CatalogMotor;
  // Two thrustcurve records, told apart by diameter, as search.json returns them.
  const record = (diameter: number) => ({
    motorId: `k550-${diameter}`,
    designation: 'K550',
    commonName: 'K550',
    manufacturerAbbrev: 'Nobody',
    diameter,
    length: diameter * 10,
    totalWeightG: 1000,
    propWeightG: 500,
    availability: 'regular',
  });

  beforeEach(() => {
    kv.clear();
    setMotorStore(new KeyValueMotorStore(memory));
    const json = (body: unknown) =>
      Promise.resolve({ ok: true, headers: { get: () => null }, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', (url: string) =>
      String(url).includes('search.json')
        ? json({ results: [record(29), record(38)] })
        : json({
            results: [
              {
                format: 'RASP',
                samples: [
                  { time: 0, thrust: 0 },
                  { time: 1, thrust: 500 },
                  { time: 3, thrust: 0 },
                ],
              },
            ],
          }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setMotorStore(new KeyValueMotorStore());
  });

  it('serves each diameter its own motor after the other is cached', async () => {
    const narrow = await fetchMotorSpec(row(29), 0);
    const wide = await fetchMotorSpec(row(38), 0);
    expect(narrow.diameter).toBeCloseTo(29 / 1000, 12);
    expect(narrow.length).toBeCloseTo(290 / 1000, 12);
    expect(wide.diameter).toBeCloseTo(38 / 1000, 12);
    expect(wide.length).toBeCloseTo(380 / 1000, 12);
    // And the repeat pick of each still comes from the cache, not the network.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect((await fetchMotorSpec(row(38), 0)).length).toBeCloseTo(380 / 1000, 12);
    expect((await fetchMotorSpec(row(29), 0)).length).toBeCloseTo(290 / 1000, 12);
  });

  it('keeps two codes of one common name under separate keys', async () => {
    await fetchMotorSpec(row(38, 'K550W'), 0);
    const afterFirst = [...kv.keys()];
    await fetchMotorSpec(row(38, 'K550X'), 0);
    const added = [...kv.keys()].filter((k) => !afterFirst.includes(k));
    // A second motor record and a second spec, not a hit on the first's.
    expect(added.filter((k) => k.includes(':meta:'))).toHaveLength(1);
    expect(added.filter((k) => k.includes(':motor:'))).toHaveLength(1);
  });
});

/**
 * The cache-read validator for a stored MotorSpec checks that every sample is
 * finite, as the curve validator beside it does, not only that the three arrays
 * are non-empty. A spec whose arrays were serialized with a null (JSON has no
 * NaN or Infinity) would otherwise pass a length check and go straight back into
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

  it('rejects a one-sample curve, which the builder and the Run button refuse', () => {
    // hasUsableCurve wants MIN_CURVE_SAMPLES (2). Serving a one-sample spec from
    // the cache only moves the refusal to Run, as "no motor".
    expect(isCachedMotorSpec({ ...good, times: [0], thrusts: [10], masses: [0.02] })).toBe(false);
  });

  it('rejects arrays of different lengths, an empty array, and non-objects', () => {
    expect(isCachedMotorSpec({ ...good, masses: [0.02, 0.01] })).toBe(false);
    expect(isCachedMotorSpec({ ...good, times: [] })).toBe(false);
    expect(isCachedMotorSpec(null)).toBe(false);
    expect(isCachedMotorSpec('C6')).toBe(false);
  });

  it('rejects a spec samplesToMotorSpec could not have built', () => {
    // Each would otherwise be served from the cache and fail the build with a
    // raw kernel message instead of being refetched.
    expect(isCachedMotorSpec({ ...good, thrusts: [0, -1, 0] })).toBe(false);
    expect(isCachedMotorSpec({ ...good, diameter: 0 })).toBe(false);
    expect(isCachedMotorSpec({ ...good, length: Number.NaN })).toBe(false);
    expect(isCachedMotorSpec({ ...good, cgX: 0.08 })).toBe(false);
    expect(isCachedMotorSpec({ ...good, cgX: -0.01 })).toBe(false);
    expect(isCachedMotorSpec({ ...good, cgX: undefined })).toBe(false);
    expect(isCachedMotorSpec({ ...good, ejectionDelay: null })).toBe(false);
    expect(isCachedMotorSpec({ ...good, ejectionDelay: -2 })).toBe(false);
    // A plugged motor's stored delay is a number like any other.
    expect(isCachedMotorSpec({ ...good, ejectionDelay: PLUGGED_DELAY })).toBe(true);
  });
});

/**
 * A bare timeout error loses the abort that caused it, leaving a bug report with
 * only the friendly text.
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

/**
 * An error reply is abandoned the moment its status is read, the way
 * remoteData.fetchJson does it: left open, a 5xx error page keeps streaming
 * until the body timer fires. And it is still reported as the HTTP error it
 * is, not as a timeout, although the request was aborted on the way out.
 */
describe('post on an error reply', () => {
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

  afterEach(() => vi.unstubAllGlobals());

  it('aborts the request and reports the status', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal;
      return Promise.resolve(new Response('<html>busy</html>', { status: 503 }));
    });
    await expect(fetchMotorSpec(online, 0)).rejects.toThrow(/HTTP 503/);
    expect(signal?.aborted).toBe(true);
  });
});

/**
 * A failed request is reported in the app's language. The browser's own text
 * for a refused connection ("Failed to fetch") or a reply that is not JSON is
 * English whatever the app shows.
 */
describe('post on a network or parse failure', () => {
  const online = {
    designation: 'K185',
    manufacturer: 'AeroTech',
    class: 'K',
    diameter: 54,
    impulse: 1400,
    burn: 7,
    mass: 900,
    length: 400,
    propWeightG: 500,
  } as unknown as CatalogMotor;

  afterEach(() => vi.unstubAllGlobals());

  it('keys a refused connection as a network failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const err = (await fetchMotorSpec(online, 0).catch((e: unknown) => e)) as Error & { key?: string; cause?: unknown };
    expect(err.key).toBe('errors.remote.network');
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it('keys a reply that is not JSON as a bad shape', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>not json</html>', { status: 200 })));
    const err = (await fetchMotorSpec(online, 0).catch((e: unknown) => e)) as Error & { key?: string };
    expect(err.key).toBe('errors.remote.badShape');
  });
});
