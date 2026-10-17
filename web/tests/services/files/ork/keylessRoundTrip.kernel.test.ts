// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, ComponentType, RocketTree } from '../../../../src/engine/openRocketEngine';
import { exportOrk, importOrk } from '../../../../src/services/files/orkFile';
import { defaultNode } from '../../../../src/services/design/treeEdit';
import { walkNodes } from '../../../../src/tree/treeWalk';
import { loadEngine } from '../../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A part whose node lacks a key is written at the size the kernel flies it.
 *
 * The `.ork` writer fills an absent key with a fallback and the reader fills an
 * absent tag with one; the bridge fills the same absent key from the kernel's
 * constructor. For every key a writer falls back on, the node is built without
 * it, the kernel's value is read back through `getComponentFields`, and the node
 * is written and read again: the value the reader holds has to be the kernel's.
 * Otherwise desktop opens a different rocket from the one simulated here. The
 * expected values are the kernel's, never a table of the app's.
 */

/** The keys each writer falls back on that the kernel reports under the same name. */
const FALLBACK_KEYS: Partial<Record<ComponentType, string[]>> = {
  nosecone: ['length', 'thickness', 'aftRadius'],
  transition: ['length', 'thickness'],
  bodytube: ['length', 'outerRadius', 'thickness'],
  trapezoidfinset: ['finCount', 'rootChord', 'tipChord', 'sweep', 'height', 'thickness'],
  ellipticalfinset: ['finCount', 'rootChord', 'height', 'thickness'],
  freeformfinset: ['finCount', 'thickness'],
  tubefinset: ['finCount', 'length', 'thickness'],
  innertube: ['length', 'outerRadius', 'thickness'],
  tubecoupler: ['length', 'thickness'],
  centeringring: ['length'],
  bulkhead: ['length'],
  engineblock: ['length', 'thickness'],
  launchlug: ['length', 'outerRadius', 'thickness'],
  parachute: ['diameter', 'lineCount', 'lineLength', 'deployAltitude', 'deployDelay'],
  streamer: ['stripLength', 'stripWidth', 'deployAltitude', 'deployDelay'],
  shockcord: ['cordLength'],
  masscomponent: ['mass', 'length', 'radius'],
};

/** The flag that says a key is automatic, dropped with the key so the bridge sees neither. */
const AUTO_FLAGS: Record<string, string> = {
  aftRadius: 'aftRadiusAuto',
  outerRadius: 'outerRadiusAuto',
  radius: 'radiusAuto',
  lineLength: 'lineLengthAuto',
  cordLength: 'cordLengthAuto',
};

const NOSE: ComponentNode = { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.15, aftRadius: 0.05 };
const TUBE: ComponentNode = { type: 'bodytube', id: 'tube', length: 0.4, outerRadius: 0.05, thickness: 0.002 };
const TAIL: ComponentNode = { type: 'bodytube', id: 'tail', length: 0.3, outerRadius: 0.04, thickness: 0.002 };

/** The design a part is tested in, with the part under id `p`, as fieldReadback hosts it. */
function host(part: ComponentNode): RocketTree {
  const p = { ...part, id: 'p' };
  const stage = (children: ComponentNode[]) => ({ type: 'stage', id: 's', children }) as ComponentNode;
  switch (part.type) {
    case 'nosecone':
      return { components: [stage([p, TUBE])] } as RocketTree;
    case 'bodytube':
      return { components: [stage([NOSE, p])] } as RocketTree;
    case 'transition':
      return { components: [stage([NOSE, TUBE, p, TAIL])] } as RocketTree;
    default:
      return { components: [stage([NOSE, { ...TUBE, children: [p] }])] } as RocketTree;
  }
}

/** The kernel's fields for the part `p` of a design. */
function kernelFields(tree: RocketTree): Record<string, unknown> {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const fields = JSON.parse(engine.getComponentFields(handle, 'p')) as Record<string, unknown>;
  if (typeof fields.error === 'string') throw new Error(fields.error);
  return fields;
}

/** The part `p` built without `key`, in its host. */
function without(type: ComponentType, key: string): RocketTree {
  const node: ComponentNode = { ...defaultNode(type), id: 'p' };
  delete node[key];
  if (AUTO_FLAGS[key]) delete node[AUTO_FLAGS[key]];
  return host(node);
}

/** The same node after a write and a read, by its type (ids are minted on import). */
function roundTrip(tree: RocketTree, type: ComponentType): { xml: string; node: ComponentNode } {
  const xml = exportOrk({ name: 'K', tree });
  const back = importOrk(xml).tree;
  return { xml, node: [...walkNodes(back.components)].find((n) => n.type === type)! };
}

const agrees = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 + 1e-9 * Math.abs(b) : a === b;

describe('a node without a key is written at the size the kernel flies', () => {
  it('for every key the writers fall back on', () => {
    const misses: string[] = [];
    for (const [type, keys] of Object.entries(FALLBACK_KEYS) as [ComponentType, string[]][]) {
      for (const key of keys) {
        const tree = without(type, key);
        const kernel = kernelFields(tree)[key];
        const read = roundTrip(tree, type).node[key];
        if (!agrees(read, kernel)) misses.push(`${type}.${key}: read ${String(read)}, kernel ${String(kernel)}`);
      }
    }
    expect(misses, misses.join('\n')).toEqual([]);
  });

  it('writes no wall for a tube fin set without one, which flies and reads back as its tube wall', () => {
    const tree = without('tubefinset', 'thickness');
    const { xml, node } = roundTrip(tree, 'tubefinset');
    expect(/<tubefinset>[\s\S]*?<\/tubefinset>/.exec(xml)![0]).not.toContain('<thickness>');
    // The wall the kernel reports is the parent tube's; the import resolves
    // the same wall onto the node (`syncAutoRadii`), so the two agree.
    const kernel = kernelFields(tree).thickness as number;
    expect(kernel).toBeCloseTo(TUBE['thickness'] as number, 12);
    expect(node['thickness']).toBeCloseTo(kernel, 12);
  });
});
