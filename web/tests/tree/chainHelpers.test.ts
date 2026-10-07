import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { anyOuterRadius, chainOuterRadius } from '../../src/tree/nodeProps';
import { axialChain, motorSeatStart } from '../../src/tree/position';

const n = (type: string, extra: Record<string, unknown> = {}): ComponentNode => ({ type, ...extra }) as ComponentNode;

describe('chainOuterRadius', () => {
  it('reads the key each chain type sizes by', () => {
    expect(chainOuterRadius(n('nosecone', { aftRadius: 0.02, outerRadius: 0.05 }))).toBe(0.02);
    expect(chainOuterRadius(n('bodytube', { outerRadius: 0.03, aftRadius: 0.05 }))).toBe(0.03);
    expect(chainOuterRadius(n('transition', { foreRadius: 0.02, aftRadius: 0.04 }))).toBe(0.04);
    expect(chainOuterRadius(n('transition', { foreRadius: 0.05, aftRadius: 0.04 }))).toBe(0.05);
  });

  it('is 0 for other types and for missing or non-finite values', () => {
    expect(chainOuterRadius(n('innertube', { outerRadius: 0.01 }))).toBe(0);
    expect(chainOuterRadius(n('bodytube'))).toBe(0);
    expect(chainOuterRadius(n('nosecone', { aftRadius: Number.NaN }))).toBe(0);
  });
});

describe('anyOuterRadius', () => {
  it('takes the largest radius key whatever the type', () => {
    expect(anyOuterRadius(n('nosecone', { aftRadius: 0.02, outerRadius: 0.05 }))).toBe(0.05);
    expect(anyOuterRadius(n('innertube', { outerRadius: 0.01 }))).toBe(0.01);
    expect(anyOuterRadius(n('transition', { foreRadius: 0.03 }))).toBe(0.03);
  });

  it('is 0 when no radius is stated', () => {
    expect(anyOuterRadius(n('parachute'))).toBe(0);
  });
});

describe('axialChain', () => {
  it('flattens stages in order and passes a non-stage node through', () => {
    const nose = n('nosecone');
    const body = n('bodytube');
    const boosterBody = n('bodytube');
    const loose = n('bodytube');
    const tree = {
      components: [n('stage', { children: [nose, body] }), n('stage', { children: [boosterBody] }), loose],
    } as unknown as RocketTree;
    expect(axialChain(tree)).toEqual([nose, body, boosterBody, loose]);
  });

  it('treats a stage with no children as empty', () => {
    expect(axialChain({ components: [n('stage')] } as unknown as RocketTree)).toEqual([]);
  });
});

describe('motorSeatStart', () => {
  // InnerTube/BodyTube.getMotorPosition: length - motor length + overhang,
  // from the mount's front; here offset by the mount's own start.
  it('seats the motor flush with the aft end', () => {
    expect(motorSeatStart(n('innertube'), 0.5, 0.2, 0.15)).toBeCloseTo(0.55, 12);
  });

  it('pushes the motor aft by the overhang', () => {
    expect(motorSeatStart(n('innertube', { motorOverhang: 0.01 }), 0.5, 0.2, 0.15)).toBeCloseTo(0.56, 12);
  });

  it('evaluates in the order start + length - motor + overhang', () => {
    const mount = n('bodytube', { motorOverhang: 0.003 });
    expect(motorSeatStart(mount, 0.1, 0.7, 0.3)).toBe(0.1 + 0.7 - 0.3 + 0.003);
  });
});
