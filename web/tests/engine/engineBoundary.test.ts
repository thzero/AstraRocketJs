import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  __setEngineForTests,
  OpenRocketDesign,
  type MotorSpec,
  type RocketTree,
} from '../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { MAX_FIN_POINTS, MAX_NESTING_DEPTH } from '../../src/services/files/ork/importLimits';

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
 * The cap and the reasoning for it live in `testing/kernelTimeout.ts`, shared with
 * the three other files that fly the kernel. Still opted into per file: a global
 * bump would slacken the thousands of tests that have no business taking seconds,
 * and hide the thing a timeout is for.
 */
vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

type Engine = typeof import('../../src/engine/vendor/openrocket-engine.mjs');
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
  engine = await import('../../src/engine/vendor/openrocket-engine.mjs');
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

/**
 * The stability margin is the kernel's to convert, both ways of stating it.
 *
 * Computed app-side as `((cp - cg) / length) * 100` it is the right shape over the
 * WRONG denominator: OpenRocket's `PercentageOfLengthUnit` divides by
 * `getLengthAerodynamic()`, the span of the AERODYNAMIC components, while `length`
 * bounds every component including the ones with no aerodynamic effect.
 *
 * The fixture below is the ordinary way the two differ: a motor tube that hangs
 * out of the back of the airframe. An inner tube is an `InternalComponent`, whose
 * `isAerodynamic()` is final and false, so the overhang lengthens the rocket
 * without lengthening its aerodynamic span.
 */
const OVERHANG = {
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
              position: { method: 'bottom', offset: 0 },
            },
            {
              // 70 mm of motor tube in a 200 mm airframe, pushed 40 mm out the
              // back: the rocket is 40 mm longer than its aerodynamic span.
              id: 'mount',
              type: 'innertube',
              length: 0.07,
              outerRadius: 0.0095,
              thickness: 0.0005,
              motorMount: true,
              position: { method: 'bottom', offset: 0.04 },
            },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

describe('the stability margin comes from the kernel, in both units', () => {
  it('reports an aerodynamic span shorter than the rocket, for this design', () => {
    // The premise of every assertion below. Without it the two denominators are
    // the same number and the test proves nothing.
    const info = OpenRocketDesign.buildTree(OVERHANG).staticInfo();
    expect(info.length).toBeCloseTo(0.34, 6); // 100 + 200 + 40 mm of overhang
    expect(info.lengthAerodynamic).toBeCloseTo(0.3, 6); // nose + tube, no overhang
    expect(info.lengthAerodynamic).toBeLessThan(info.length);
  });

  it('measures the percentage against the AERODYNAMIC span', () => {
    const info = OpenRocketDesign.buildTree(OVERHANG).staticInfo();
    const margin = info.cp - info.cg;
    expect(info.stabilityPercent).toBeCloseTo((margin / info.lengthAerodynamic) * 100, 6);
  });

  it('is NOT the old figure, which divided by the whole rocket', () => {
    // The regression this pins: 0.34 m instead of 0.30 m understated the margin
    // by about 12% on a design as ordinary as a motor with overhang.
    const info = OpenRocketDesign.buildTree(OVERHANG).staticInfo();
    const wrong = ((info.cp - info.cg) / info.length) * 100;
    expect(Math.abs(info.stabilityPercent - wrong)).toBeGreaterThan(0.5);
  });

  it('measures calibers against the largest body diameter', () => {
    // `CaliberUnit`, which is the reference DIAMETER and has nothing to do with
    // either length: a 26 mm body on this design.
    const info = OpenRocketDesign.buildTree(OVERHANG).staticInfo();
    expect(info.stabilityCalibers).toBeCloseTo((info.cp - info.cg) / info.refDiameter, 6);
    expect(info.refDiameter).toBeCloseTo(0.026, 6);
  });

  it('agrees with itself: the two units are the same margin', () => {
    const info = OpenRocketDesign.buildTree(OVERHANG).staticInfo();
    const fromCal = info.stabilityCalibers * info.refDiameter;
    const fromPct = (info.stabilityPercent / 100) * info.lengthAerodynamic;
    expect(fromCal).toBeCloseTo(fromPct, 9);
    expect(fromCal).toBeCloseTo(info.cp - info.cg, 9);
  });
});

