import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OpenRocketDesign,
  PLUGGED_DELAY,
  __setEngineForTests,
  type MotorSpec,
  type RocketTree,
} from './openRocketEngine';

/**
 * The typed facade over the WASM kernel.
 *
 * This is the ONE boundary where JS numbers become physics inputs, and it had
 * no test file at all — so a dropped `?? default` in an options block would
 * change every simulation with nothing failing. These tests stub the engine so
 * they assert what the facade HANDS the kernel, not what the kernel computes.
 */

/** Records every call so a test can inspect the JSON the facade built. */
function stub() {
  const calls: Record<string, unknown[][]> = {};
  const rec =
    (name: string, ret: unknown) =>
    (...args: unknown[]): never => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const empty = JSON.stringify({ machs: [], hasNozzle: false, components: [] });
  return {
    calls,
    api: {
      buildRocket: rec('buildRocket', 1),
      reset: rec('reset', undefined),
      setMotorById: rec('setMotorById', undefined),
      getAeroSweep: rec('getAeroSweep', empty),
      simulateJson: rec('simulateJson', JSON.stringify({ summary: {}, branches: [] })),
      getStaticInfo: rec('getStaticInfo', JSON.stringify({ length: 1 })),
      getComponentMasses: rec('getComponentMasses', '[]'),
    },
  };
}

const motor = (over: Partial<MotorSpec> = {}): MotorSpec =>
  ({
    designation: 'C6',
    diameter: 0.018,
    length: 0.07,
    cgX: 0.035,
    ejectionDelay: 5,
    times: [0, 1, 2],
    thrusts: [0, 6, 0],
    masses: [0.024, 0.018, 0.012],
    ...over,
  }) as MotorSpec;

let s: ReturnType<typeof stub>;
beforeEach(() => {
  s = stub();
  __setEngineForTests(s.api);
});
afterEach(() => __setEngineForTests(null));

const design = () => OpenRocketDesign.buildTree({ components: [] } as unknown as RocketTree);

describe('assertFiniteCurve — the motor curve', () => {
  it('names the motor when a sample is non-finite', () => {
    // TeaVM reports this as an opaque "number NaN cannot be converted to a
    // BigInt" from deep inside the compiled Java. The point of the guard is a
    // message that says WHICH motor.
    for (const bad of [{ masses: [0.024, NaN, 0.012] }, { thrusts: [0, NaN, 0] }, { times: [0, NaN, 2] }]) {
      expect(() => design().setMotorById('mount', motor(bad))).toThrow(/C6/);
    }
  });

  it('rejects a curve that ends at a negative mass', () => {
    expect(() => design().setMotorById('mount', motor({ masses: [0.024, 0.01, -0.001] }))).toThrow(/C6/);
  });
});

describe('assertFiniteCurve — the scalars', () => {
  // These cross into the kernel too and were unguarded. thrustcurve.ts computes
  // `length: motor.length / 1000` and `cgX: … ?? motor.length / 2000`, so a
  // catalog row missing `length` makes BOTH NaN.
  it.each([['diameter'], ['length'], ['cgX']] as const)('rejects a non-finite %s', (field) => {
    expect(() => design().setMotorById('mount', motor({ [field]: NaN }))).toThrow(new RegExp(`C6.*${field}`));
  });

  it('rejects a non-positive diameter or length', () => {
    expect(() => design().setMotorById('mount', motor({ diameter: 0 }))).toThrow(/C6/);
    expect(() => design().setMotorById('mount', motor({ length: -1 }))).toThrow(/C6/);
  });

  it('rejects a NaN ejection delay', () => {
    expect(() => design().setMotorById('mount', motor({ ejectionDelay: NaN }))).toThrow(/C6/);
  });

  it('accepts a good motor and passes it straight through', () => {
    design().setMotorById('mount', motor());
    expect(s.calls.setMotorById).toHaveLength(1);
  });
});

describe('toKernelDelay', () => {
  it('maps the stored plugged sentinel to the kernel Infinity', () => {
    // Infinity cannot survive JSON (localStorage and the motor cache turn it to
    // null), so the app stores a finite sentinel and maps it back only here.
    design().setMotorById('mount', motor({ ejectionDelay: PLUGGED_DELAY }));
    const args = s.calls.setMotorById![0]!;
    expect(args[args.length - 1]).toBe(Infinity);
  });

  it('leaves an ordinary delay alone', () => {
    design().setMotorById('mount', motor({ ejectionDelay: 5 }));
    const args = s.calls.setMotorById![0]!;
    expect(args[args.length - 1]).toBe(5);
  });
});

