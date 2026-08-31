// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { specToTree } from './api';
import type { RocketSpec, ComponentNode, RocketTree } from './openRocketEngine';

const baseSpec = {
  noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 }, // no shape, no material
  bodyTube: { length: 0.2, outerRadius: 0.013, thickness: 0.0005, materialDensity: 930, material: 'Cardboard' },
  fins: { count: 3, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05, thickness: 0.003 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
} as unknown as RocketSpec;

const child = (tree: RocketTree, id: string): ComponentNode | undefined => {
  const stack = [...tree.components];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    if (n.children) stack.push(...n.children);
  }
  return undefined;
};

describe('specToTree', () => {
  it('lays out a Sustainer stage with nose + body', () => {
    const { tree, mountId } = specToTree(baseSpec);
    expect(mountId).toBe('mount');
    const stage = tree.components[0]!;
    expect(stage.type).toBe('stage');
    expect(stage.name).toBe('Sustainer');
    expect(stage.children!.map((c) => c.id)).toEqual(['nose', 'body']);
  });

  it('defaults the nose shape to ogive and copies material only when present', () => {
    const { tree } = specToTree(baseSpec);
    const nose = child(tree, 'nose') as { shape?: string; density?: number };
    expect(nose.shape).toBe('ogive');
    expect(nose.density).toBeUndefined(); // nose had no materialDensity
    const body = child(tree, 'body') as { density?: number; materialName?: string };
    expect(body.density).toBe(930);
    expect(body.materialName).toBe('Cardboard');
  });

  it('bottom-aligns the fin set and seats a motor mount with overhang', () => {
    const { tree } = specToTree(baseSpec);
    const fins = child(tree, 'fins') as { position?: { method: string; offset: number }; finCount?: number };
    expect(fins.finCount).toBe(3);
    expect(fins.position).toEqual({ method: 'bottom', offset: 0 });
    const mount = child(tree, 'mount') as { motorMount?: boolean; motorOverhang?: number };
    expect(mount.motorMount).toBe(true);
    expect(mount.motorOverhang).toBeCloseTo(0.00635, 9);
  });

  it('positions the fore centering ring by body−mount length and sizes rings to the bore', () => {
    const { tree } = specToTree(baseSpec);
    const fore = child(tree, 'ring-fore') as { position?: { offset: number }; outerRadius?: number };
    expect(fore.position!.offset).toBeCloseTo(0.13, 9); // max(0, 0.2 − 0.07)
    expect(fore.outerRadius).toBeCloseTo(0.0125, 9); // body outerRadius − wall
    expect(child(tree, 'ring-aft')).toBeDefined();
  });

  it('omits the parachute unless the spec has one, defaulting its Cd to 0.8', () => {
    expect(child(specToTree(baseSpec).tree, 'chute')).toBeUndefined();

    const withChute = { ...baseSpec, parachute: { diameter: 0.3 } } as unknown as RocketSpec;
    const chute = child(specToTree(withChute).tree, 'chute') as { cd?: number; diameter?: number };
    expect(chute.diameter).toBe(0.3);
    expect(chute.cd).toBe(0.8);

    const customCd = { ...baseSpec, parachute: { diameter: 0.3, dragCoefficient: 1.2 } } as unknown as RocketSpec;
    expect((child(specToTree(customCd).tree, 'chute') as { cd?: number }).cd).toBe(1.2);
  });
});
