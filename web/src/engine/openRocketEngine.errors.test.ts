import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EngineCallError,
  OpenRocketDesign,
  StaleDesignError,
  __setEngineForTests,
  resetEngine,
  type RocketTree,
} from './openRocketEngine';

/**
 * The typed error the wrapper raises for kernel calls that CANNOT return an
 * `{error}` envelope: `buildRocket`, `setMotorById`, `setMotorIgnitionById`,
 * the flag setters and `getWorstThetaDeg` (see engine-java/README.md, "What
 * the void and primitive exports do on failure").
 *
 * Stubbed on purpose. The real-kernel files assert WHAT the Java rejects; this
 * one asserts the SHAPE the wrapper gives a rejection, which does not depend
 * on the physics and must hold for a failure the kernel has never seen.
 */

const stubApi = (over: Record<string, unknown> = {}) => ({
  buildRocket: () => 1,
  reset: () => undefined,
  setMotorById: () => undefined,
  setMotorIgnitionById: () => undefined,
  setRogersModifiedBarrowman: () => undefined,
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
  // `callEngine` runs the handle getter INSIDE its try, so the generation
  // check throws where a kernel failure would. The wrapper must let that
  // typed error through untouched rather than burying it in an EngineCallError.
  it('for a void export', () => {
    const design = OpenRocketDesign.buildTree(TREE);
    resetEngine();
    let caught: unknown;
    try {
      design.setRogersModifiedBarrowman(true);
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
