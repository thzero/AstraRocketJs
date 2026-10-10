import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

/**
 * The kernel's resolved geometry for every part of a design, read through the
 * bridge's `getComponentGeometry`.
 *
 * The app resolves automatic radii, profiles and bores itself so it can draw,
 * mesh and export without waiting on a kernel call. These are the numbers each
 * of those copies has to match: they come from the Java that flies the design,
 * not from a table that says it mirrors the Java.
 */
export interface KernelGeometry {
  length: number;
  foreRadius?: number;
  aftRadius?: number;
  /** Outer radius at evenly spaced stations from the front, both ends included. */
  profile?: (number | null)[];
  innerProfile?: (number | null)[];
  outerRadius?: number;
  innerRadius?: number;
  maxTabHeight?: number;
  radius?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
export const loadEngine = async (): Promise<any> => {
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  return import('../../src/engine/vendor/openrocket-engine.mjs' as string);
};

/** One node of a design, with its id and its parent's ('' for a node without one). */
export interface Visit {
  node: ComponentNode;
  id: string;
  parent: ComponentNode | null;
  parentId: string;
}

/** Every node in the tree, depth first, with its parent. */
export function walkTree(tree: RocketTree): Visit[] {
  const out: Visit[] = [];
  const visit = (node: ComponentNode, parent: ComponentNode | null) => {
    out.push({ node, id: node.id ?? '', parent, parentId: parent?.id ?? '' });
    for (const kid of node.children ?? []) visit(kid, node);
  };
  for (const top of tree.components) visit(top, null);
  return out;
}

/** Build the design in the kernel and read back each part's geometry, keyed by id. */
export function kernelGeometry(engine: any, tree: RocketTree): Map<string, KernelGeometry> {
  engine.reset();
  const handle: number = engine.buildRocket(JSON.stringify(tree));
  const out = new Map<string, KernelGeometry>();
  for (const { node, id } of walkTree(tree)) {
    if (node.type === 'stage') continue;
    const json = JSON.parse(engine.getComponentGeometry(handle, id) as string) as KernelGeometry & {
      error?: string;
    };
    if (json.error) throw new Error(`${id}: ${json.error}`);
    out.set(id, json);
  }
  return out;
}
