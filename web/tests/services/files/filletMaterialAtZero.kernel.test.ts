// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
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
 * Desktop's FinSetSaver writes a fin set's fillet material whatever its fillet
 * radius, and the loader keeps it at a 0 radius (a fillet turned back on is in
 * that material). A bundled example ships that way: `npm run check:fields`
 * compares the same part with desktop, and this holds the kernel to it.
 */

const ORK =
  `<openrocket><rocket><name>N</name><subcomponents><stage><name>S</name><subcomponents>` +
  `<bodytube><name>B</name><length>0.3</length><radius>0.02</radius><thickness>0.0015</thickness><subcomponents>` +
  `<trapezoidfinset><name>F</name><fincount>3</fincount><rootchord>0.05</rootchord><tipchord>0.03</tipchord>` +
  `<sweeplength>0.02</sweeplength><height>0.04</height><thickness>0.003</thickness>` +
  `<filletradius>0.0</filletradius><filletmaterial type="bulk" density="1250.0" group="Plastics">PETG - 100% infill</filletmaterial>` +
  `</trapezoidfinset></subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;

const finsOf = (tree: RocketTree): ComponentNode =>
  [...walkNodes(tree.components)].find((n) => n.type === 'trapezoidfinset')!;

function fields(tree: RocketTree, node: ComponentNode): Record<string, unknown> {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const f = JSON.parse(engine.getComponentFields(handle, node.id) as string) as Record<string, unknown>;
  if (typeof f['error'] === 'string') throw new Error(f['error']);
  return f;
}

describe('a fillet material on a fin set with no fillet radius', () => {
  it('survives the import, flies in the kernel, and is written back', () => {
    const { tree } = importOrk(ORK);
    const fins = finsOf(tree);
    expect(fins['filletRadius']).toBeUndefined();
    expect(fins['filletDensity']).toBe(1250);
    expect(fins['filletMaterialName']).toBe('PETG - 100% infill');

    const kernel = fields(tree, fins);
    expect(kernel['filletRadius']).toBe(0);
    expect(kernel['filletDensity']).toBeCloseTo(1250, 9);
    expect(kernel['filletMaterialName']).toBe('PETG - 100% infill');

    const xml = exportOrk({ name: 'N', tree });
    expect(xml).toContain(
      '<filletmaterial type="bulk" density="1250" group="Plastics">PETG - 100% infill</filletmaterial>',
    );
  });
});
