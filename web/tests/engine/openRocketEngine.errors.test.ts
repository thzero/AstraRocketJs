import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EngineCallError,
  OpenRocketDesign,
  PLUGGED_DELAY,
  StaleDesignError,
  __setEngineForTests,
  resetEngine,
  type MotorSpec,
  type RocketTree,
} from '../../src/engine/openRocketEngine';
import { KeyedError } from '../../src/i18n/keyedError';

/**
 * The typed error the wrapper raises for kernel calls that cannot return an
 * `{error}` envelope: `buildRocket`, `setMotorById`, `setMotorIgnitionById`,
 * the flag setters and `getWorstThetaDeg` (see engine-java/README.md, "What
 * the void and primitive exports do on failure").
 *
 * Stubbed on purpose. The real-kernel files assert what the Java rejects; this
 * one asserts the shape the wrapper gives a rejection, which does not depend
 * on the physics and must hold for a failure the kernel has never seen.
 */

const stubApi = (over: Record<string, unknown> = {}) => ({
  buildRocket: () => 1,
  reset: () => undefined,
  setMotorById: () => undefined,
  setMotorIgnitionById: () => undefined,
  getWorstThetaDeg: () => 0,
  getStaticInfo: () => JSON.stringify({ length: 1 }),
  ...over,
});

const TREE = { components: [] } as unknown as RocketTree;

beforeEach(() => __setEngineForTests(stubApi()));
afterEach(() => __setEngineForTests(null));

describe('EngineCallError names the call and keeps the cause', () => {
  it('a facade call that throws surfaces as EngineCallError with the operation and the cause text', () => {
    __setEngineForTests(
      stubApi({
        buildRocket: () => {
          throw new Error('Component id "x" is not a motor mount');
        },
      }),
    );
    let caught: unknown;
    try {
      OpenRocketDesign.buildTree(TREE);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineCallError);
    const err = caught as EngineCallError;
    expect(err.name).toBe('EngineCallError');
    expect(err.operation).toBe('buildRocket');
    expect(err.message).toContain('buildRocket');
    expect(err.message).toContain('Component id "x" is not a motor mount');
    expect(err.engineCause).toBeInstanceOf(Error);
  });

  it('a non-Error throw (what a WASM trap looks like) is still wrapped, with its text', () => {
    __setEngineForTests(
      stubApi({
        getWorstThetaDeg: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- what TeaVM throws: a bare string
          throw 'unreachable executed';
        },
      }),
    );
    const design = OpenRocketDesign.buildTree(TREE);
    expect(() => design.worstThetaDeg()).toThrow(EngineCallError);
    expect(() => design.worstThetaDeg()).toThrow(/getWorstThetaDeg.*unreachable executed/);
  });

  it('setMotorIgnitionById refuses a non-finite delay before the kernel sees it, naming delayS', () => {
    let reached = false;
    __setEngineForTests(
      stubApi({
        setMotorIgnitionById: () => {
          reached = true;
        },
      }),
    );
    const design = OpenRocketDesign.buildTree(TREE);
    for (const bad of [Infinity, -Infinity, NaN]) {
      let caught: unknown;
      try {
        design.setMotorIgnitionById('mount', 'launch', bad);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(EngineCallError);
      expect((caught as EngineCallError).operation).toBe('setMotorIgnitionById');
      expect((caught as Error).message).toMatch(/delayS/);
    }
    expect(reached).toBe(false);
    // A finite delay still goes through.
    design.setMotorIgnitionById('mount', 'launch', 1.5);
    expect(reached).toBe(true);
  });
});

