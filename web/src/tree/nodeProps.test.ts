import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../engine/openRocketEngine';
import { num, numOpt, str, bool } from './nodeProps';

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
});

describe('numOpt', () => {
  it('returns the value when numeric, else undefined', () => {
    expect(numOpt(node({ shapeParameter: 0.7 }), 'shapeParameter')).toBe(0.7);
    expect(numOpt(node({}), 'shapeParameter')).toBeUndefined();
    expect(numOpt(node({ shapeParameter: null }), 'shapeParameter')).toBeUndefined();
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
