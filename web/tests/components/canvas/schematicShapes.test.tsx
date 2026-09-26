import { describe, it, expect } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { KERNEL_MASSCOMPONENT_RADIUS } from '../../../src/tree/kernelDefaults.js';

/** Every `<rect>` in a node list, keyed by its `<title>` text. */
const rectsByTitle = (nodes: ReactNode[]): Map<string, ReactElement<Record<string, unknown>>> => {
  const out = new Map<string, ReactElement<Record<string, unknown>>>();
  for (const n of nodes) {
    if (!isValidElement(n) || n.type !== 'rect') continue;
    const el = n as ReactElement<Record<string, unknown>>;
    const title = el.props['children'];
    if (isValidElement(title) && title.type === 'title') {
      const text = (title as ReactElement<{ children?: ReactNode }>).props.children;
      if (typeof text === 'string') out.set(text, el);
    }
  }
  return out;
};

const build = (children: ComponentNode[]) => {
  const chain: ComponentNode[] = [
    { type: 'bodytube', id: 'b', outerRadius: 0.02, length: 0.3, children } as ComponentNode,
  ];
  return buildSchematicShapes({
    chain,
    ctx: { scale: 1000, cy: 200, x0: 0 },
    scale: 1000,
    w: 800,
    h: 400,
    roll: 0,
    uid: 't',
    setHoverId: () => {},
    textUp: () => ({}),
  });
};

/**
 * The internal-component box's radius fallback. A mass component with no
 * `radius` key draws at the KERNEL's default, because that is what it flies at.
 * Every other internal type keeps the 70% fraction of the parent: the kernel
 * does not read `radius` for a parachute, and applying the 5 mm mass default to
 * one shrank the default design's chute box until its glyph no longer fit,
 * which is how the e2e schematic spec caught it.
 */
describe('buildSchematicShapes internal-component radius fallback', () => {
  it('draws a parachute with no radius at 70% of the parent radius', () => {
    const { overlay } = build([{ type: 'parachute', id: 'p', length: 0.05 } as ComponentNode]);
    const rect = rectsByTitle(overlay).get('Parachute');
    expect(rect).toBeDefined();
    expect(rect!.props['height']).toBeCloseTo(2 * 0.02 * 0.7 * 1000, 6);
  });

  it('draws a mass component with no radius at the kernel default', () => {
    const { overlay } = build([{ type: 'masscomponent', id: 'm', length: 0.05 } as ComponentNode]);
    const rect = rectsByTitle(overlay).get('Mass component');
    expect(rect).toBeDefined();
    expect(rect!.props['height']).toBeCloseTo(2 * KERNEL_MASSCOMPONENT_RADIUS * 1000, 6);
  });

  it('an explicit radius wins over either fallback', () => {
    const { overlay } = build([{ type: 'parachute', id: 'p', length: 0.05, radius: 0.01 } as ComponentNode]);
    expect(rectsByTitle(overlay).get('Parachute')!.props['height']).toBeCloseTo(2 * 0.01 * 1000, 6);
  });
});
