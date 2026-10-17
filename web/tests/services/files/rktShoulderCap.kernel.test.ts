// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { importRkt } from '../../../src/services/files/rktImport';
import { walkNodes } from '../../../src/tree/treeWalk';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  engine = await import('../../../src/engine/vendor/openrocket-engine.mjs' as string);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A `.rkt` shoulder opens open, as desktop 24.12 reads it.
 *
 * RockSim has no cap flag and neither RockSim handler sets one
 * (`NoseConeHandler`, `TransitionHandler`), and in the 24.12 jar
 * `Transition.setAftShoulderLength` and `setForeShoulderLength` store the
 * length and fire a change event, nothing more (`javap -c` shows no
 * `setAftShoulderCapped` call), so a shoulder desktop reads from a `.rkt` has
 * no cap disc. The upstream kernel's setter would turn the cap on, and
 * `ComponentFactory` sets the cap after the length from the node's key, so the
 * node must carry none and the kernel must report the shoulder open:
 * `getComponentFields` is the check, and `npm run check:fields` compares the
 * same part against desktop.
 */

const DOC =
  `<RockSimDocument><DesignInformation><RocketDesign><Name>Caps</Name><StageCount>1</StageCount><Stage3Parts>` +
  `<NoseCone><Name>n</Name><Len>100</Len><BaseDia>25</BaseDia><WallThickness>1</WallThickness>` +
  `<ShapeCode>1</ShapeCode><ShoulderOD>24</ShoulderOD><ShoulderLen>20</ShoulderLen></NoseCone>` +
  `<BodyTube><Name>b</Name><Len>200</Len><OD>25</OD><ID>23</ID></BodyTube>` +
  `<Transition><Name>t</Name><Len>50</Len><FrontDia>25</FrontDia><RearDia>20</RearDia>` +
  `<WallThickness>1</WallThickness><ShapeCode>0</ShapeCode>` +
  `<FrontShoulderDia>23</FrontShoulderDia><FrontShoulderLen>10</FrontShoulderLen>` +
  `<RearShoulderDia>18</RearShoulderDia><RearShoulderLen>10</RearShoulderLen></Transition>` +
  `</Stage3Parts></RocketDesign></DesignInformation></RockSimDocument>`;

const byType = (tree: RocketTree, type: string): ComponentNode =>
  [...walkNodes(tree.components)].find((n) => n.type === type)!;

function kernelFields(tree: RocketTree, node: ComponentNode): Record<string, unknown> {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const f = JSON.parse(engine.getComponentFields(handle, node.id) as string) as Record<string, unknown>;
  if (typeof f['error'] === 'string') throw new Error(f['error']);
  return f;
}

describe('a shoulder read from a .rkt', () => {
  const { tree } = importRkt(DOC);

  it('carries no cap key', () => {
    const nose = byType(tree, 'nosecone');
    const t = byType(tree, 'transition');
    expect(nose['shoulderLength']).toBeCloseTo(0.02, 9);
    expect(nose['shoulderCapped']).toBeUndefined();
    expect(t['foreShoulderLength']).toBeCloseTo(0.01, 9);
    expect(t['foreShoulderCapped']).toBeUndefined();
    expect(t['aftShoulderCapped']).toBeUndefined();
  });

  it('flies open in the kernel, as desktop 24.12 holds it', () => {
    const nose = kernelFields(tree, byType(tree, 'nosecone'));
    expect(nose['shoulderLength']).toBeCloseTo(0.02, 9);
    expect(nose['shoulderCapped']).toBe(false);
    const t = kernelFields(tree, byType(tree, 'transition'));
    expect(t['foreShoulderLength']).toBeCloseTo(0.01, 9);
    expect(t['foreShoulderCapped']).toBe(false);
    expect(t['aftShoulderCapped']).toBe(false);
  });
});