describe('error envelopes, from the Java side', () => {
  /**
   * `reset()` must not rewind `nextHandle`, which would REUSE handle ids. The web
   * app calls `resetEngine()` before every rebuild and `buildRocket` registers
   * exactly one object, so the new design would take handle 1 -- the number a
   * design held from before the rebuild still carries -- and that stale object
   * would return results for the NEW rocket. The counter only climbs, so a freed
   * handle stays permanently unknown.
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

  it('refuses a sweep whose point count overflows, instead of returning an empty one', () => {
    // Finite inputs whose quotient is not: (1 - 0) / 5e-324 is Infinity, and
    // `(long) Infinity + 1` wraps negative past the point cap. Unguarded, the JS
    // build throws a RangeError out of the bundle and the WASM build returns an
    // empty sweep with no error at all; both have to refuse it by name. The regex
    // is deliberately NOT /sweep/: the wrapper prefixes every envelope with
    // "Drag sweep failed", which would match a bare RangeError too.
    expect(() => build().aeroSweep({ machMin: 0, machMax: 1, machStep: 5e-324 })).toThrow(/infinite number|over the/);
    expect(() => build().aeroSweep({ machMin: -1.7e308, machMax: 1.7e308, machStep: 0.05 })).toThrow(
      /infinite number|over the/,
    );
  });

  it('the kernel itself refuses a non-finite ignition delay, not only the wrapper', () => {
    // Straight at the facade: through OpenRocketDesign the wrapper's own
    // delayS check fires first and the kernel's guard would go untested.
    const h = engine.buildRocket(JSON.stringify(TREE));
    engine.setMotorById(h, 'tube', C6.designation, C6.diameter, C6.length, C6.times, C6.thrusts, C6.masses, C6.cgX, 5);
    for (const bad of [Infinity, -Infinity, NaN]) {
      expect(() => engine.setMotorIgnitionById(h, 'tube', 'launch', bad)).toThrow(/ignitionDelay|finite/);
    }
    expect(() => engine.setMotorIgnitionById(h, 'tube', 'launch', 1)).not.toThrow();
  });

  /**
   * A wind level's ALTITUDE is its identity to the kernel:
   * `MultiLevelPinkNoiseWindModel` binary-searches its sorted list to insert
   * one and throws on a collision. The bridge read it as
   * `JsonLite.dbl(lvl, "altitude", 0)`, so an absent or unreadable altitude
   * became a level at the pad - which either displaced the real surface wind or
   * collided with the ground level and failed the run with the kernel naming
   * its own internals. Both faults are refused here, by name.
   */
  it('refuses a wind level that cannot say where it is', () => {
    const fly = (windLevels: unknown[]) => {
      const d = build();
      d.setMotorById('tube', C6);
      return () => d.simulate({ launchRodLength: 1, randomSeed: 7, windLevels } as never);
    };
    const level = (o: Record<string, unknown>) => ({ speed: 4, direction: Math.PI / 2, stddev: 0, ...o });

    expect(fly([level({})])).toThrow(/altitude/i);
    // JSON.stringify writes NaN and Infinity as null, so the bridge sees an
    // absent value and takes its default — which is now NaN, not 0.
    expect(fly([level({ altitude: NaN })])).toThrow(/altitude/i);
    expect(fly([level({ altitude: Infinity })])).toThrow(/altitude/i);
    expect(fly([level({ altitude: 'high' })])).toThrow(/altitude/i);
  });

  it('refuses two wind levels at one altitude, naming the row', () => {
    const d = build();
    d.setMotorById('tube', C6);
    const level = (altitude: number, speed: number) => ({ altitude, speed, direction: Math.PI / 2, stddev: 0 });
    expect(() =>
      d.simulate({ launchRodLength: 1, randomSeed: 7, windLevels: [level(0, 4), level(0, 9)] } as never),
    ).toThrow(/repeat|level 2/i);
  });

  /**
   * Upstream's 4-arg `addWindLevel` builds each level's sub-model with the
   * NO-ARG `PinkNoiseWindModel` constructor, which seeds itself from
   * `new Random().nextInt()`. Nothing else seeded it: `setRandomSeed` only
   * stores an int on `SimulationConditions` and never reaches the wind model,
   * and the explicit seeding at the bridge's single-level branch is on the
   * other side of the `if`. So a TURBULENT multi-level profile was freshly
   * random on every run - five runs of one design at `randomSeed: 7` came back
   * 12.26 m, 232.44 m, 8.58 m, 14.86 m and 204.35 m - while single-level runs
   * repeated exactly. `WindProfileDialog` ships and makes per-level stddev
   * editable, and `windSweep` compares runs across a changed parameter, so the
   * comparison was against noise.
   *
   * Both halves matter. Same-seed-repeats alone would also pass if the
   * turbulence were simply dead, so the different-seed case is what says the
   * seed actually reaches the levels.
   */
  it('gives one turbulent profile the same flight twice at one seed', () => {
    const fly = (randomSeed: number) => {
      const d = build();
      d.setMotorById('tube', C6);
      return d.simulate({
        launchRodLength: 1,
        randomSeed,
        windLevels: [
          { altitude: 0, speed: 6, direction: Math.PI / 2, stddev: 2 },
          { altitude: 600, speed: 14, direction: Math.PI / 2, stddev: 4 },
        ],
      } as never).summary.maxAltitude;
    };

    const first = fly(7);
    expect(first).toBeGreaterThan(0);
    expect(fly(7)).toBe(first);
    expect(fly(8)).not.toBe(first);
  });

  it('still flies a profile with one level per altitude', () => {
    const d = build();
    d.setMotorById('tube', C6);
    const level = (altitude: number, speed: number) => ({ altitude, speed, direction: Math.PI / 2, stddev: 0 });
    const out = d.simulate({
      launchRodLength: 1,
      randomSeed: 7,
      windLevels: [level(0, 2), level(600, 9)],
    } as never);
    expect(out.summary.maxAltitude).toBeGreaterThan(0);
  });

  it('still runs a sane sweep', () => {
    const sweep = build().aeroSweep({ machMin: 0.1, machMax: 0.3, machStep: 0.1 });
    expect(sweep.machs.length).toBeGreaterThan(1);
    expect(sweep.machs.every((m) => Number.isFinite(m))).toBe(true);
  });
});

/**
 * Bad input the kernel used to accept silently, flying a different rocket than
 * the one described, or none, with no error to say so.
 */
