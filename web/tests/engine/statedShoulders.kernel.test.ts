import { describe, it, expect, vi } from 'vitest';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A stated shoulder flies as desktop opens it from a `.ork`.
 *
 * Desktop's loader sets a shoulder radius with clamping off (DocumentConfig,
 * "Transition:foreshoulderradius" and "Transition:aftshoulderradius", which a
 * nose cone's shoulder goes through too), so a file opens with the shoulder it
 * states, even past an automatic end that resolves only once its neighbors are
 * attached. A flipped nose cone is the exception: the loader reads
 * `<isflipped>` last, and NoseCone.setFlipped carries the shoulder to the base
 * through the clamping setter, so a flipped cone's shoulder is at most its
 * resolved base. Expected values are those two rules applied to the stated
 * numbers.
 */
type Fields = Record<string, unknown>;

async function build(components: unknown[]): Promise<(id: string) => Fields> {
  const engine = await loadEngine();
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify({ components: [{ type: 'stage', id: 's', children: components }] }));
  return (id) => JSON.parse(engine.getComponentFields(handle, id)) as Fields;
}

describe('stated shoulders', () => {
  it('keep their radius on a nose cone whose base follows the tube', async () => {
    const read = await build([
      {
        type: 'nosecone',
        id: 'n',
        shape: 'ogive',
        length: 0.15,
        aftRadiusAuto: true,
        shoulderRadius: 0.035,
        shoulderLength: 0.04,
        shoulderThickness: 0.002,
      },
      { type: 'bodytube', id: 't', length: 0.4, outerRadius: 0.04, thickness: 0.002 },
    ]);
    expect(read('n')).toMatchObject({ aftRadius: 0.04, shoulderRadius: 0.035, shoulderThickness: 0.002 });
  });

  it('keep a radius within the base on a flipped nose cone whose base follows the tube ahead', async () => {
    const read = await build([
      { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.15, aftRadius: 0.04, thickness: 0.002 },
      { type: 'bodytube', id: 't', length: 0.4, outerRadius: 0.04, thickness: 0.002 },
      {
        type: 'nosecone',
        id: 'tail',
        shape: 'ogive',
        length: 0.06,
        flipped: true,
        aftRadiusAuto: true,
        shoulderRadius: 0.038,
        shoulderLength: 0.03,
        shoulderThickness: 0.002,
      },
    ]);
    expect(read('tail')).toMatchObject({ aftRadius: 0.04, shoulderRadius: 0.038 });
  });

  it('are cut to the resolved base on a flipped nose cone', async () => {
    const read = await build([
      { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.15, aftRadius: 0.025, thickness: 0.002 },
      { type: 'bodytube', id: 't', length: 0.4, outerRadius: 0.025, thickness: 0.002 },
      {
        type: 'nosecone',
        id: 'auto',
        shape: 'ogive',
        length: 0.06,
        flipped: true,
        aftRadiusAuto: true,
        shoulderRadius: 0.03,
        shoulderLength: 0.03,
        shoulderThickness: 0.002,
      },
    ]);
    // The base follows the 25 mm tube ahead, so the 30 mm shoulder opens at 25.
    expect(read('auto')).toMatchObject({ aftRadius: 0.025, shoulderRadius: 0.025, shoulderThickness: 0.002 });
    const fixed = await build([
      { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.15, aftRadius: 0.03, thickness: 0.002 },
      { type: 'bodytube', id: 't', length: 0.4, outerRadius: 0.03, thickness: 0.002 },
      {
        type: 'nosecone',
        id: 'tail',
        shape: 'ogive',
        length: 0.06,
        flipped: true,
        aftRadius: 0.02,
        shoulderRadius: 0.024,
        shoulderLength: 0.03,
      },
    ]);
    expect(fixed('tail')).toMatchObject({ aftRadius: 0.02, shoulderRadius: 0.02 });
  });

  it('keep their radius on a transition end that settles below the default', async () => {
    const read = await build([
      { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.1, aftRadius: 0.02, thickness: 0.002 },
      { type: 'bodytube', id: 't', length: 0.3, outerRadius: 0.02, thickness: 0.001 },
      {
        type: 'transition',
        id: 'tr',
        length: 0.05,
        foreRadiusAuto: true,
        aftRadiusAuto: true,
        foreShoulderRadius: 0.019,
        foreShoulderLength: 0.02,
        aftShoulderRadius: 0.02,
        aftShoulderLength: 0.02,
      },
      { type: 'bodytube', id: 'tail', length: 0.2, outerRadius: 0.015, thickness: 0.001 },
    ]);
    // The aft end settles at 15 mm; the file states a 20 mm shoulder there, and
    // desktop flies the 20 mm the file states.
    expect(read('tr')).toMatchObject({
      foreRadius: 0.02,
      aftRadius: 0.015,
      foreShoulderRadius: 0.019,
      aftShoulderRadius: 0.02,
    });
  });
});
