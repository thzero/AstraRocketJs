// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { importOrk } from '../../../src/services/files/orkFile';
import { importRkt } from '../../../src/services/files/rktImport';
import { walkNodes } from '../../../src/tree/treeWalk';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';
import { noteTexts } from '../../testing/importNotes';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A freeform fin set whose outline the file does not give is said so.
 *
 * Desktop warns for each `<point>` it cannot read ("Illegal fin points
 * specification, ignoring.", FinSetPointHandler) and for each RockSim pair
 * that is not two numbers ("Invalid fin point pair.", "Fin point not in
 * numeric format.", rocksim FinSetHandler). With fewer than three usable
 * points the node carries no outline and the kernel flies its default one:
 * the expected outline is the kernel's own, read back for a freeform fin set
 * built with no points at all.
 */

const ork = (finpoints: string): string =>
  `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents><stage><name>S</name><subcomponents>` +
  `<bodytube><name>Body</name><length>0.3</length><radius>0.012</radius><subcomponents>` +
  `<freeformfinset><name>Fins</name><fincount>3</fincount><thickness>0.003</thickness>${finpoints}</freeformfinset>` +
  `</subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;

const rkt = (pointList: string): string =>
  `<RockSimDocument><DesignInformation><RocketDesign><Name>T</Name><StageCount>1</StageCount><Stage3Parts>` +
  `<BodyTube><Name>Body</Name><Len>300</Len><OD>24</OD><ID>23</ID><AttachedParts>` +
  `<FinSet><Name>Fins</Name><ShapeCode>2</ShapeCode><FinCount>3</FinCount><Thickness>3</Thickness>` +
  `<PointList>${pointList}</PointList></FinSet>` +
  `</AttachedParts></BodyTube></Stage3Parts></RocketDesign></DesignInformation></RockSimDocument>`;

const finOf = (tree: RocketTree): ComponentNode =>
  [...walkNodes(tree.components)].find((n) => n.type === 'freeformfinset')!;

/** The outline the kernel flies for the design's freeform fin set. */
const kernelOutline = (tree: RocketTree) => kernelGeometry(engine, tree).get(finOf(tree).id!)!.finPoints;

/** Two outlines agree point by point, to floating-point noise. */
type Outline = readonly (readonly (number | null)[])[] | undefined;
const expectOutline = (got: Outline, want: Outline) => {
  expect(got).toBeDefined();
  expect(want).toBeDefined();
  expect(got).toHaveLength(want!.length);
  got!.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(want![i]![0]!, 12);
    expect(p[1]).toBeCloseTo(want![i]![1]!, 12);
  });
};

/** The kernel's default freeform outline: a fin set built with no points. */
const defaultOutline = () => {
  const { tree } = importOrk(ork(''));
  delete finOf(tree)['points'];
  return kernelOutline(tree);
};

describe('a freeform fin set with fewer than three usable points', () => {
  it('in a .ork is noted and flies the default outline', () => {
    const res = importOrk(ork('<finpoints><point x="0" y="0"/><point x="0.05" y="0"/></finpoints>'));
    expect(finOf(res.tree)['points']).toBeUndefined();
    expect(noteTexts(res.notes)).toContain(
      'Fins: the file gives fewer than three usable outline points, so the default freeform outline is used.',
    );
    expectOutline(kernelOutline(res.tree), defaultOutline());
  });

  it('in a .rkt is noted and flies the default outline', () => {
    const res = importRkt(rkt('50,0|0,0|'));
    expect(finOf(res.tree)['points']).toBeUndefined();
    expect(noteTexts(res.notes)).toContain(
      'Fins: the file gives fewer than three usable outline points, so the default freeform outline is used.',
    );
    expectOutline(kernelOutline(res.tree), defaultOutline());
  });
});

describe('a freeform outline point the file states badly', () => {
  it('in a .ork is dropped and counted', () => {
    const res = importOrk(
      ork(
        '<finpoints><point x="0" y="0"/><point x="0.02" y="0.05"/><point x="0.05"/><point x="abc" y="0.05"/>' +
          '<point x="0.06" y="0"/></finpoints>',
      ),
    );
    expect(finOf(res.tree)['points']).toEqual([
      [0, 0],
      [0.02, 0.05],
      [0.06, 0],
    ]);
    expect(noteTexts(res.notes)).toContain('Fins: 2 outline points in the file could not be read and were ignored.');
  });

  it('in a .rkt is dropped and counted', () => {
    const res = importRkt(rkt('60,0|50|abc,50|20,50|0,0|'));
    expect(finOf(res.tree)['points']).toEqual([
      [0, 0],
      [0.02, 0.05],
      [0.06, 0],
    ]);
    expect(noteTexts(res.notes)).toContain('Fins: 2 outline points in the file could not be read and were ignored.');
  });

  it('is not counted for a repeated origin, which RockSim writes and desktop skips', () => {
    const res = importRkt(rkt('60,0|20,50|0,0|0,0|'));
    expect(finOf(res.tree)['points']).toHaveLength(3);
    expect(noteTexts(res.notes).some((n) => n.includes('outline points'))).toBe(false);
  });
});
