import { beforeAll, describe, expect, it, vi } from 'vitest';
import { __setEngineForTests, type RocketTree } from '../../src/engine/openRocketEngine';
import { buildForImport } from '../../src/services/loadOrk';

/**
 * Opening a file is not flying it.
 *
 * The kernel refuses a self-intersecting freeform outline by name rather than
 * rolling it back to its default fin (engine-java/patches/LEDGER.md), which is
 * what the app wants everywhere a number is shown. On IMPORT that costs more than
 * it gains: the design that cannot be simulated is exactly the design somebody
 * needs to open in order to fix it, and this app can save such a file - the `.ork`
 * writer takes the tree, not the kernel's opinion of it. So the file opens, the tree
 * arrives as written, and the reason travels with it.
 *
 * Real kernel, so the recovery is tested against what the Java actually throws
 * rather than against a stub's idea of it.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

beforeAll(async () => {
  __setEngineForTests(await import('../../src/engine/vendor/openrocket-engine.mjs'));
});

const tree = (fin: Record<string, unknown>): RocketTree =>
  ({
    name: 'Imported',
    components: [
      {
        id: 'stage1',
        type: 'stage',
        children: [
          { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.013, thickness: 0.001, shape: 'ogive' },
          {
            id: 'tube',
            type: 'bodytube',
            length: 0.2,
            outerRadius: 0.013,
            thickness: 0.0005,
            children: [{ id: 'fins', type: 'freeformfinset', name: 'Aft fins', finCount: 3, thickness: 0.003, ...fin }],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const VALID = [
  [0, 0],
  [0.02, 0.05],
  [0.05, 0.05],
  [0.06, 0],
];
const BOWTIE = [
  [0, 0],
  [0.05, 0.05],
  [0, 0.05],
  [0.06, 0],
];

describe('buildForImport', () => {
  it('builds a good design with nothing to report', () => {
    const built = buildForImport(tree({ points: VALID }));
    expect(built.unbuildable).toBeUndefined();
    expect(built.design.staticInfo().length).toBeCloseTo(0.3, 9);
  });

  it('still opens a design whose fin outline the kernel refuses, and says why', () => {
    const t = tree({ points: BOWTIE });
    const built = buildForImport(t);
    expect(built.unbuildable).toMatch(/Aft fins/);
    expect(built.unbuildable).toMatch(/crosses or touches itself/);
    // The note has to be usable on its own: the banner is the other place the
    // same sentence shows up, and a user reading only the import notes should
    // know the design is open and what is blocked.
    expect(built.unbuildable).toMatch(/open so it can be fixed/);
    // The handle is a throwaway built from a repaired copy; the TREE is not
    // touched, so the outline the file stated is what the editor draws and what
    // a re-export writes.
    type Node = { type: string; children?: Node[]; points?: number[][] };
    const stage = (t.components as unknown as Node[])[0]!;
    expect(stage.children![1]!.children![0]!.points).toEqual(BOWTIE);
  });

  it('rethrows when the failure is not an outline the repair reaches', () => {
    const t = tree({ points: VALID });
    (t.components as unknown as { type: string }[])[0]!.type = 'notAComponent';
    expect(() => buildForImport(t)).toThrow(/notAComponent/);
  });
});
