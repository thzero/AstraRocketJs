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

  it('refuses a sweep whose point count overflows, instead of returning an empty one', () => {
    // Finite inputs whose quotient is not: (1 - 0) / 5e-324 is Infinity, and
    // `(long) Infinity + 1` wrapped negative past the point cap. The JS build
    // threw a RangeError out of the bundle; the WASM build returned an empty
    // sweep with no error at all. Now both refuse it by name. The regex is
    // deliberately NOT /sweep/: the wrapper prefixes every envelope with
    // "Drag sweep failed", so that would have matched the old RangeError too.
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

/**
 * The three options the bridge used to hardcode, proved against the REAL kernel
 * rather than at the marshalling seam. An option the Java ignores looks exactly
 * like a working one from the JS side, which is how all three sat unnoticed:
 * the app sent nothing, so nothing looked missing. Each case therefore asserts
 * the flight actually MOVED.
 */
describe('options the bridge used to hardcode reach the physics', () => {
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
    // never entered at all. This is what every app-built rocket used to be.
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
