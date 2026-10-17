// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
import { exportRkt } from '../../../src/services/files/rktExport';
import { importRkt } from '../../../src/services/files/rktImport';
import { walkNodes } from '../../../src/tree/treeWalk';
import { specToTree, type RocketSpec } from '../../testing/specTree';
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
 * A file's fin cant comes in as the cant the kernel flies.
 *
 * `FinSet.setCantAngle` clamps to plus or minus 15 degrees, so a file stating
 * more flies the clamp. The panel shows the stored value, so the import has to
 * store the clamp too. The expected cant is the kernel's own, read back from
 * the imported design (`getComponentFields`).
 */

const spec = {
  noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 },
  bodyTube: { length: 0.3, outerRadius: 0.013, thickness: 0.0005 },
  fins: { count: 3, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.04, thickness: 0.003 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
} as unknown as RocketSpec;

/** The design with its fin set given a small cant, so both writers state one. */
function canted(): RocketTree {
  const { tree } = specToTree(spec);
  for (const n of walkNodes(tree.components)) if (n.type === 'trapezoidfinset') n['cant'] = 0.01;
  return tree;
}

const finOf = (tree: RocketTree): ComponentNode =>
  [...walkNodes(tree.components)].find((n) => n.type === 'trapezoidfinset')!;

/** The cant the kernel holds for the imported fin set, radians. */
function kernelCant(tree: RocketTree): number {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const fields = JSON.parse(engine.getComponentFields(handle, finOf(tree).id)) as { cant: number };
  return fields.cant;
}

const storedCant = (tree: RocketTree): number => {
  const v = finOf(tree)['cant'];
  return typeof v === 'number' ? v : 0;
};

const DEGREES = [-40, -15.5, -15, -7.5, 0, 3, 15, 15.01, 20, 89];

describe('a fin cant read from a file', () => {
  it.each(DEGREES)('in a .ork at %s degrees is the cant the kernel flies', (deg) => {
    const xml = exportOrk({ name: 'Cant', tree: canted() }).replace(/<cant>[^<]*<\/cant>/, `<cant>${deg}</cant>`);
    expect(xml).toContain(`<cant>${deg}</cant>`);
    const tree = importOrk(xml).tree;
    expect(storedCant(tree)).toBeCloseTo(kernelCant(tree), 12);
  });

  it.each(DEGREES)('in a .rkt at %s degrees is the cant the kernel flies', (deg) => {
    const { xml } = exportRkt('Cant', canted());
    const edited = xml.replace(/<CantAngle>[^<]*<\/CantAngle>/, `<CantAngle>${deg}</CantAngle>`);
    expect(edited).toContain(`<CantAngle>${deg}</CantAngle>`);
    const tree = importRkt(edited).tree;
    expect(storedCant(tree)).toBeCloseTo(kernelCant(tree), 12);
  });
});