describe('the boundary refuses what it cannot build faithfully', () => {
  /** TREE with one component's fields replaced. */
  const withPart = (id: string, patch: Record<string, unknown>) => {
    const tree = structuredClone(TREE) as unknown as { components: Record<string, unknown>[] };
    const visit = (nodes: Record<string, unknown>[]) => {
      for (const n of nodes) {
        const kids = n['children'];
        if (Array.isArray(kids)) visit(kids as Record<string, unknown>[]);
        if (n['id'] === id) Object.assign(n, patch);
      }
    };
    visit(tree.components);
    return tree as unknown as RocketTree;
  };

  it('refuses a trapezoid fin count the kernel would quietly clamp or truncate', () => {
    // FinSet.setFinCount clamps to 8, and a bare (int) cast truncated 3.9 to 3:
    // each built a rocket with a different fin count than the file's.
    for (const finCount of [12, 3.9, 0]) {
      expect(() => OpenRocketDesign.buildTree(withPart('fins', { finCount })).staticInfo()).toThrow(/finCount.*1\.\.8/);
    }
    expect(OpenRocketDesign.buildTree(withPart('fins', { finCount: 8 })).staticInfo().mass).toBeGreaterThan(0);
  });

  it('refuses a dimension past any real part, instead of reporting an all-null design', () => {
    expect(() => OpenRocketDesign.buildTree(withPart('nose', { length: 1e300 })).staticInfo()).toThrow(
      /length.*out of range/,
    );
  });

  it('refuses a children key that is not a list of parts, instead of dropping the subtree', () => {
    expect(() => OpenRocketDesign.buildTree(withPart('tube', { children: [1, 2, 3] })).staticInfo()).toThrow(
      /children.*object/,
    );
    expect(() =>
      OpenRocketDesign.buildTree(withPart('tube', { children: { type: 'trapezoidfinset' } })).staticInfo(),
    ).toThrow(/children.*list/);
  });
});

describe('every enum name is read, and an unknown one is refused', () => {
  /** TREE with one component's fields replaced (same as above, kept local). */
  const patched = (id: string, patch: Record<string, unknown>) => {
    const tree = structuredClone(TREE) as unknown as { components: Record<string, unknown>[] };
    const visit = (nodes: Record<string, unknown>[]) => {
      for (const n of nodes) {
        const kids = n['children'];
        if (Array.isArray(kids)) visit(kids as Record<string, unknown>[]);
        if (n['id'] === id) Object.assign(n, patch);
      }
    };
    visit(tree.components);
    return tree as unknown as RocketTree;
  };
  const builds = (id: string, patch: Record<string, unknown>) =>
    OpenRocketDesign.buildTree(patched(id, patch)).staticInfo();

  it('refuses a name it does not know, instead of defaulting it', () => {
    // Each of these used to build quietly as the default: square fins, an ogive
    // nose, a part at the top, a chute at ejection, a normal finish.
    expect(() => builds('fins', { crossSection: 'diamond' })).toThrow(/fin cross-section: 'diamond'/);
    expect(() => builds('nose', { shape: 'bogus' })).toThrow(/shape: 'bogus'/);
    expect(() => builds('fins', { position: { method: 'nonsense', offset: 0 } })).toThrow(/position method/);
    expect(() => builds('nose', { finish: 'glossy' })).toThrow(/surface finish/);
  });

  it('reads the upstream names it used to drop', () => {
    // A desktop file's lower-stage-separation chute, OpenRocket's mirror and
    // optimum finishes, and the AFTER position all build now.
    // Mapped, not just accepted: a mirror finish is smoother than a normal one,
    // so it carries less friction drag. Defaulted to NORMAL, the two were equal.
    const cd = (finish: string) =>
      OpenRocketDesign.buildTree(patched('nose', { finish })).aeroSweep({ machMin: 0.3, machMax: 0.3, machStep: 0.1 })
        .powerOff.total[0]!;
    expect(cd('mirror')).toBeLessThan(cd('normal'));
    expect(builds('nose', { finish: 'optimum' }).mass).toBeGreaterThan(0);
    expect(builds('fins', { position: { method: 'after', offset: 0 } }).mass).toBeGreaterThan(0);
  });
});

describe('the builders check what they are given', () => {
  it('refuses a missing shape, a non-finite or negative size, and a fin count past 8', () => {
    const rocket = engine.newRocket();
    expect(() => engine.addNoseCone(rocket, 0.1, 0.013, 0.001, null as unknown as string, 0)).toThrow(/shape/);
    expect(() => engine.addNoseCone(rocket, Number.NaN, 0.013, 0.001, 'ogive', 0)).toThrow(/length/);
    expect(() => engine.addBodyTube(rocket, 0.3, -0.013, 0.0005, 0)).toThrow(/outerRadius/);
    const tube = engine.addBodyTube(rocket, 0.3, 0.013, 0.0005, 0);
    expect(() => engine.addTrapezoidFins(tube, 1e9, 0.06, 0.03, 0.03, 0.05, 0.003, 0)).toThrow(/finCount/);
    expect(() => engine.getWorstThetaDeg(rocket, Number.NaN, 0)).toThrow(/mach/);
  });
});

/**
 * The browser's import ceilings are the kernel's, so a file that imports also
 * builds. Nesting: the deepest design the importer admits (a stage plus
 * MAX_NESTING_DEPTH levels of parts, 30 in all) must build, and one level more
 * must be refused by the kernel, which is what makes the importer's cap exact.
 */
