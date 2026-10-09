import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../../src/engine/openRocketEngine';
import {
  findNode,
  findSiblings,
  findWithParent,
  mapTreePreserving,
  walkNodes,
  type MapContext,
} from '../../src/tree/treeWalk';

const node = (id: string, children?: ComponentNode[], extra: Record<string, unknown> = {}): ComponentNode =>
  ({ id, type: 'bodytube', ...(children ? { children } : {}), ...extra }) as ComponentNode;

/** stage[a[a1, a2[a21]], b] */
const sample = (): ComponentNode[] => [node('stage', [node('a', [node('a1'), node('a2', [node('a21')])]), node('b')])];

describe('walkNodes', () => {
  it('visits each parent before its children, depth first', () => {
    expect([...walkNodes(sample())].map((n) => n.id)).toEqual(['stage', 'a', 'a1', 'a2', 'a21', 'b']);
  });

  it('yields nothing for an empty list', () => {
    expect([...walkNodes([])]).toEqual([]);
  });
});

describe('findNode', () => {
  it('finds a nested node', () => {
    expect(findNode(sample(), 'a21')?.id).toBe('a21');
  });

  it('returns null for a missing id', () => {
    expect(findNode(sample(), 'zz')).toBeNull();
  });

  it('takes the first match in depth-first order', () => {
    const deep = node('dup', [], { tag: 'deep' });
    const late = node('dup', [], { tag: 'late' });
    expect(findNode([node('x', [deep]), late], 'dup')).toBe(deep);
  });
});

describe('findWithParent', () => {
  it('reports the parent of a nested node', () => {
    const tree = sample();
    const hit = findWithParent(tree, 'a2');
    expect(hit?.node.id).toBe('a2');
    expect(hit?.parent?.id).toBe('a');
  });

  it('reports a null parent at the top level by default', () => {
    expect(findWithParent(sample(), 'stage')).toEqual({ node: expect.objectContaining({ id: 'stage' }), parent: null });
  });

  it('reports the given parent for a node in the list itself', () => {
    const tree = sample();
    const stage = tree[0]!;
    expect(findWithParent(stage.children!, 'b', stage)?.parent).toBe(stage);
  });

  it('returns null for a missing id', () => {
    expect(findWithParent(sample(), 'zz')).toBeNull();
  });
});

describe('findSiblings', () => {
  it('returns the tree array holding the node and its index', () => {
    const tree = sample();
    const hit = findSiblings(tree, 'a2');
    expect(hit?.index).toBe(1);
    expect(hit?.siblings).toBe(tree[0]!.children![0]!.children);
  });

  it('prefers a match at the current level over a deeper one', () => {
    const deep = node('dup');
    const shallow = node('dup');
    const hit = findSiblings([node('x', [deep]), shallow], 'dup');
    expect(hit?.siblings[hit.index]).toBe(shallow);
  });

  it('returns null for a missing id', () => {
    expect(findSiblings(sample(), 'zz')).toBeNull();
  });
});

describe('mapTreePreserving', () => {
  it('returns the same array when nothing changes', () => {
    const tree = sample();
    expect(mapTreePreserving(tree, (n) => n, 'pre')).toBe(tree);
    expect(mapTreePreserving(tree, (n) => n, 'post')).toBe(tree);
  });

  it('copies only the spine to a changed node', () => {
    const tree = sample();
    const out = mapTreePreserving(tree, (n) => (n.id === 'a21' ? { ...n, hit: true } : n), 'pre');
    expect(out).not.toBe(tree);
    const a = out[0]!.children![0]!;
    expect(a).not.toBe(tree[0]!.children![0]);
    expect(a.children![0]).toBe(tree[0]!.children![0]!.children![0]); // a1 untouched
    expect(out[0]!.children![1]).toBe(tree[0]!.children![1]); // b untouched
    expect(a.children![1]!.children![0]!['hit']).toBe(true);
  });

  it('pre order runs a parent first and hands its result to the children', () => {
    const seen: string[] = [];
    const out = mapTreePreserving(
      sample(),
      (n, { parent }) => {
        seen.push(`${n.id}<${parent?.id ?? '-'}:${typeof parent?.['mark'] === 'string' ? parent['mark'] : ''}`);
        return { ...n, mark: 'm' };
      },
      'pre',
    );
    expect(seen).toEqual(['stage<-:', 'a<stage:m', 'a1<a:m', 'a2<a:m', 'a21<a2:m', 'b<stage:m']);
    expect(out[0]!.children![0]!.children![1]!.children![0]!['mark']).toBe('m');
  });

  it('post order runs the children first and the parent on its mapped children', () => {
    const seen: string[] = [];
    mapTreePreserving(
      sample(),
      (n) => {
        seen.push(n.id as string);
        if (n.id === 'a') expect(n.children![0]!['mark']).toBe('m');
        return { ...n, mark: 'm' };
      },
      'post',
    );
    expect(seen).toEqual(['a1', 'a21', 'a2', 'a', 'b', 'stage']);
  });

  it('passes the original sibling array and index', () => {
    const tree = sample();
    const calls: MapContext[] = [];
    mapTreePreserving(
      tree,
      (n, ctx) => {
        if (n.id === 'b') calls.push(ctx);
        return { ...n, touched: true };
      },
      'pre',
    );
    expect(calls[0]!.index).toBe(1);
    expect(calls[0]!.siblings).toBe(tree[0]!.children);
  });
});
