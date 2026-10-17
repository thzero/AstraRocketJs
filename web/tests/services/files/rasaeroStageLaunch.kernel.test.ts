// @vitest-environment jsdom
// cspell:ignore sfins smount bmount
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  __setEngineForTests,
  OpenRocketDesign,
  type MotorSpec,
  type RocketTree,
} from '../../../src/engine/openRocketEngine';
import { exportCdx1 } from '../../../src/services/files/rasaeroExport';
import { cumulativeStageLaunch } from '../../../src/services/files/rasaero/stageLaunch';
import { RASAERO_STAGE_MASS_WARNING } from '../../../src/services/files/rasaero/simulation';
import { IN, LB } from '../../../src/services/files/rasaero/units';
import type { Keyed } from '../../../src/i18n/keyedError';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

type Engine = typeof import('../../../src/engine/vendor/openrocket-engine.mjs');
let engine: Engine;
beforeAll(async () => {
  engine = await import('../../../src/engine/vendor/openrocket-engine.mjs');
  __setEngineForTests(engine);
});

/**
 * RASAero's simulation block holds one launch weight and CG per stage, each
 * the stack from the sustainer through that stage with its motors: desktop's
 * `SimulationDTO` fills the sustainer's cell with stage 0 alone and booster
 * 1's with stages 0 and 1, from `MassCalculator` with only those stages
 * active. RASAero flies the sustainer after staging at its own cell, so a 0
 * there is a sustainer with no weight.
 *
 * The expected cells are the kernel's own: `staticInfo` of the built
 * configuration with the booster grounded, then with every stage on, read
 * straight off the handle.
 */

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

const TWO_STAGE = {
  name: 'Two',
  components: [
    {
      type: 'stage',
      id: 'sustainer',
      name: 'Sustainer',
      children: [
        { type: 'nosecone', id: 'nose', length: 0.1, aftRadius: 0.0127, thickness: 0.001, shape: 'ogive' },
        {
          type: 'bodytube',
          id: 'upper',
          length: 0.254,
          outerRadius: 0.0127,
          thickness: 0.0005,
          children: [
            {
              type: 'trapezoidfinset',
              id: 'sfins',
              finCount: 3,
              rootChord: 0.0508,
              tipChord: 0.0254,
              sweep: 0.0254,
              height: 0.0254,
              thickness: 0.003,
              position: { method: 'bottom', offset: 0 },
            },
            {
              type: 'innertube',
              id: 'smount',
              motorMount: true,
              length: 0.07,
              outerRadius: 0.0095,
              thickness: 0.0005,
              position: { method: 'bottom', offset: 0 },
            },
          ],
        },
      ],
    },
    {
      type: 'stage',
      id: 'booster',
      name: 'Booster',
      children: [
        {
          type: 'bodytube',
          id: 'lower',
          length: 0.2,
          outerRadius: 0.0127,
          thickness: 0.0005,
          children: [
            {
              type: 'trapezoidfinset',
              id: 'bfins',
              finCount: 3,
              rootChord: 0.0508,
              tipChord: 0.0254,
              sweep: 0.0254,
              height: 0.0381,
              thickness: 0.003,
              position: { method: 'bottom', offset: 0 },
            },
            {
              type: 'innertube',
              id: 'bmount',
              motorMount: true,
              length: 0.07,
              outerRadius: 0.0095,
              thickness: 0.0005,
              position: { method: 'bottom', offset: 0 },
            },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

/** The design built with a C6 in each mount. */
function build(): OpenRocketDesign {
  const r = OpenRocketDesign.buildTree(TWO_STAGE);
  r.setMotorById('smount', C6);
  r.setMotorById('bmount', C6);
  return r;
}

const cell = (xml: string, tag: string): number => {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  if (!m) throw new Error(`no <${tag}> in the file`);
  return Number(m[1]);
};

describe('the RASAero simulation block of a two-stage design', () => {
  it('writes each stage cell as the kernel weighs the stack through that stage', () => {
    // Expected: the handle itself, grounded and then whole.
    const expected = build();
    expected.setStageActiveById('booster', false);
    const sustainerOnly = expected.staticInfo();
    expected.setStageActiveById('booster', true);
    const whole = expected.staticInfo();
    expect(sustainerOnly.mass).toBeLessThan(whole.mass);
    expect(sustainerOnly.mass).toBeGreaterThan(0);

    const xml = exportCdx1({
      name: 'Two',
      tree: TWO_STAGE,
      stageLaunch: cumulativeStageLaunch(TWO_STAGE, build()),
      motors: { smount: { designation: 'C6' }, bmount: { designation: 'C6' } },
    });
    // The writer rounds to its own decimal places, so the comparison allows the
    // last place in pounds and inches.
    expect(cell(xml, 'SustainerLaunchWt')).toBeCloseTo(sustainerOnly.mass * LB, 3);
    expect(cell(xml, 'SustainerCG')).toBeCloseTo(sustainerOnly.cg * IN, 3);
    expect(cell(xml, 'Booster1LaunchWt')).toBeCloseTo(whole.mass * LB, 3);
    expect(cell(xml, 'Booster1CG')).toBeCloseTo(whole.cg * IN, 3);
    expect(cell(xml, 'Booster2LaunchWt')).toBe(0);
  });

  it('leaves the handle with every stage on', () => {
    const r = build();
    const whole = r.staticInfo();
    cumulativeStageLaunch(TWO_STAGE, r);
    expect(r.staticInfo().mass).toBe(whole.mass);
  });

  it('says so when the per-stage figures are missing rather than writing the whole mass somewhere', () => {
    const warnings: Keyed[] = [];
    const xml = exportCdx1({ name: 'Two', tree: TWO_STAGE, launchMassKg: 0.5, launchCgM: 0.2, warnings });
    expect(warnings).toEqual([RASAERO_STAGE_MASS_WARNING]);
    expect(cell(xml, 'SustainerLaunchWt')).toBe(0);
    expect(cell(xml, 'Booster1LaunchWt')).toBe(0);
  });
});