describe('the import ceilings match the kernel', () => {
  // Parts that nest in each other indefinitely: a pod set inside a tube inside a
  // pod set. The deepest part is a freeform fin, whose point list costs two more
  // JSON levels than any other part.
  const deep = (levels: number) => {
    let node: Record<string, unknown> = {
      type: 'freeformfinset',
      finCount: 3,
      thickness: 0.002,
      points: [
        [0, 0],
        [0.02, 0.02],
        [0.03, 0],
      ],
    };
    for (let i = levels - 2; i >= 1; i--) {
      node =
        i % 2 === 1
          ? { type: 'bodytube', length: 0.1, outerRadius: 0.02, thickness: 0.001, children: [node] }
          : { type: 'podset', instanceCount: 1, children: [node] };
    }
    return { components: [{ type: 'stage', children: [node] }] } as unknown as RocketTree;
  };

  // The kernel's NESTING limit is what the importer's cap has to match, so that is
  // what this asserts. At 30 levels this chain can still be refused for another
  // reason (a fin cannot sit on a pod set at an even depth), which is no part of it.
  it('admits the deepest design the importer admits, and refuses one level more', () => {
    expect(() => OpenRocketDesign.buildTree(deep(MAX_NESTING_DEPTH + 1)).staticInfo()).not.toThrow(/nesting/);
    expect(() => OpenRocketDesign.buildTree(deep(MAX_NESTING_DEPTH + 2)).staticInfo()).toThrow(/nesting/);
  });

  it('refuses a freeform outline past the browser ceiling', () => {
    const tree = structuredClone(TREE) as unknown as { components: Record<string, unknown>[] };
    const tube = (tree.components[0]!['children'] as Record<string, unknown>[])[1]!;
    const points = Array.from({ length: MAX_FIN_POINTS + 1 }, (_, i) => [i * 1e-5, i === 0 ? 0 : 0.01]);
    tube['children'] = [{ id: 'ff', type: 'freeformfinset', finCount: 3, thickness: 0.002, points }];
    expect(() => OpenRocketDesign.buildTree(tree as unknown as RocketTree).staticInfo()).toThrow(/points/);
  });
});