describe('a stale handle is reported as StaleDesignError, never re-wrapped', () => {
  // `callEngine` runs the handle getter inside its try, so the generation
  // check throws where a kernel failure would. The wrapper must let that
  // typed error through untouched rather than burying it in an EngineCallError.
  it('for a void export', () => {
    const design = OpenRocketDesign.buildTree(TREE);
    resetEngine();
    let caught: unknown;
    try {
      design.setMotorIgnitionById('mount', 'launch', 1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StaleDesignError);
    expect(caught).not.toBeInstanceOf(EngineCallError);
  });

  it('for a primitive export', () => {
    const design = OpenRocketDesign.buildTree(TREE);
    resetEngine();
    expect(() => design.worstThetaDeg()).toThrow(StaleDesignError);
    expect(() => design.worstThetaDeg()).not.toThrow(EngineCallError);
  });

  it('for the ignition setter, ahead of the delay check', () => {
    const design = OpenRocketDesign.buildTree(TREE);
    resetEngine();
    // Both a stale handle and a bad delay: the delay check runs first (it needs
    // no handle), so this is the one case where EngineCallError wins.
    expect(() => design.setMotorIgnitionById('mount', 'launch', Infinity)).toThrow(EngineCallError);
    expect(() => design.setMotorIgnitionById('mount', 'launch', 0)).toThrow(StaleDesignError);
  });
});

describe('the envelope readers name their operation too', () => {
  const design = () => OpenRocketDesign.buildTree(TREE);

  it('a kernel {error} envelope surfaces as EngineCallError carrying the operation', () => {
    __setEngineForTests(stubApi({ getStaticInfo: () => JSON.stringify({ error: 'no components' }) }));
    let caught: unknown;
    try {
      design().staticInfo();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineCallError);
    expect((caught as EngineCallError).operation).toBe('staticInfo');
    expect((caught as Error).message).toContain('no components');
  });

  it('a reply that is not JSON at all names the operation instead of a bare SyntaxError', () => {
    __setEngineForTests(stubApi({ getStaticInfo: () => 'Exception in thread "main"' }));
    expect(() => design().staticInfo()).toThrow(EngineCallError);
    expect(() => design().staticInfo()).toThrow(/staticInfo/);
    expect(() => design().staticInfo()).toThrow(/not JSON/);
  });

  it('a trap out of the call itself (not an envelope) is wrapped the same way', () => {
    __setEngineForTests(
      stubApi({
        getComponentMasses: () => {
          throw new Error('unreachable executed');
        },
      }),
    );
    let caught: unknown;
    try {
      design().componentMasses();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineCallError);
    expect((caught as EngineCallError).operation).toBe('componentMasses');
    expect((caught as EngineCallError).message).toContain('unreachable executed');
  });

  it('componentMasses still rejects an {error} envelope pretending to be an array', () => {
    __setEngineForTests(stubApi({ getComponentMasses: () => JSON.stringify({ error: 'kaput' }) }));
    expect(() => design().componentMasses()).toThrow(/componentMasses.*kaput/);
  });

  it('sets the standard Error.cause as well as engineCause', () => {
    const inner = new Error('deep');
    __setEngineForTests(
      stubApi({
        getWorstThetaDeg: () => {
          throw inner;
        },
      }),
    );
    let caught: unknown;
    try {
      design().worstThetaDeg();
    } catch (e) {
      caught = e;
    }
    expect((caught as EngineCallError).cause).toBe(inner);
    expect((caught as EngineCallError).engineCause).toBe(inner);
  });

  it('resetEngine goes through callEngine', () => {
    __setEngineForTests(
      stubApi({
        reset: () => {
          throw new Error('trap');
        },
      }),
    );
    expect(() => resetEngine()).toThrow(EngineCallError);
    expect(() => resetEngine()).toThrow(/reset/);
  });
});

describe('the motor curve guard throws keyed errors', () => {
  const GOOD: MotorSpec = {
    designation: 'F67',
    diameter: 0.029,
    length: 0.124,
    times: [0, 0.5, 1],
    thrusts: [0, 80, 0],
    masses: [0.1, 0.08, 0.06],
    cgX: 0.062,
    ejectionDelay: 6,
  };

  /** What `setMotorById` throws for `motor`, or undefined if it seats. */
  const refusal = (motor: MotorSpec): unknown => {
    try {
      OpenRocketDesign.buildTree(TREE).setMotorById('mount', motor);
    } catch (e) {
      return e;
    }
    return undefined;
  };

  it('seats a sound curve', () => {
    expect(refusal(GOOD)).toBeUndefined();
  });

  it.each([
    ['notFinite', { length: NaN }],
    ['size', { diameter: 0 }],
    ['nonFinite', { masses: [0.1, NaN, 0.06] }],
    ['lengths', { masses: [0.1, 0.08] }],
    ['backwards', { times: [0, 1, 0.5] }],
    ['negativeMass', { masses: [0.1, 0.05, -0.01] }],
    ['noMass', { masses: [0, 0, 0] }],
  ] as [string, Partial<MotorSpec>][])('%s carries its key and the motor, not an English sentence', (name, patch) => {
    const e = refusal({ ...GOOD, ...patch });
    expect(e).toBeInstanceOf(KeyedError);
    const k = e as KeyedError;
    expect(k.key).toBe(`errors.motorCurve.${name}`);
    expect(k.values?.motor).toBe('F67');
    // The English text stays readable for a log.
    expect(k.message).toContain('F67');
  });

  it('names the scalar that is not finite as a keyed value', () => {
    const e = refusal({ ...GOOD, cgX: Infinity }) as KeyedError;
    expect(e.values?.what).toEqual({ key: 'errors.motorCurve.whatCg' });
    expect(e.message).toContain('center of gravity');
  });

  it('accepts a plugged motor, whose delay is infinite', () => {
    expect(refusal({ ...GOOD, ejectionDelay: PLUGGED_DELAY })).toBeUndefined();
  });
});
