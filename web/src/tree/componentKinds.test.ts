import { describe, it, expect } from 'vitest';
import {
  ASSEMBLY_TYPES,
  CHAIN_TYPES,
  COMPONENT_KIND,
  FIN_SET_TYPES,
  PLANAR_FIN_TYPES,
  isChainType,
  typesOfKind,
} from './componentKinds';
import { isAssembly } from './assembly';
import { isFinSet, isPlanarFinSet } from './tubefins';
import { isAxial } from '../services/treeEdit';

describe('COMPONENT_KIND', () => {
  it('derives the chain, assembly and fin-set families from one table', () => {
    expect([...CHAIN_TYPES].sort()).toEqual(['bodytube', 'nosecone', 'transition']);
    expect([...ASSEMBLY_TYPES].sort()).toEqual(['parallelstage', 'podset']);
    expect([...PLANAR_FIN_TYPES].sort()).toEqual(['ellipticalfinset', 'freeformfinset', 'trapezoidfinset']);
    expect([...FIN_SET_TYPES].sort()).toEqual(['ellipticalfinset', 'freeformfinset', 'trapezoidfinset', 'tubefinset']);
  });

  it('classifies every type exactly once', () => {
    const all = Object.keys(COMPONENT_KIND);
    const kinds = [
      'stage',
      'chain',
      'planarfin',
      'tubefin',
      'internal',
      'external',
      'recovery',
      'mass',
      'assembly',
    ] as const;
    const seen = kinds.flatMap((k) => [...typesOfKind(k)]);
    expect(seen.sort()).toEqual(all.sort());
  });

  it('is what every guard reads, so the four former copies cannot disagree', () => {
    for (const t of Object.keys(COMPONENT_KIND)) {
      expect(isChainType(t), t).toBe(CHAIN_TYPES.has(t as never));
      expect(isAxial(t), t).toBe(CHAIN_TYPES.has(t as never));
      expect(isAssembly(t), t).toBe(ASSEMBLY_TYPES.has(t as never));
      expect(isFinSet(t), t).toBe(FIN_SET_TYPES.has(t as never));
      expect(isPlanarFinSet(t), t).toBe(PLANAR_FIN_TYPES.has(t as never));
    }
  });

  it('says no to a type the union does not know', () => {
    // A persisted design or a hostile file can carry anything here. The old
    // `endsWith('finset')` test said yes to this one.
    for (const t of ['myfinset', 'finset', '', 'pod']) {
      expect(isChainType(t)).toBe(false);
      expect(isAssembly(t)).toBe(false);
      expect(isFinSet(t)).toBe(false);
      expect(isPlanarFinSet(t)).toBe(false);
    }
  });
});
