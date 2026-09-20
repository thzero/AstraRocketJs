import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../engine/openRocketEngine';
import { num, numOpt, str, bool, countOf, MAX_INSTANCE_COUNT } from './nodeProps';

const node = (props: Record<string, unknown>): ComponentNode => ({ type: 'bodytube', ...props });

describe('num', () => {
  it('returns the value when the key is numeric', () => {
    expect(num(node({ length: 0.2 }), 'length')).toBe(0.2);
    expect(num(node({ length: 0 }), 'length', 9)).toBe(0); // zero is a real value, not "absent"
  });
  it('returns the fallback when absent or the wrong type', () => {
    expect(num(node({}), 'length', 0.05)).toBe(0.05);
    expect(num(node({ length: 'oops' }), 'length', 0.05)).toBe(0.05);
  });
  it('defaults the fallback to 0', () => {
    expect(num(node({}), 'length')).toBe(0);
  });
  it('treats NaN / Infinity as absent (falls back) so non-finite never reaches geometry', () => {
    expect(num(node({ length: NaN }), 'length', 0.05)).toBe(0.05);
    expect(num(node({ length: Infinity }), 'length', 0.05)).toBe(0.05);
    expect(num(node({ length: -Infinity }), 'length', 0.05)).toBe(0.05);
    expect(num(node({ length: NaN }), 'length')).toBe(0); // default fallback
  });
});

describe('numOpt', () => {
  it('returns the value when numeric, else undefined', () => {
    expect(numOpt(node({ shapeParameter: 0.7 }), 'shapeParameter')).toBe(0.7);
    expect(numOpt(node({}), 'shapeParameter')).toBeUndefined();
    expect(numOpt(node({ shapeParameter: null }), 'shapeParameter')).toBeUndefined();
  });
  it('yields undefined for NaN / Infinity', () => {
    expect(numOpt(node({ shapeParameter: NaN }), 'shapeParameter')).toBeUndefined();
    expect(numOpt(node({ shapeParameter: Infinity }), 'shapeParameter')).toBeUndefined();
  });
});

describe('str', () => {
  it('returns the value when a string, else the fallback', () => {
    expect(str(node({ material: 'Cardboard' }), 'material')).toBe('Cardboard');
    expect(str(node({}), 'material', 'default')).toBe('default');
    expect(str(node({ material: 5 }), 'material', 'default')).toBe('default');
  });
  it('defaults the fallback to the empty string', () => {
    expect(str(node({}), 'material')).toBe('');
  });
});

describe('bool', () => {
  it('returns the value when a boolean, else the fallback', () => {
    expect(bool(node({ motorMount: true }), 'motorMount')).toBe(true);
    expect(bool(node({}), 'motorMount')).toBe(false);
    expect(bool(node({ motorMount: 'true' }), 'motorMount', true)).toBe(true); // string is not a boolean
  });
});

/**
 * A count has a ceiling, not just a floor.
 *
 * Every consumer read counts as `Math.max(1, Math.round(...))` and then looped
 * that many times allocating as it went: a cloned ExtrudeGeometry per fin in
 * the 3D view, an SVG shape per fin in the schematic, a tube per instance in
 * the aft view. Typing 100000 into Fin count locked the tab, and a hostile
 * `.ork` could carry the same value. One reader now caps all eleven sites.
 */
describe('countOf', () => {
  const n = (v: unknown) => ({ id: 'x', finCount: v }) as never;

  it('rounds to a whole number and floors at 1', () => {
    expect(countOf(n(3), 'finCount', 3)).toBe(3);
    expect(countOf(n(3.6), 'finCount', 3)).toBe(4);
    expect(countOf(n(0), 'finCount', 3)).toBe(1);
    expect(countOf(n(-5), 'finCount', 3)).toBe(1);
  });

  it('caps an absurd count instead of looping on it', () => {
    expect(countOf(n(100000), 'finCount', 3)).toBe(MAX_INSTANCE_COUNT);
    expect(countOf(n(Number.MAX_SAFE_INTEGER), 'finCount', 3)).toBe(MAX_INSTANCE_COUNT);
  });

  it('falls back for a missing or non-finite value, and caps the fallback too', () => {
    expect(countOf({ id: 'x' } as never, 'finCount', 6)).toBe(6);
    expect(countOf(n(NaN), 'finCount', 3)).toBe(3);
    expect(countOf(n(Infinity), 'finCount', 3)).toBe(3); // non-finite reads as absent
    expect(countOf({ id: 'x' } as never, 'finCount', 1e9)).toBe(MAX_INSTANCE_COUNT);
  });
});
