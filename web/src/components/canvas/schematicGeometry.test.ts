import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import {
  niceStep,
  snapNear,
  calloutLayout,
  finTabFront,
  axialStart,
  computeSchematicLayout,
  profilePath,
} from './schematicGeometry';

const node = (o: object): ComponentNode => o as unknown as ComponentNode;

describe('niceStep', () => {
  it('picks a 1/2/2.5/5/10-times-power-of-ten step giving ~8 marks', () => {
    expect(niceStep(1)).toBeCloseTo(0.2, 9); // 1/8 = 0.125 → 0.2
    expect(niceStep(0.4)).toBeCloseTo(0.05, 9); // 0.05 → 0.05
    expect(niceStep(8)).toBeCloseTo(1, 9);
    expect(niceStep(0)).toBeGreaterThan(0); // guarded, never 0/NaN
  });
});

describe('snapNear', () => {
  it('snaps to the nearest target within eps, else returns the raw value', () => {
    expect(snapNear(0.11, [0.1, 0.2], 0.05)).toBeCloseTo(0.1, 9); // within eps
    expect(snapNear(0.15, [0.1, 0.2], 0.02)).toBeCloseTo(0.15, 9); // both 0.05 away > eps → raw
    expect(snapNear(0.3, [], 0.05)).toBe(0.3); // no targets
  });
});

describe('finTabFront', () => {
  const finLen = 0.05;
  it('resolves the tab leading edge per anchor method', () => {
    expect(finTabFront(node({ tabOffset: 0.01, tabOffsetMethod: 'top' }), finLen)).toBeCloseTo(0.01, 9);
    expect(finTabFront(node({ tabOffset: 0, tabLength: 0.02, tabOffsetMethod: 'bottom' }), finLen)).toBeCloseTo(0.03, 9);
    // middle is the default
    expect(finTabFront(node({ tabOffset: 0, tabLength: 0.02 }), finLen)).toBeCloseTo(0.015, 9);
  });
});

describe('axialStart', () => {
  it('places a child by its position method within the parent span', () => {
    const pStart = 0;
    const pLen = 0.2;
    const cLen = 0.05;
    expect(axialStart(node({ position: { method: 'top', offset: 0 } }), cLen, pStart, pLen)).toBeCloseTo(0, 9);
    expect(axialStart(node({ position: { method: 'bottom', offset: 0 } }), cLen, pStart, pLen)).toBeCloseTo(0.15, 9);
    expect(axialStart(node({ position: { method: 'middle', offset: 0 } }), cLen, pStart, pLen)).toBeCloseTo(0.075, 9);
    // no position → defaults to top+0
    expect(axialStart(node({}), cLen, pStart, pLen)).toBeCloseTo(0, 9);
  });
});

describe('calloutLayout', () => {
  it('returns null legs when a marker is absent', () => {
    const out = calloutLayout(null, null, 100, 20, 900, 400, null);
    expect(out.cg).toBeNull();
    expect(out.cp).toBeNull();
    expect(out.margin).toBeNull();
  });
  it('places the margin text inside the viewBox, clear of the CP label', () => {
    const w = 900;
    const out = calloutLayout(100, 300, 100, 20, w, 400, 'CG · 22.4 cm');
    expect(out.cg).not.toBeNull();
    expect(out.cp).not.toBeNull();
    expect(out.margin).not.toBeNull();
    expect(out.margin!.x).toBeGreaterThan(0);
    expect(out.margin!.x).toBeLessThan(w);
  });
});

describe('computeSchematicLayout', () => {
  const tree: RocketTree = {
    name: 't',
    components: [
      node({
        type: 'stage',
        children: [
          node({ type: 'nosecone', length: 0.1, aftRadius: 0.012 }),
          node({
            type: 'bodytube',
            length: 0.2,
            outerRadius: 0.012,
            children: [node({ type: 'trapezoidfinset', rootChord: 0.05, height: 0.03 })],
          }),
        ],
      }),
    ],
  } as unknown as RocketTree;
  const dims = { chPx: 480, cw: 900, maxHeight: 420 };

  it('flattens stages into a nose→tail chain and measures length/radius', () => {
    const out = computeSchematicLayout(tree, null, dims);
    expect(out.chain).toHaveLength(2); // nose + body (stage unwrapped)
    expect(out.totalLen).toBeCloseTo(0.3, 6);
    expect(out.maxR).toBeGreaterThanOrEqual(0.012);
  });
  it('vHalf includes the fin height, and scale/size are positive', () => {
    const out = computeSchematicLayout(tree, null, dims);
    expect(out.vHalf).toBeGreaterThan(out.maxR); // fins add vertical reach
    expect(out.vHalf).toBeCloseTo(0.012 + 0.03, 6);
    expect(out.scale).toBeGreaterThan(0);
    expect(out.w).toBeGreaterThanOrEqual(320);
    expect(out.h).toBeGreaterThan(0);
  });
});

describe('profilePath', () => {
  it('emits a closed side-view outline (M … L … Z)', () => {
    const ctx = { scale: 1000, cy: 100, x0: 10 };
    const d = profilePath(ctx, node({ type: 'nosecone', shape: 'ogive' }), 0, 0.1, 0, 0.012, 100);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    expect(d).toContain(' L ');
    expect(d).not.toContain('NaN');
  });
});
