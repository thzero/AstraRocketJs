import { describe, it, expect, vi } from 'vitest';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A stage flies its own mass and CG overrides.
 *
 * A stage is built by the bridge's buildRocket, not by ComponentFactory.create,
 * so it has to apply the overrides itself. Desktop applies them when it opens
 * the file (the `fields` step of `npm run audit` compares the two); here the
 * kernel has to hold them and its mass breakdown has to fly them: with the
 * subcomponents covered, the stage's mass is the stated mass, whatever is
 * inside it.
 */
const design = {
  components: [
    {
      type: 'stage',
      id: 'sustainer',
      name: 'Sustainer',
      overrideMass: 1.36,
      overrideCGX: 0.3,
      overrideSubcomponentsMass: true,
      overrideSubcomponentsCG: true,
      children: [
        { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.15, aftRadius: 0.03, thickness: 0.002 },
        { type: 'bodytube', id: 't', length: 0.5, outerRadius: 0.03, thickness: 0.001 },
      ],
    },
    {
      type: 'stage',
      id: 'booster',
      name: 'Booster',
      children: [{ type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.03, thickness: 0.001 }],
    },
  ],
};

describe('stage overrides', () => {
  it('reach the kernel and fly', async () => {
    const engine = await loadEngine();
    engine.reset();
    const handle = engine.buildRocket(JSON.stringify(design));
    const fields = JSON.parse(engine.getComponentFields(handle, 'sustainer')) as Record<string, unknown>;
    expect(fields).toMatchObject({
      massOverridden: true,
      overrideMass: 1.36,
      cgOverridden: true,
      overrideCGX: 0.3,
      overrideSubcomponentsMass: true,
      overrideSubcomponentsCG: true,
    });
    // The booster states none and keeps none.
    expect(JSON.parse(engine.getComponentFields(handle, 'booster'))).toMatchObject({
      massOverridden: false,
      cgOverridden: false,
    });
    const masses = JSON.parse(engine.getComponentMasses(handle)) as { name: string; mass: number; cg: number }[];
    const sustainer = masses.find((m) => m.name === 'Sustainer');
    expect(sustainer?.mass).toBeCloseTo(1.36, 9);
  });

  it("put a lower stage's CG from that stage's own front", async () => {
    const engine = await loadEngine();
    engine.reset();
    const [upper, lower] = design.components;
    const handle = engine.buildRocket(
      JSON.stringify({
        components: [
          {
            ...upper,
            overrideMass: undefined,
            overrideCGX: undefined,
            overrideSubcomponentsMass: false,
            overrideSubcomponentsCG: false,
          },
          {
            ...lower,
            overrideMass: 0.3,
            overrideCGX: 0.1,
            overrideSubcomponentsMass: true,
            overrideSubcomponentsCG: true,
          },
        ],
      }),
    );
    // OpenRocket states a part's CG override from the part's front, and
    // getComponentInfo gives where that front sits from the nose.
    const front = (JSON.parse(engine.getComponentInfo(handle, 'booster')) as { positionX: number }).positionX;
    const masses = JSON.parse(engine.getComponentMasses(handle)) as { name: string; mass: number; cg: number }[];
    const booster = masses.find((m) => m.name === 'Booster');
    expect(front).toBeGreaterThan(0);
    expect(booster?.mass).toBeCloseTo(0.3, 9);
    expect(booster?.cg).toBeCloseTo(front + 0.1, 9);
  });
});
