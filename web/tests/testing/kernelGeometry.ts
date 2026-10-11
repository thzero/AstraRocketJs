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
  /** The front of the part's first copy from the nose tip (`getComponentInfo`). */
  positionX?: number;
  /**
   * The part's length from `getComponentInfo`, read after every geometry read.
   * A mass object with an automatic radius moves its length when the radius
   * settles (`MassObject.getRadius`), and `length` above is read before that.
   */
  settledLength?: number;
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
  // Read after every geometry read: those reads are what settle an automatic
  // tube, in tree order, and reading anything else between them would change
  // the order the kernel evaluates them in.
  for (const [id, geometry] of out) {
    const info = JSON.parse(engine.getComponentInfo(handle, id) as string) as {
      positionX?: number;
      length?: number;
      error?: string;
    };
    if (info.error) throw new Error(`${id}: ${info.error}`);
    geometry.positionX = info.positionX;
    geometry.settledLength = info.length;
  }
  return out;
}
