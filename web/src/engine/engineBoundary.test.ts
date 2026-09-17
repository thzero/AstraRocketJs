import { describe, it, expect, beforeAll, vi } from 'vitest';
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
/**
 * The only file in the suite that runs REAL physics, so the only one the 5 s
 * default does not fit. `beforeAll` loads the 2.9 MB TeaVM bundle, and the
 * "accepts a well-formed motor" case flies a whole trajectory through it: about
 * 1 s on an idle machine, but 5.5-11.7 s under `--coverage` with the suite's
 * other 82 files running beside it — measured, three runs out of three.
 *
 * Scoped to this file on purpose. A global bump would slacken 854 tests that
 * have no business taking seconds, and hide the thing a timeout is for.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

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

/**
 * Non-finite aero is reported, not rewritten as a plausible number.
 *
 * `getAeroSweep` ran every per-component CD, CNα and CP through `zeroIfNaN`
 * before accumulating, so a component whose reading went NaN contributed 0 —
 * and 0 is a LEGITIMATE answer here: a part that makes no normal force reads 0
 * and means it. The swallowed NaN was indistinguishable from it, so the
 * breakdown silently stopped summing to the rocket totals beside it.
 */
describe('the aero sweep does not fabricate zeros', () => {
  it('counts the non-finite readings it met, and a healthy sweep meets none', () => {
    const sweep = build().aeroSweep({ machMin: 0.1, machMax: 0.4, machStep: 0.1 }) as unknown as {
      nonFinite?: number;
      components: { cd: (number | null)[] }[];
    };
    // The field exists (an older kernel omits it) and this design is clean.
    expect(sweep.nonFinite).toBe(0);
    expect(sweep.components.length).toBeGreaterThan(0);
  });

  it('emits every per-component cell as a finite number for a sane design', () => {
    const sweep = build().aeroSweep({ machMin: 0.1, machMax: 0.4, machStep: 0.1 });
    for (const c of sweep.components) {
      for (const v of c.cd) {
        // Not `toBeCloseTo(0)`: the point is that a real reading arrives as a
        // number. A null here would mean the kernel could not compute it.
        expect(Number.isFinite(v), `${c.name} cd`).toBe(true);
      }
    }
  });

  it('sums the component CDs back to the rocket total — the invariant a swallowed NaN broke', () => {
    const sweep = build().aeroSweep({ machMin: 0.2, machMax: 0.2, machStep: 0.1 });
    const parts = sweep.components.reduce((a, c) => a + (c.cd[0] ?? 0), 0);
    expect(parts).toBeCloseTo(sweep.powerOff.total[0]!, 6);
  });
});

/**
 * Mass rows come back in TREE order, deterministically.
 *
 * `getCMAnalysis` returns a Map keyed by `component.hashCode()`, and
 * RocketComponent.hashCode() hashes a per-run random UUID — so iterating
 * `analysis.values()` put the mass table in a different order on every run, and
 * a different one again JVM vs TeaVM. Nothing about the numbers was wrong; the
 * rows just shuffled under the reader between one build and the next.
 */
describe('component masses are ordered, not shuffled', () => {
  const names = () =>
    build()
      .componentMasses()
      .map((m) => m.name);

  it('is stable across repeated builds in one session', () => {
    const first = names();
    expect(first.length).toBeGreaterThan(1);
    // Fresh handles, fresh UUIDs, fresh hash codes — and the same order.
    for (let i = 0; i < 5; i++) expect(names()).toEqual(first);
  });

  it('follows the component tree, nose before fins', () => {
    // TREE is nose → tube → fins, and the table should read that way rather
    // than in whatever order a hash map happened to yield.
    const order = names();
    const nose = order.findIndex((n) => /nose/i.test(n));
    const fins = order.findIndex((n) => /fin/i.test(n));
    expect(nose).toBeGreaterThanOrEqual(0);
    expect(fins).toBeGreaterThanOrEqual(0);
    expect(nose).toBeLessThan(fins);
  });

  it('survives a reset, which re-registers every component', () => {
    const before = names();
    engine.reset();
    expect(names()).toEqual(before);
  });
});
