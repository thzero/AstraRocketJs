import { describe, expect, it, vi } from 'vitest';
import { defaultNode } from '../../../src/services/design/treeEdit';
import { defaultMaterialPatch } from '../../../src/services/design/materialSlots';
import type { ComponentNode, ComponentType } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { loadEngine } from '../../testing/kernelGeometry';

/** The TeaVM bundle, which is untyped. */
type Engine = Awaited<ReturnType<typeof loadEngine>>;

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A part added from ＋ Add, with no preference set, is the part desktop
 * OpenRocket creates: its constructor's dimensions, material and automatic
 * settings, as the kernel builds them.
 *
 * The seed states those values on the node so the panel shows them. A seed that
 * drifts from the constructor (a rail button stamped Cardboard when
 * `RailButton()` is Delrin) would show and save one part and fly another.
 */

const seeded = (type: ComponentType): ComponentNode =>
  ({ ...defaultNode(type), ...defaultMaterialPatch(type, {}), id: 'probe' }) as ComponentNode;

/** The part inside a body tube of the given length, inside a stage. */
const design = (probe: ComponentNode, tubeLength = 0.5): unknown => ({
  components: [
    {
      type: 'stage',
      id: 'st',
      children: [
        { type: 'nosecone', id: 'nose', length: 0.1, aftRadius: 0.02 },
        { type: 'bodytube', id: 'tube', outerRadius: 0.02, length: tubeLength, children: [probe] },
      ],
    },
  ],
});

/** The probe's componentInfo in a fresh build. */
const infoOf = (engine: Engine, tree: unknown): Record<string, number | string | undefined> => {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
  expect(info.error).toBeUndefined();
  return info;
};

describe('a new part from the add list', () => {
  it('is a rail button of desktop dimensions and material', async () => {
    const engine = await loadEngine();
    const mass = infoOf(engine, design(seeded('railbutton'))).mass as number;
    expect(mass).toBeGreaterThan(0);
    // A bare node is RailButton() as the kernel constructs it.
    expect(mass).toBeCloseTo(
      infoOf(engine, design({ type: 'railbutton', id: 'probe' } as ComponentNode)).mass as number,
      12,
    );
  });

  it('is a shock cord whose cord follows the rocket, as on desktop', async () => {
    const engine = await loadEngine();
    const short = infoOf(engine, design(seeded('shockcord'), 0.5));
    const long = infoOf(engine, design(seeded('shockcord'), 1.0));
    // The kernel's figure, not the stored one, and it grows with the rocket.
    expect(short.cordLength).not.toBeCloseTo(defaultNode('shockcord')['cordLength'] as number, 6);
    expect(long.cordLength as number).toBeGreaterThan(short.cordLength as number);
    expect(long.mass as number).toBeGreaterThan(short.mass as number);
  });

  it('is a booster that builds beside its tube and flies two copies', async () => {
    const engine = await loadEngine();
    const booster = seeded('parallelstage');
    const info = infoOf(engine, design(booster));
    expect(info.sectionMass as number).toBeGreaterThan(0);
    const handle = engine.buildRocket(JSON.stringify(design(booster)));
    const stat = JSON.parse(engine.getStaticInfo(handle));
    expect(stat.error).toBeUndefined();
    expect(booster['instanceCount']).toBe(2);
  });
});
