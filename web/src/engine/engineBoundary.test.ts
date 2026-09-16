import { describe, it, expect, beforeAll } from 'vitest';
import { __setEngineForTests, OpenRocketDesign, type MotorSpec, type RocketTree } from './openRocketEngine';

/**
 * The REAL kernel, not a stub.
 *
 * Every other test in this directory stubs the engine and asserts what the
 * facade hands it — the right seam for marshalling, and useless for the thing
 * these tests cover: what the Java does when handed something bad. The
 * `parsed.error` checks on the JS side were dead code for four accessors,
 * because only `simulateJson` ever produced an `{"error": ...}` envelope;
 * everything else threw out of TeaVM as an opaque JS exception from inside a
 * 2.9 MB bundle, so `JSON.parse` never ran and the branch was unreachable.
 *
 * Loading the vendored module directly (rather than through `initEngine`, which
 * wants a browser) keeps this a plain node test.
 */
type Engine = typeof import('./vendor/openrocket-engine.mjs');
let engine: Engine;

const TREE = {
  components: [
    {
      id: 'stage1',
      type: 'stage',
      children: [
        { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.013, thickness: 0.001, shape: 'ogive' },
        {
          id: 'tube',
          type: 'bodytube',
          length: 0.2,
          outerRadius: 0.013,
          thickness: 0.0005,
          motorMount: true,
          children: [
            {
              id: 'fins',
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.06,
              tipChord: 0.03,
              sweep: 0.03,
              height: 0.05,
              thickness: 0.003,
            },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

const C6 = {
  designation: 'C6',
  diameter: 0.018,
  length: 0.07,
  cgX: 0.035,
  ejectionDelay: 5,
  times: [0, 0.5, 1.0, 1.5, 1.86],
  thrusts: [0, 12, 5, 4.5, 0],
  masses: [0.0242, 0.021, 0.017, 0.013, 0.0108],
} as unknown as MotorSpec;

beforeAll(async () => {
  engine = await import('./vendor/openrocket-engine.mjs');
  __setEngineForTests(engine);
});

const build = () => OpenRocketDesign.buildTree(TREE);

describe('the kernel is actually wired up', () => {
  it('builds a rocket and reports plausible static info', () => {
    const info = build().staticInfo();
    expect(info.length).toBeCloseTo(0.3, 6);
    expect(info.cg).toBeGreaterThan(0);
    expect(info.cp).toBeGreaterThan(0);
  });
});

describe('error envelopes, from the Java side', () => {
  /**
   * `reset()` used to do `nextHandle = 1`, so handle ids were REUSED. The web
   * app calls `resetEngine()` before every rebuild and `buildRocket` registers
   * exactly one object — so the new design got handle 1, the same number a
   * design held from before the rebuild still carried, and that stale object
   * silently returned results for the NEW rocket. The counter no longer
   * rewinds, so a freed handle stays permanently unknown.
   */
  it('a design held across a reset fails loudly instead of aliasing the next rocket', () => {
    const stale = build();
    expect(stale.staticInfo().length).toBeCloseTo(0.3, 6);

    engine.reset();
    const fresh = build();
    expect(fresh.staticInfo().length).toBeCloseTo(0.3, 6);

    // Before: this returned `fresh`'s numbers with no error whatsoever.
    expect(() => stale.staticInfo()).toThrow(/handle/i);
  });

  it('reports an unknown component id as a message, not an opaque throw', () => {
    expect(() => build().componentInfo('no-such-component')).toThrow(/no-such-component|not found|unknown/i);
  });

  it('refuses an unbounded aero sweep instead of exhausting the heap', () => {
    // {"machMax":1e9} built a List<Double> of 2e10 entries: the tab died with
    // no recoverable error. Only machStep was ever guarded.
    expect(() => build().aeroSweep({ machMin: 0, machMax: 1e9, machStep: 0.05 })).toThrow(/sweep|point/i);
    expect(() => build().aeroSweep({ machMin: 2, machMax: 1 })).toThrow(/machMin|sweep/i);
    // Infinity cannot even reach the kernel — JSON.stringify turns it into
    // null, so JsonLite takes the default. Recorded because it looks like a
    // hole and is not one; the finite guard covers a value that DOES arrive.
    expect(JSON.stringify({ machMax: Infinity })).toBe('{"machMax":null}');
  });

  it('still runs a sane sweep', () => {
    const sweep = build().aeroSweep({ machMin: 0.1, machMax: 0.3, machStep: 0.1 });
    expect(sweep.machs.length).toBeGreaterThan(1);
    expect(sweep.machs.every((m) => Number.isFinite(m))).toBe(true);
  });
});

describe('motor validation at the boundary', () => {
  it('accepts a well-formed motor', () => {
    const d = build();
    expect(() => d.setMotorById('tube', C6)).not.toThrow();
    expect(d.simulate({ launchRodLength: 1 }).summary.maxAltitude).toBeGreaterThan(0);
  });

  /**
   * `applyMotor` sized `cgPoints` from `times.length` then indexed `masses[i]`
   * unchecked — a short array threw ArrayIndexOutOfBounds out of TeaVM with no
   * envelope. The JS wrapper's `assertFiniteCurve` guards finiteness, but it
   * lives in the wrapper: anything calling the export directly bypassed it.
   */
  it('rejects mismatched curve arrays with a message naming the motor', () => {
    expect(() =>
      engine.setMotorById(
        engine.buildRocket(JSON.stringify(TREE)),
        'tube',
        'BAD',
        0.018,
        0.07,
        [0, 1, 2],
        [0, 50, 0],
        [0.1, 0.05], // one short
        0.035,
        5,
      ),
    ).toThrow(/BAD/);
  });

  it('rejects a non-positive diameter or length', () => {
    const h = engine.buildRocket(JSON.stringify(TREE));
    expect(() => engine.setMotorById(h, 'tube', 'BAD', 0, 0.07, [0, 1], [0, 5], [0.1, 0.05], 0.035, 5)).toThrow(/BAD/);
  });

  it('rejects times that run backwards', () => {
    const h = engine.buildRocket(JSON.stringify(TREE));
    expect(() =>
      engine.setMotorById(h, 'tube', 'BAD', 0.018, 0.07, [0, 2, 1], [0, 5, 0], [0.1, 0.08, 0.05], 0.035, 5),
    ).toThrow(/BAD/);
  });
});

describe('the 7-argument simulate() overload', () => {
  it('returns an error envelope for a non-finite option rather than a JSON parse failure', () => {
    // These are concatenated straight into JSON; NaN emitted `"windAverage":NaN`,
    // which JsonLite rejected with an IllegalArgumentException that
    // simulateJson's `catch (SimulationException)` did not cover.
    const h = engine.buildRocket(JSON.stringify(TREE));
    engine.setMotorById(h, 'tube', 'C6', 0.018, 0.07, C6.times, C6.thrusts, C6.masses, 0.035, 5);
    const raw = engine.simulate(h, 1, 0, Number.NaN, 0, 0, 0.05);
    const parsed = JSON.parse(raw) as { error?: string };
    expect(parsed.error).toMatch(/finite/i);
  });
});
