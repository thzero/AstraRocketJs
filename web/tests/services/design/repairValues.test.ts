import { describe, it, expect } from 'vitest';
import { repairedText, repairValues } from '../../../src/services/design/repairValues';
import i18n from '../../../src/i18n';
import { SI_LIMITS } from '../../../src/prefs/entryValue';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * A design can arrive carrying a number the editor would never accept.
 *
 * The boxes clamp as you type, but a `.ork`, a share link, or a session
 * autosaved by a build without a given limit can hand the app a bulk density of
 * 1e9 kg/m³. A 200 mm tube of that weighs about 180 metric tons, so every mass, CG
 * and stability figure on screen would be nonsense with nothing saying why.
 */
const tree = (density: unknown): RocketTree =>
  ({
    name: 'T',
    components: [
      {
        type: 'stage',
        id: 's1',
        children: [
          {
            type: 'bodytube',
            id: 'tube',
            name: 'Body',
            length: 0.2,
            outerRadius: 0.0124,
            thickness: 0.0004,
            density,
            children: [{ type: 'centeringring', id: 'ring', name: 'Ring', length: 0.003, density }],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const tube = (t: RocketTree) =>
  (t.components[0] as unknown as { children: ComponentNode[] }).children[0] as unknown as Record<string, unknown>;
const ring = (t: RocketTree) =>
  (
    (t.components[0] as unknown as { children: ComponentNode[] }).children[0]!.children as ComponentNode[]
  )[0] as unknown as Record<string, unknown>;

const MAX = SI_LIMITS.density!.max!;

describe('repairValues', () => {
  it('pulls a density no material has back to the limit', () => {
    // Osmium, the densest thing there is, is about 22,590 kg/m³.
    const out = repairValues(tree(1e9));
    expect(tube(out.tree)['density']).toBe(MAX);
    expect(out.repaired).toContainEqual({ type: 'bodytube', name: 'Body', field: 'density', was: 1e9, now: MAX });
  });

  it('reaches parts nested inside other parts', () => {
    const out = repairValues(tree(1e9));
    expect(ring(out.tree)['density']).toBe(MAX);
    expect(out.repaired).toHaveLength(2);
  });

  it('carries the type and an empty name for a part with none, for the banner to label', () => {
    const t = tree(1e9);
    delete tube(t)['name'];
    expect(repairValues(t).repaired[0]).toMatchObject({ type: 'bodytube', name: '' });
  });

  it('leaves an ordinary density alone, and the tree with it', () => {
    // The same object back, so the ordinary load allocates nothing and cannot
    // be told from one that never ran this.
    const t = tree(680);
    const out = repairValues(t);
    expect(out.tree).toBe(t);
    expect(out.repaired).toEqual([]);
  });

  it('leaves the limit itself alone', () => {
    const out = repairValues(tree(MAX));
    expect(out.repaired).toEqual([]);
  });

  it('ignores a part with no density, and a density that is not a number', () => {
    expect(repairValues(tree(undefined)).repaired).toEqual([]);
    expect(repairValues(tree('heavy')).repaired).toEqual([]);
    expect(repairValues(tree(Infinity)).repaired).toEqual([]);
  });
});

/**
 * The banner line names an unnamed part by its translated type, as every other
 * message does, not by the raw key ("bodytube").
 */
describe('repairedText', () => {
  it('translates the type of an unnamed part', () => {
    const t = i18n.getFixedT('en');
    const line = repairedText({ type: 'bodytube', name: '', field: 'density', was: 1e9, now: MAX }, t);
    expect(line.startsWith(`${t('part.bodytube')}:`)).toBe(true);
    expect(
      repairedText({ type: 'bodytube', name: 'Body', field: 'density', was: 1e9, now: MAX }, t).startsWith('Body:'),
    ).toBe(true);
  });
});
