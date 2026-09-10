import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../engine/openRocketEngine';
import { stageParts, finSetPositions } from './reportModel';

const node = (o: object): ComponentNode => o as unknown as ComponentNode;

const stage = node({
  type: 'stage',
  name: 'Sustainer',
  children: [
    node({ type: 'nosecone', id: 'nose', name: 'Nose', length: 0.1, outerRadius: 0.012 }),
    node({
      type: 'bodytube',
      id: 'body',
      name: 'Body',
      length: 0.2,
      outerRadius: 0.012,
      thickness: 0.0005,
      children: [node({ type: 'trapezoidfinset', id: 'fins', name: 'Fins', rootChord: 0.05 })],
    }),
  ],
});

// A mock engine handle: mass + positionX keyed by node id; a missing/unknown id throws.
const rocket = {
  componentInfo: (id: string) => {
    const mass: Record<string, number> = { nose: 0.01, body: 0.02, fins: 0.005 };
    const posX: Record<string, number> = { fins: 0.25 };
    if (!(id in mass) && !(id in posX)) throw new Error(`no such component ${id}`);
    return { mass: mass[id] ?? 0, positionX: posX[id] ?? 0 };
  },
};

describe('stageParts', () => {
  const rows = stageParts(stage, rocket);

  it('walks the stage subtree, excluding the stage node itself', () => {
    expect(rows.map((r) => r.type)).toEqual(['nosecone', 'bodytube', 'trapezoidfinset']);
  });
  it('indents nested parts by one depth level', () => {
    expect(rows.find((r) => r.type === 'bodytube')!.depth).toBe(0);
    expect(rows.find((r) => r.type === 'trapezoidfinset')!.depth).toBe(1); // inside the body tube
  });
  it('pulls each part mass from the engine handle', () => {
    expect(rows.find((r) => r.name === 'Nose')!.mass).toBeCloseTo(0.01, 9);
    expect(rows.find((r) => r.name === 'Fins')!.mass).toBeCloseTo(0.005, 9);
  });
  it('leaves mass 0 for a part the engine cannot weigh (no id / throw)', () => {
    const s = node({ type: 'stage', children: [node({ type: 'masscomponent', name: 'Ballast' })] }); // no id
    expect(stageParts(s, rocket)[0]!.mass).toBe(0);
  });
});

describe('finSetPositions', () => {
  it('spans a fin from its root leading edge to leading+rootChord', () => {
    const sets = finSetPositions(stage, rocket);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.name).toBe('Fins');
    expect(sets[0]!.topX).toBeCloseTo(0.25, 9);
    expect(sets[0]!.bottomX).toBeCloseTo(0.3, 9); // 0.25 + 0.05 rootChord
  });
  it('uses a freeform fin outline max-x as the root length', () => {
    const s = node({
      type: 'stage',
      children: [
        node({ type: 'freeformfinset', id: 'fins', name: 'FF', points: [[0, 0], [0.06, 0.03], [0.04, 0]] }),
      ],
    });
    const r = { componentInfo: () => ({ positionX: 0.1 }) };
    expect(finSetPositions(s, r)[0]!.bottomX).toBeCloseTo(0.16, 9); // 0.1 + 0.06
  });
  it('skips a fin set with no id, and one the engine cannot locate', () => {
    const s = node({
      type: 'stage',
      children: [
        node({ type: 'trapezoidfinset', name: 'no-id', rootChord: 0.05 }), // no id → skipped
        node({ type: 'trapezoidfinset', id: 'ghost', name: 'ghost', rootChord: 0.05 }), // throws → skipped
      ],
    });
    expect(finSetPositions(s, rocket)).toHaveLength(0);
  });
});