describe('aeroSweep options', () => {
  it('sends the documented defaults when the caller passes nothing', () => {
    design().aeroSweep();
    const sent = JSON.parse(s.calls.getAeroSweep![0]![1] as string);
    expect(sent).toMatchObject({
      machMin: 0.05,
      machMax: 3.0,
      machStep: 0.05,
      aoaDeg: 0,
      thetaDeg: 0,
      rollRate: 0,
    });
  });

  it('passes a zero through instead of substituting the default', () => {
    // `??`, not `||`: a caller asking for machMin 0 means 0.
    design().aeroSweep({ machMin: 0, aoaDeg: 0, machMax: 1 });
    const sent = JSON.parse(s.calls.getAeroSweep![0]![1] as string);
    expect(sent.machMin).toBe(0);
    expect(sent.machMax).toBe(1);
  });
});

describe('error envelopes', () => {
  it('throws the kernel message rather than casting past it', () => {
    __setEngineForTests({ ...s.api, getStaticInfo: () => JSON.stringify({ error: 'bad geometry' }) });
    expect(() => design().staticInfo()).toThrow(/bad geometry/);
  });

  it('throws the kernel message from a failed sweep', () => {
    __setEngineForTests({ ...s.api, getAeroSweep: () => JSON.stringify({ error: 'no fins' }) });
    expect(() => design().aeroSweep()).toThrow(/no fins/);
  });

  it('throws rather than handing back an error object shaped like a mass list', () => {
    // This one cast the parse straight to `ComponentMass[]`, so a failure came
    // back as `{error: "..."}` claiming to be an array — and blew up later, in
    // whichever caller first called `.map` on it, with the kernel's message
    // already discarded.
    __setEngineForTests({
      ...s.api,
      getComponentMasses: () => JSON.stringify({ error: 'no configuration selected' }),
    });
    expect(() => design().componentMasses()).toThrow(/no configuration selected/);
  });

  it('returns the mass rows when the kernel succeeds', () => {
    __setEngineForTests({ ...s.api, getComponentMasses: () => JSON.stringify([{ key: 'a', name: 'Nose' }]) });
    expect(design().componentMasses()).toHaveLength(1);
  });
});

describe('the engine must be initialized', () => {
  it('says so instead of throwing on null', () => {
    __setEngineForTests(null);
    expect(() => design()).toThrow(/not initialized/);
    vi.restoreAllMocks();
  });
});

describe('assertFiniteCurve — the curve is read in lockstep', () => {
  it('rejects arrays of differing length before the kernel indexes off the end', () => {
    expect(() => design().setMotorById('mount', motor({ masses: [0.024, 0.018] }))).toThrow(/C6.*length/i);
    expect(() => design().setMotorById('mount', motor({ thrusts: [0, 6] }))).toThrow(/C6.*length/i);
    expect(() => design().setMotorById('mount', motor({ times: [0, 1, 2, 3] }))).toThrow(/C6.*length/i);
  });

  it('rejects times that run backwards, which would subtract impulse', () => {
    expect(() => design().setMotorById('mount', motor({ times: [0, 2, 1] }))).toThrow(/C6.*backwards/i);
  });

  it('allows a repeated time, which is a legitimate step change in thrust', () => {
    expect(() => design().setMotorById('mount', motor({ times: [0, 1, 1] }))).not.toThrow();
  });
});

describe('a design does not outlive the engine that built it', () => {
  it('refuses every accessor by name once the engine has been reset', async () => {
    const d = design();
    expect(() => d.staticInfo()).not.toThrow(); // fine while its generation stands

    const { resetEngine, StaleDesignError } = await import('./openRocketEngine');
    resetEngine();

    // Typed and named, before the call crosses into TeaVM — the kernel would
    // also reject it, but only as an opaque message from inside the bundle.
    expect(() => d.staticInfo()).toThrow(StaleDesignError);
    expect(() => d.componentMasses()).toThrow(/reset/i);
    expect(() => d.aeroSweep()).toThrow(/reset/i);
    expect(() => d.setMotorById('mount', motor())).toThrow(/reset/i);
  });

  it('leaves a design built AFTER the reset working', async () => {
    const { resetEngine } = await import('./openRocketEngine');
    resetEngine();
    expect(() => design().staticInfo()).not.toThrow();
  });

  it('treats swapping the engine as a reset, since the handles mean nothing to it', () => {
    const d = design();
    __setEngineForTests({ ...s.api }); // a different engine object
    expect(() => d.staticInfo()).toThrow(/reset/i);
  });
});
