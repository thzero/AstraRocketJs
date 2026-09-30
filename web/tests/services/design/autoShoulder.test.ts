import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { syncAutoShoulders } from '../../../src/services/design/autoShoulder';
import { defaultNode, updateNode } from '../../../src/services/design/treeEdit';

/**
 * Shoulders that follow the tube they plug into.
 *
 * The thing these have to pin down is not the arithmetic, which is one
 * subtraction, but WHICH number gets subtracted: the bore at the END a shoulder
 * plugs into, on the neighbor it actually meets. A transition's two ends are
 * different sizes, so asking for "the tube's bore" without saying which end
 * gives a boat tail's fore shoulder the aft radius and no test notices, because
 * on a plain body tube the two answers are the same.
 *
 * The other half is what must NOT happen: absent already means "this part has
 * no shoulder", so nothing may be derived without the explicit flag, or every
 * design ever imported grows a shoulder and changes mass.
 */
const stage = (children: ComponentNode[]) =>
  ({ name: 'T', components: [{ type: 'stage', name: 'S', children }] }) as unknown as RocketTree;

const chainOf = (tree: RocketTree) => (tree.components[0] as unknown as { children: ComponentNode[] }).children;

const tube = (id: string, outerRadius: number, thickness: number) =>
  ({ type: 'bodytube', id, length: 0.3, outerRadius, thickness }) as unknown as ComponentNode;

describe('syncAutoShoulders', () => {
  it('gives a nose cone the bore of the tube behind it', () => {
    const t = syncAutoShoulders(
      stage([
        { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.013, shoulderAuto: true } as unknown as ComponentNode,
        tube('b', 0.013, 0.001),
      ]),
    );
    expect(chainOf(t)[0]!['shoulderRadius']).toBeCloseTo(0.012, 9);
  });

  it('reads the END the shoulder plugs into, not the neighbor wholesale', () => {
    // The next part is a transition: 20 mm at the fore end it presents to the
    // cone, 10 mm at the other. A shoulder built to the far end fits nothing.
    const t = syncAutoShoulders(
      stage([
        { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.02, shoulderAuto: true } as unknown as ComponentNode,
        {
          type: 'transition',
          id: 'tr',
          length: 0.05,
          foreRadius: 0.02,
          aftRadius: 0.01,
          thickness: 0.001,
        } as unknown as ComponentNode,
      ]),
    );
    expect(chainOf(t)[0]!['shoulderRadius']).toBeCloseTo(0.019, 9);
  });

  it('takes a transition fore shoulder from the part above and aft from the part below', () => {
    const t = syncAutoShoulders(
      stage([
        tube('a', 0.013, 0.001),
        {
          type: 'transition',
          id: 'tr',
          length: 0.05,
          foreRadius: 0.013,
          aftRadius: 0.009,
          thickness: 0.0005,
          foreShoulderAuto: true,
          aftShoulderAuto: true,
        } as unknown as ComponentNode,
        tube('b', 0.009, 0.0005),
      ]),
    );
    const tr = chainOf(t)[1]!;
    expect(tr['foreShoulderRadius']).toBeCloseTo(0.012, 9);
    expect(tr['aftShoulderRadius']).toBeCloseTo(0.0085, 9);
  });

  it('touches nothing without the flag, which is every imported design', () => {
    const before = stage([
      { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.013 } as unknown as ComponentNode,
      tube('b', 0.013, 0.001),
    ]);
    const after = syncAutoShoulders(before);
    // Same object: an edit elsewhere must not invalidate memos either.
    expect(after).toBe(before);
    expect(chainOf(after)[0]!['shoulderRadius']).toBeUndefined();
  });

  it('leaves a typed value alone when there is no neighbor to follow yet', () => {
    const t = syncAutoShoulders(
      stage([
        {
          type: 'nosecone',
          id: 'n',
          length: 0.1,
          aftRadius: 0.013,
          shoulderRadius: 0.011,
          shoulderAuto: true,
        } as unknown as ComponentNode,
      ]),
    );
    expect(chainOf(t)[0]!['shoulderRadius']).toBeCloseTo(0.011, 9);
  });

  it('follows the tube through an edit, and stops the moment the flag is cleared', () => {
    let t = syncAutoShoulders(
      stage([
        { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.013, shoulderAuto: true } as unknown as ComponentNode,
        tube('b', 0.013, 0.001),
      ]),
    );
    // Widening the tube's wall narrows the bore, and the cone follows it in the
    // same edit - `updateNode` is where the resolver runs.
    t = updateNode(t, 'b', { thickness: 0.002 });
    expect(chainOf(t)[0]!['shoulderRadius']).toBeCloseTo(0.011, 9);

    t = updateNode(t, 'n', { shoulderAuto: false });
    t = updateNode(t, 'b', { thickness: 0.003 });
    expect(chainOf(t)[0]!['shoulderRadius']).toBeCloseTo(0.011, 9); // pinned
  });

  it('is on for a part created here and absent from the file reader', () => {
    expect(defaultNode('nosecone')['shoulderAuto']).toBe(true);
    expect(defaultNode('transition')['foreShoulderAuto']).toBe(true);
    expect(defaultNode('transition')['aftShoulderAuto']).toBe(true);
    // A body tube has no shoulder to follow anything with.
    expect(defaultNode('bodytube')['shoulderAuto']).toBeUndefined();
  });
});