describe('one handle can be released, and the JSON reader is JSON', () => {
  it('frees one handle without touching another, and refuses an unknown one', () => {
    const a = engine.buildRocket(JSON.stringify(TREE));
    const b = engine.buildRocket(JSON.stringify(TREE));
    engine.free(a);
    expect(JSON.parse(engine.getStaticInfo(a)).error).toMatch(/handle/i);
    expect(JSON.parse(engine.getStaticInfo(b)).mass).toBeGreaterThan(0);
    expect(() => engine.free(a)).toThrow(/Unknown handle/);
  });

  it('refuses numbers JSON.parse refuses', () => {
    for (const bad of ['01', '+0.3', '.3', '1.', '1e']) {
      expect(() => engine.buildRocket(`{"components":[],"x":${bad}}`)).toThrow(/bad number/);
    }
  });

  it('refuses a lone surrogate, and still decodes a pair', () => {
    const named = (escaped: string) => JSON.stringify(TREE).replace('{', `{"name":"${escaped}",`);
    expect(() => engine.buildRocket(named(String.raw`\ud83d`))).toThrow(/surrogate/);
    expect(() => engine.buildRocket(named(String.raw`\ude00`))).toThrow(/surrogate/);
    expect(() => engine.buildRocket(named(String.raw`🚀`))).not.toThrow();
  });

  it('refuses a negative size instead of building a massless part', () => {
    const tree = structuredClone(TREE) as unknown as { components: Record<string, unknown>[] };
    const tube = (tree.components[0]!['children'] as Record<string, unknown>[])[1]!;
    tube['outerRadius'] = -1;
    expect(() => OpenRocketDesign.buildTree(tree as unknown as RocketTree).staticInfo()).toThrow(
      /outerRadius' must not be negative/,
    );
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

/**
 * Three options the bridge could hardcode, proved against the REAL kernel rather
 * than at the marshalling seam. An option the Java ignores looks exactly like a
 * working one from the JS side, so each case asserts the flight actually MOVED.
 */
describe('the bridge passes these options through to the physics', () => {
  const deg = (d: number) => (d * Math.PI) / 180;

  const fly = (options: Record<string, unknown>) => {
    const d = build();
    d.setMotorById('tube', C6);
    // Pinned seed: the default mints a fresh one per run, and two flights flown
    // on different turbulence would compare nothing.
    return d.simulate({ randomSeed: 7, ...options } as never).summary.maxAltitude;
  };

  const underG = (g: number) => fly({ gravityModel: 'constant', constantGravity: g });

  it('coasts higher the weaker the constant gravity', () => {
    // Monotonic rather than one threshold: any single ratio is a number someone
    // has to re-tune, where the ORDER is the physics.
    const [moon, mars, half, earth] = [underG(1.62), underG(3.71), underG(5), underG(9.80665)];
    expect(moon).toBeGreaterThan(mars);
    expect(mars).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(earth);
  });

  it('lands within a meter of WGS when the constant is sea-level g', () => {
    // Not identical: WGS varies g with latitude and altitude and a constant does
    // not. Close is the point, because it says the model swapped rather than broke.
    expect(Math.abs(underG(9.80665) - fly({}))).toBeLessThan(1);
  });

  it('flies differently in humid air than in dry air', () => {
    // Water vapor is lighter than dry air, so a humid pad is a thinner one.
    // Small, but it has to be there: humidity was pinned to STANDARD before.
    const at = (rh: number) => fly({ temperature: 303.15, pressure: 101325, relativeHumidity: rh });
    expect(at(1)).not.toBe(at(0));
  });

  describe('the maximum angle step', () => {
    // An angled rod in wind is the only case the cap binds in: straight up in
    // still air the rocket barely rotates and the time step governs throughout.
    const rotating = { launchRodAngle: deg(10), windAverage: 4, windStdDeviation: 0 };

    it('changes the flight once it is tight enough to bind', () => {
      const loose = fly({ ...rotating, maxAngleStep: deg(30) });
      const tight = fly({ ...rotating, maxAngleStep: deg(0.1) });
      expect(tight).not.toBe(loose);
      expect(tight).toBeGreaterThan(0); // a shorter step, not a diverged run
    });

    it('tightens monotonically', () => {
      const a = fly({ ...rotating, maxAngleStep: deg(30) });
      const b = fly({ ...rotating, maxAngleStep: deg(0.5) });
      const c = fly({ ...rotating, maxAngleStep: deg(0.1) });
      expect(b).not.toBe(a);
      expect(c).not.toBe(b);
    });

    it('defaults to the kernel RECOMMENDED_ANGLE_STEP when we send nothing', () => {
      // Our DEFAULT_SETTINGS value is 3 degrees because that is what the kernel
      // used while this could not be set. If upstream ever moves it, this fails.
      expect(fly({ ...rotating, maxAngleStep: deg(3) })).toBe(fly(rotating));
    });
  });
});

/**
 * Dual deployment, which the app could not express at all.
 *
 * `RecoveryDevice.isDrogue()` is what the kernel branches on: a stage with a
 * drogue judges its MAIN against `mainHighSpeedWarn`/`mainLowSpeedWarn` and its
 * drogue against `drogueLowSpeedWarn`, and a stage without one judges everything
 * against `recoverySpeedWarn` alone. Nothing ever called `setDrogue`, so every
 * rocket the app built was single-deployment to the kernel and the three
 * dual-deployment thresholds were unreachable however they were set.
 *
 * The drogue-low-speed check on top of that was commented out upstream and is
 * enabled by a patch here, so this file is the only thing proving either half.
 */
/**
 * Stage activeness, through the real kernel.
 *
 * A grounded stage contributes no mass, no aerodynamics and no motor, which is
 * how a two-stage design is flown as its own sustainer. The flag lives on the
 * flight configuration, so this is also the check that the facade addresses a
 * stage by node id and reaches the configuration the rest of the API reads.
 */
describe('a grounded stage leaves the flight', () => {
  const TWO_STAGE = {
    components: [
      {
        id: 'sustainer',
        type: 'stage',
        children: [
          { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.013, thickness: 0.001, shape: 'ogive' },
          { id: 'upper', type: 'bodytube', length: 0.2, outerRadius: 0.013, thickness: 0.0005 },
        ],
      },
      {
        id: 'booster',
        type: 'stage',
        children: [
          {
            id: 'lower',
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.013,
            thickness: 0.0005,
            motorMount: true,
            children: [
              {
                id: 'lower-fins',
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

  it('drops the stage"s mass and length from the static info', () => {
    const whole = OpenRocketDesign.buildTree(TWO_STAGE).staticInfo();
    const design = OpenRocketDesign.buildTree(TWO_STAGE);
    design.setStageActiveById('booster', false);
    const sustainerOnly = design.staticInfo();

    expect(sustainerOnly.mass).toBeLessThan(whole.mass);
    expect(sustainerOnly.length).toBeLessThan(whole.length);
  });

  it('leaves the booster"s motor out of the loaded mass', () => {
    const design = OpenRocketDesign.buildTree(TWO_STAGE);
    design.setMotorById('lower', C6);
    const loaded = design.staticInfo().mass;

    const grounded = OpenRocketDesign.buildTree(TWO_STAGE);
    grounded.setMotorById('lower', C6);
    grounded.setStageActiveById('booster', false);
    // The motor is in the stage that stayed behind, so the propellant goes with
    // it: this is the number a "sustainer only" configuration flies on.
    expect(grounded.staticInfo().mass).toBeLessThan(loaded - C6.masses![0]! / 2);
  });

  it('refuses an id that is not a stage, by name', () => {
    const design = OpenRocketDesign.buildTree(TWO_STAGE);
    expect(() => design.setStageActiveById('nose', false)).toThrow(/not a stage/i);
  });
});

describe('dual deployment reaches the kernel', () => {
  /** The TREE above plus a drogue at apogee and a main lower down. */
  const dualTree = (drogue: boolean) =>
    ({
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
                {
                  id: 'drogue',
                  type: 'parachute',
                  diameter: 0.15,
                  cd: 0.8,
                  lineCount: 6,
                  lineLength: 0.2,
                  drogue,
                  deployEvent: 'apogee',
                  deployDelay: 0,
                },
                {
                  id: 'main',
                  type: 'parachute',
                  diameter: 0.4,
                  cd: 0.8,
                  lineCount: 6,
                  lineLength: 0.3,
                  deployEvent: 'altitude',
                  deployAltitude: 60,
                  deployDelay: 0,
                },
              ],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  const keys = (tree: RocketTree, options: Record<string, unknown>) => {
    const d = OpenRocketDesign.buildTree(tree);
    d.setMotorById('tube', C6);
    const r = d.simulate({ randomSeed: 7, ...options } as never);
    return (r.warnings ?? []).map((w) => w.key);
  };

  it('warns about a slow drogue at apogee once the threshold is high enough', () => {
    // At apogee the rocket is all but stationary, so a threshold above the
    // apogee speed must fire and one at zero must not: the same flight, judged
    // differently, which is the only way to show the VALUE is read rather than
    // some constant.
    expect(keys(dualTree(true), { drogueLowSpeedWarn: 50 })).toContain('RECOVERY_DROGUE_LOW_SPEED');
    expect(keys(dualTree(true), { drogueLowSpeedWarn: 0 })).not.toContain('RECOVERY_DROGUE_LOW_SPEED');
  });

  it('stays silent when the same chute is not marked as a drogue', () => {
    // Without the flag the stage is single-deployment, so the drogue branch is
    // never entered at all.
    expect(keys(dualTree(false), { drogueLowSpeedWarn: 50 })).not.toContain('RECOVERY_DROGUE_LOW_SPEED');
  });

  it('judges the main against the dual-deployment thresholds, not the single one', () => {
    // A main that opens at 60 m: fast for a main, nowhere near the single
    // threshold. Only the dual branch can call it, and only when a drogue is
    // present to put the flight on that branch.
    const low = { mainHighSpeedWarn: 0.1, recoverySpeedWarn: 1000 };
    expect(keys(dualTree(true), low)).toContain('RECOVERY_MAIN_HIGH_SPEED');
    expect(keys(dualTree(false), low)).not.toContain('RECOVERY_MAIN_HIGH_SPEED');
  });
});

/**
 * A component inside a mass component: an altimeter bay or a payload sled with
 * hardware nested in it.
 *
 * `MassComponent.isCompatible` accepted nothing at all until now, not by our
 * choice but because `patches/` carried a copy of the class from before upstream
 * allowed it (86d4648a3, 2026-07-05). Anything nested there threw out of
 * `addChild`, which meant a `.ork` the desktop writes happily would not open.
 * The patch is gone, so this is upstream's own rule again.
 */
describe('a mass component can hold internal components', () => {
  const withNested = (nested: boolean) =>
    ({
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
              children: [
                {
                  id: 'bay',
                  type: 'masscomponent',
                  mass: 0.02,
                  length: 0.02,
                  radius: 0.005,
                  ...(nested
                    ? { children: [{ id: 'bh', type: 'bulkhead', outerRadius: 0.012, thickness: 0.003 }] }
                    : {}),
                },
              ],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  it('builds instead of throwing out of addChild', () => {
    expect(() => OpenRocketDesign.buildTree(withNested(true))).not.toThrow();
  });

  it('counts the nested part in the rocket mass', () => {
    // Not just "it built": a child the kernel accepts but never weighs would
    // look identical from here.
    const massOf = (nested: boolean) => OpenRocketDesign.buildTree(withNested(nested)).staticInfo().mass;
    expect(massOf(true)).toBeGreaterThan(massOf(false));
  });
});

/**
 * Fin fillets reach the kernel.
 *
 * The kernel has always computed a fillet's volume, mass and CM
 * (FinSet.calculateFilletVolumeCentroid, and calculateCM adds filletMass to
 * every fin unconditionally) — but `ComponentFactory` never called
 * `setFilletRadius`, so the field stayed at its initial 0 and every fillet
 * flew as if it were not there. The .ork reader, writer and the rocket scaler
 * all carried `filletRadius` faithfully, which is what made it invisible: the
 * number was in the tree, on disk and in the panel's reach, and only the
 * engine never saw it.
 *
 * These assert the EFFECT, not the plumbing. A bridge that set the radius on a
 * component the kernel then ignored would pass any "it built" check.
 */
describe('fin fillets are flown, not just stored', () => {
  const filleted = (radius: number, density?: number) =>
    ({
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
                  filletRadius: radius,
                  ...(density === undefined ? {} : { filletDensity: density, filletMaterialName: 'Epoxy' }),
                },
              ],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  const massOf = (radius: number, density?: number) =>
    OpenRocketDesign.buildTree(filleted(radius, density)).staticInfo().massEmpty;

  it('adds the fillet to the rocket mass, and more of it for a bigger bead', () => {
    const none = massOf(0);
    expect(massOf(0.003)).toBeGreaterThan(none);
    expect(massOf(0.006)).toBeGreaterThan(massOf(0.003));
  });

  it("weighs the bead in ITS OWN material, not the fin's", () => {
    // The fin is cardboard by default and the bead is epoxy; a bridge that set
    // the radius but not the material would weigh both the same.
    expect(massOf(0.006, 1250)).toBeGreaterThan(massOf(0.006));
  });

  it('moves the CG, since the bead sits along the root at the aft end', () => {
    const cg = (r: number) => OpenRocketDesign.buildTree(filleted(r)).staticInfo().cgEmpty;
    expect(cg(0.006)).toBeGreaterThan(cg(0));
  });
});

/**
 * A transition's shoulders reach the kernel whole.
 *
 * Both halves of a shoulder's mass were being dropped on the way in. The WALL
 * round-tripped through `.ork` and `ComponentFactory` never set it, so the
 * stub flew as a surface with no material. The CAP - the disc that closes the
 * far end - was read only from the nose cone's `shoulderCapped` key, which a
 * transition node does not carry, and the `.ork` writer emitted a hardcoded
 * false for both of its sides.
 *
 * Mass is the only honest witness: the fields can be set, saved and reloaded
 * and still change nothing about the rocket that flies. So this asks the real
 * kernel what the design weighs.
 */
const withTransition = (shoulder: Record<string, unknown>) =>
  ({
    components: [
      {
        id: 'stage1',
        type: 'stage',
        children: [
          { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.02, thickness: 0.001, shape: 'ogive' },
          { id: 'upper', type: 'bodytube', length: 0.2, outerRadius: 0.02, thickness: 0.001 },
          {
            id: 'trans',
            type: 'transition',
            shape: 'conical',
            length: 0.05,
            foreRadius: 0.02,
            aftRadius: 0.013,
            thickness: 0.001,
            foreShoulderRadius: 0.019,
            foreShoulderLength: 0.03,
            aftShoulderRadius: 0.012,
            aftShoulderLength: 0.03,
            ...shoulder,
          },
          { id: 'lower', type: 'bodytube', length: 0.2, outerRadius: 0.013, thickness: 0.001 },
        ],
      },
    ],
  }) as unknown as RocketTree;

const massOf = (tree: RocketTree) => OpenRocketDesign.buildTree(tree).staticInfo().massEmpty;

describe("a transition's shoulders weigh what they are built from", () => {
  it('a shoulder with a wall weighs more than one without', () => {
    const bare = massOf(withTransition({}));
    const walled = massOf(withTransition({ foreShoulderThickness: 0.002, aftShoulderThickness: 0.002 }));
    expect(walled).toBeGreaterThan(bare);
  });

  it('capping either end adds the disc that closes it', () => {
    const walls = { foreShoulderThickness: 0.002, aftShoulderThickness: 0.002 };
    const open = massOf(withTransition(walls));
    const foreCapped = massOf(withTransition({ ...walls, foreShoulderCapped: true }));
    const bothCapped = massOf(withTransition({ ...walls, foreShoulderCapped: true, aftShoulderCapped: true }));
    // Per SIDE: the fore cap alone is not the whole of it, which is what
    // reading one flag for both ends would have produced.
    expect(foreCapped).toBeGreaterThan(open);
    expect(bothCapped).toBeGreaterThan(foreCapped);
  });

  it('falls back to the part wall when the shoulder carries no thickness', () => {
    // An absent shoulder thickness is not a zero one. OpenRocket fills the
    // shoulder's wall (and radius) from the part when the shoulder LENGTH goes
    // from zero to something - Transition.setForeShoulderLength - so a cap
    // still has material to be made of. It is also why the panel showing 0 for
    // that absent key states a number the kernel is not using.
    const open = massOf(withTransition({}));
    const capped = massOf(withTransition({ foreShoulderCapped: true, aftShoulderCapped: true }));
    expect(capped).toBeGreaterThan(open);
  });

  it('lets an explicit wall override the one the kernel would fill in', () => {
    const auto = massOf(withTransition({ foreShoulderCapped: true, aftShoulderCapped: true }));
    const thick = massOf(
      withTransition({
        foreShoulderCapped: true,
        aftShoulderCapped: true,
        foreShoulderThickness: 0.003,
        aftShoulderThickness: 0.003,
      }),
    );
    expect(thick).toBeGreaterThan(auto);
  });
});

/**
 * The audit's category 2: values that round-tripped through the file and never
 * reached the kernel. Mass is the witness again, because that is the whole
 * point - each of these changes what the rocket weighs or how its weight is
 * distributed, and until now the file kept them and the simulation ignored them.
 */
const withPart = (part: Record<string, unknown>) =>
  ({
    components: [
      {
        id: 'stage1',
        type: 'stage',
        children: [
          { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.02, thickness: 0.001, shape: 'ogive' },
          {
            id: 'tube',
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.02,
            thickness: 0.001,
            children: [part],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const dryMass = (tree: RocketTree) => OpenRocketDesign.buildTree(tree).staticInfo().massEmpty;

describe('the audit gaps reach the kernel', () => {
  it('weighs a rail button at its own geometry, not the kernel default', () => {
    const stock = dryMass(withPart({ id: 'rb', type: 'railbutton', outerDiameter: 0.0097 }));
    const tall = dryMass(
      withPart({ id: 'rb', type: 'railbutton', outerDiameter: 0.0097, height: 0.03, baseHeight: 0.006 }),
    );
    expect(tall).toBeGreaterThan(stock);
  });

  it('builds every instance of a repeated ring', () => {
    // Compared as the ring's own contribution, not the whole rocket's mass:
    // the airframe dwarfs three centering rings.
    const bare = dryMass(withPart({ id: 'x', type: 'bulkhead', length: 0.0001, outerRadius: 0.0001 }));
    const one = dryMass(withPart({ id: 'cr', type: 'centeringring', length: 0.003, outerRadius: 0.019 })) - bare;
    const three =
      dryMass(
        withPart({
          id: 'cr',
          type: 'centeringring',
          length: 0.003,
          outerRadius: 0.019,
          instanceCount: 3,
          instanceSeparation: 0.02,
        }),
      ) - bare;
    expect(one).toBeGreaterThan(0);
    expect(three / one).toBeCloseTo(3, 1);
  });

  it('moves a mass object off the axis when the design says so', () => {
    const roll = (radialPosition: number) =>
      OpenRocketDesign.buildTree(
        withPart({ id: 'm', type: 'masscomponent', mass: 0.05, length: 0.02, radius: 0.005, radialPosition }),
      ).staticInfo().rollInertia;
    // Moving mass off the long axis can only increase the roll inertia.
    // A RING is deliberately not tested here: upstream `RingComponent`
    // returns its CG on the axis whatever the radial position says
    // (`getComponentCG` ignores shiftY/shiftZ), so the value is a drawing and
    // bounding-box concern there, and the bridge is faithful to that.
    expect(roll(0.012)).toBeGreaterThan(roll(0));
  });

  it.each([
    { type: 'parachute', diameter: 0.4, cd: 0.8 },
    { type: 'streamer', stripLength: 0.5, stripWidth: 0.05 },
    { type: 'shockcord', cordLength: 1 },
  ])('moves a $type off the axis when the design says so', (part) => {
    const roll = (radialPosition: number) =>
      OpenRocketDesign.buildTree(
        withPart({ id: 'r', ...part, length: 0.05, radius: 0.005, radialPosition, radialDirection: 1 }),
      ).staticInfo().rollInertia;
    expect(roll(0.012)).toBeGreaterThan(roll(0));
  });

  it('packs a recovery device at the radius the design gives it', () => {
    const narrow = OpenRocketDesign.buildTree(
      withPart({ id: 'p', type: 'parachute', diameter: 0.4, cd: 0.8, length: 0.05, radius: 0.005 }),
    ).staticInfo().rollInertia;
    const wide = OpenRocketDesign.buildTree(
      withPart({ id: 'p', type: 'parachute', diameter: 0.4, cd: 0.8, length: 0.05, radius: 0.018 }),
    ).staticInfo().rollInertia;
    expect(wide).toBeGreaterThan(narrow);
  });

  it('flies a flipped nose cone as a tail cone', () => {
    const cg = (flip: boolean) => {
      const t = withPart({ id: 'x', type: 'centeringring', length: 0.003 });
      const nose = (t.components[0] as unknown as { children: Record<string, unknown>[] }).children[0]!;
      nose['flipped'] = flip;
      return OpenRocketDesign.buildTree(t).staticInfo().cgEmpty;
    };
    // Mirroring the profile does not change its VOLUME, so the mass is the
    // same either way. What moves is where that mass sits: a cone that tapers
    // the other way puts its material at the other end.
    expect(cg(true)).not.toBeCloseTo(cg(false), 4);
  });

  it('takes the fin cross-section, which changes the fin volume', () => {
    const square = dryMass(
      withPart({
        id: 'f',
        type: 'trapezoidfinset',
        finCount: 3,
        rootChord: 0.06,
        tipChord: 0.03,
        height: 0.04,
        thickness: 0.004,
        crossSection: 'square',
      }),
    );
    const airfoil = dryMass(
      withPart({
        id: 'f',
        type: 'trapezoidfinset',
        finCount: 3,
        rootChord: 0.06,
        tipChord: 0.03,
        height: 0.04,
        thickness: 0.004,
        crossSection: 'airfoil',
      }),
    );
    // AIRFOIL's volume factor is 0.85 against SQUARE's 1.00.
    expect(airfoil).toBeLessThan(square);
  });
});

/**
 * A FILLED component is solid: no wall, no bore. The desktop offers it as a
 * checkbox on a nose cone, a transition and a body tube, and it rides in the
 * file as `<thickness>filled</thickness>`. The first two reached the kernel;
 * a body tube did not, so a solid tube flew hollow.
 */
describe('a filled component is solid', () => {
  const tubeTree = (filled: boolean) =>
    ({
      components: [
        {
          id: 'stage1',
          type: 'stage',
          children: [
            { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.02, thickness: 0.001, shape: 'ogive' },
            { id: 'tube', type: 'bodytube', length: 0.3, outerRadius: 0.02, thickness: 0.001, filled },
          ],
        },
      ],
    }) as unknown as RocketTree;

  it('weighs a solid body tube more than a walled one', () => {
    expect(dryMass(tubeTree(true))).toBeGreaterThan(dryMass(tubeTree(false)));
  });
});

/**
 * A SELF-INTERSECTING freeform outline is refused by name, not flown as some
 * other fin.
 *
 * `FreeformFinSet.setPoints` validates AFTER it has snapped the outline to the
 * body, and on a crossing it rolls the whole outline back to whatever the fin
 * held before - on a fin the bridge has just constructed, the kernel's DEFAULT
 * outline - reporting the refusal only to the log. Read by nobody, that flew a
 * fin the design does not draw: measured on this build before the fix, a
 * crossing outline reported length 0.325 m and CP 0.2588 m, the default fin's
 * own numbers, where the outline as drawn gives 0.300 m and 0.2454 m. Neither
 * an error nor a warning reached the app.
 *
 * So the assertion that matters is not "it throws": it is that the refused
 * outline does NOT quietly produce the default fin's geometry. Both halves are
 * pinned, because a future kernel that stops rolling back would pass the first
 * and fail the second.
 */
describe('a self-intersecting freeform fin outline is refused', () => {
  const finTree = (points?: number[][], name?: string) =>
    ({
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
              children: [
                {
                  id: 'fins',
                  type: 'freeformfinset',
                  ...(name ? { name } : {}),
                  finCount: 3,
                  thickness: 0.003,
                  ...(points ? { points } : {}),
                },
              ],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  /** A plain trapezoid, 0.06 m root chord: legal, and 0.05 m shorter than the default fin. */
  const VALID = [
    [0, 0],
    [0.02, 0.05],
    [0.05, 0.05],
    [0.06, 0],
  ];
  /** The same four points with two swapped, so the outline crosses itself. */
  const BOWTIE = [
    [0, 0],
    [0.05, 0.05],
    [0, 0.05],
    [0.06, 0],
  ];
  /** A repeated point: the segment it makes touches its neighbor along its whole length. */
  const REPEATED = [
    [0, 0],
    [0.02, 0.05],
    [0.02, 0.05],
    [0.06, 0],
  ];

  const info = (points?: number[][]) => OpenRocketDesign.buildTree(finTree(points, 'Forward fins')).staticInfo();

  it('builds a valid outline at its own length', () => {
    expect(info(VALID).length).toBeCloseTo(0.3, 9);
  });

  it('refuses a crossing outline, naming the fin set', () => {
    expect(() => info(BOWTIE)).toThrow(/Forward fins/);
    expect(() => info(BOWTIE)).toThrow(/crosses or touches itself/);
  });

  it('refuses an outline with a repeated point', () => {
    expect(() => info(REPEATED)).toThrow(/crosses or touches itself/);
  });

  it('falls back on the type when the fin set has no name', () => {
    expect(() => OpenRocketDesign.buildTree(finTree(BOWTIE)).staticInfo()).toThrow(/freeform fin set/);
  });

  /**
   * The silent substitution itself, stated as geometry: a refused outline must
   * not return the DEFAULT fin's numbers. `info()` with no points IS the default
   * fin, so this compares the two answers the app would have shown.
   */
  it('does not fly the default fin in place of the refused one', () => {
    const fallback = info();
    expect(fallback.length).toBeCloseTo(0.325, 9);
    let flew: number | null = null;
    try {
      flew = info(BOWTIE).length;
    } catch {
      /* refused, which is the point */
    }
    expect(flew).not.toBe(fallback.length);
  });

  /** The flag is per-call, so one refused fin must not poison the next build. */
  it('builds a good outline after a refused one', () => {
    expect(() => info(BOWTIE)).toThrow();
    expect(info(VALID).length).toBeCloseTo(0.3, 9);
  });
});
