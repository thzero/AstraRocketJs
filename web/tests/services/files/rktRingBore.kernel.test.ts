// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { importRkt } from '../../../src/services/files/rktImport';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine, walkTree } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A RockSim ring that states a bore and no outer diameter.
 *
 * `RingHandler` builds it detached, so `RadiusRingComponent.setInnerRadius`
 * finds a stored outer radius of 0, raises it to the bore and turns Automatic
 * off: desktop 24.12 opens this file with the ring at 30 mm outer and inner
 * radius. The kernel builds the imported node the same way, and the app has to
 * hold the radius it flies, not the 39 mm tube bore an automatic ring would take.
 */
const rkt = `<RockSimDocument><DesignInformation><RocketDesign><Name>Bore</Name><StageCount>1</StageCount>
<Stage3Parts>
<NoseCone><Name>N</Name><Len>100</Len><BaseDia>80</BaseDia></NoseCone>
<BodyTube><Name>B</Name><Len>300</Len><OD>80</OD><ID>78</ID><AttachedParts>
<Ring><Name>R</Name><UsageCode>0</UsageCode><Len>5</Len><ID>60</ID><Xb>10</Xb></Ring>
</AttachedParts></BodyTube>
</Stage3Parts></RocketDesign></DesignInformation></RockSimDocument>`;

describe('a .rkt centering ring with a bore and no outer diameter', () => {
  it('holds the outer radius the kernel flies', async () => {
    const tree = importRkt(rkt).tree;
    const ring = walkTree(tree).find((v) => v.node.name === 'R')!;
    const engine = await loadEngine();
    const k = kernelGeometry(engine, tree).get(ring.id)!;
    expect(k.outerRadius).toBeCloseTo(0.03, 12);
    expect(k.innerRadius).toBeCloseTo(0.03, 12);
    expect((ring.node as ComponentNode)['outerRadius']).toBeCloseTo(k.outerRadius!, 12);
    expect(ring.node['outerRadiusAuto']).not.toBe(true);
  });
});
