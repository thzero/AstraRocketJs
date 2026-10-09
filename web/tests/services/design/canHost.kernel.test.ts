import { describe, expect, it, vi } from 'vitest';
import { allowedChildren, canHost, defaultNode } from '../../../src/services/design/treeEdit';
import type { ComponentNode, ComponentType } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * `canHost` is what the Add menu offers and where a paste may land, so it has to
 * be the kernel's `isCompatible`, pair for pair. A looser rule offers a part the
 * kernel refuses to build ("not currently compatible"); a tighter one refuses
 * what desktop writes. Every pair is built through the real engine and the
 * answer compared, rather than trusting a table that says it mirrors the Java.
 *
 * `fairing` is left out: it has no default node to build from, and the bridge
 * builds it as a mass component, whose row this already checks.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
const loadEngine = async (): Promise<any> => {
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  return import('../../../src/engine/vendor/openrocket-engine.mjs' as string);
};

const TYPES: ComponentType[] = [
  'nosecone',
  'bodytube',
  'transition',
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'tubefinset',
  'launchlug',
  'railbutton',
  'innertube',
  'tubecoupler',
  'centeringring',
  'bulkhead',
  'engineblock',
  'parachute',
  'streamer',
  'shockcord',
  'masscomponent',
  'podset',
  'parallelstage',
];

const node = (type: ComponentType, id: string, children: ComponentNode[] = []): ComponentNode =>
  ({ ...defaultNode(type), id, children }) as ComponentNode;

/** A design with `child` directly inside a `parent`, the parent placed where it may sit. */
function design(parent: ComponentType | 'stage', child: ComponentType): unknown {
  const kid = node(child, 'kid');
  if (parent === 'stage') return { components: [node('stage' as ComponentType, 'st', [kid])] };
  const host = node(parent, 'host', [kid]);
  // Axial parts sit in the stage; everything else inside a body tube.
  const inStage = parent === 'nosecone' || parent === 'bodytube' || parent === 'transition';
  const chain = inStage ? [host] : [node('bodytube', 'tube', [host])];
  return { components: [node('stage' as ComponentType, 'st', chain)] };
}

describe('canHost', () => {
  it('matches the kernel for every parent and child', async () => {
    const engine = await loadEngine();
    const wrong: string[] = [];
    for (const parent of ['stage', ...TYPES] as const) {
      for (const child of TYPES) {
        engine.reset();
        let kernel = true;
        try {
          engine.buildRocket(JSON.stringify(design(parent, child)));
        } catch (e) {
          // Only the compatibility refusal counts; anything else is a build
          // problem with a default part, not an answer to this question.
          if (/not currently compatible/.test(String(e))) kernel = false;
        }
        if (kernel !== canHost(parent, child)) wrong.push(`${child} in ${parent}: kernel ${kernel}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('puts stages only in the design, and lists children in the Add menu order', () => {
    expect(canHost('rocket', 'stage')).toBe(true);
    expect(canHost('rocket', 'bodytube')).toBe(false);
    expect(allowedChildren(undefined)).toEqual(['nosecone', 'bodytube', 'transition']);
    expect(allowedChildren('parachute')).toEqual([]);
  });
});
