import { describe, it, expect } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { KERNEL_MASSCOMPONENT_RADIUS } from '../../../src/tree/kernelDefaults.js';
import { COMPONENT_DEFAULTS } from '../../../src/services/componentDefaults';

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

/**
 * A shoulder has to be TELLABLE from the tube it is inside.
 *
 * It was drawn all along, in the neutral gray every dashed annotation shared,
 * and reported as working because the rect was in the DOM. It never read as
 * anything: a shoulder is a snug fit by definition, so its box sits within a
 * pixel or two of the tube's own outline, and in a gray that close to the
 * tube's stroke there was nothing to see. These hold the two things that make
 * it visible - its own ink, and the owning part's color when that part has
 * one - rather than holding that a rect exists.
 */
describe('a nose cone shoulder', () => {
  const withShoulder = (nose: Partial<ComponentNode> = {}) =>
    buildSchematicShapes({
      chain: [
        {
          type: 'nosecone',
          id: 'n',
          aftRadius: 0.02,
          length: 0.1,
          shoulderLength: 0.03,
          shoulderRadius: 0.019,
          ...nose,
        } as ComponentNode,
        { type: 'bodytube', id: 'b', outerRadius: 0.02, length: 0.3 } as ComponentNode,
      ],
      ctx: { scale: 1000, cy: 200, x0: 0 },
      scale: 1000,
      w: 800,
      h: 400,
      roll: 0,
      uid: 't',
      setHoverId: () => {},
      textUp: () => ({}),
    });

  const shoulder = (nose: Partial<ComponentNode> = {}) => rectsByTitle(withShoulder(nose).overlay).get('Nose cone');

  it('starts where the cone ends, at the shoulder radius', () => {
    const r = shoulder()!;
    expect(r).toBeDefined();
    expect(r.props['x']).toBeCloseTo(100, 6); // the 100 mm cone's base
    expect(r.props['width']).toBeCloseTo(30, 6);
    expect(r.props['height']).toBeCloseTo(38, 6); // the 19 mm stub, across
  });

  it('is not the neutral gray it shares the drawing with', () => {
    // The tube it sits in is stroked #7a786f and every other dashed annotation
    // was #9a978f. Either one and the stub is invisible against the wall.
    expect(shoulder()!.props['stroke']).not.toBe('#9a978f');
    expect(shoulder()!.props['stroke']).not.toBe('#7a786f');
  });

  it('takes the color of the part it belongs to', () => {
    // Whose shoulder it is matters where two meet: a transition's fore
    // shoulder and a nose cone's aft shoulder can share one tube.
    expect(shoulder({ color: '#ff0000' })!.props['stroke']).toBe('#ff0000');
  });

  it('is not drawn at all when the part has no shoulder', () => {
    expect(shoulder({ shoulderLength: 0 })).toBeUndefined();
    expect(shoulder({ shoulderRadius: 0 })).toBeUndefined();
  });
});

/**
 * Structure is drawn at the size it really is.
 *
 * `internalExtent` caps a radius at 85% of the parent, which protects a chute,
 * whose box is an invented fallback rather than a dimension anybody entered. A
 * coupler is the opposite: it fills the bore by definition, so it hits that cap
 * EVERY time and is drawn narrower than it is, while the DXF cut sheet, the printed
 * solid and the 3D model size it from the real bore. One part, two sizes.
 */
describe('a coupler is sized like the part you would cut', () => {
  const bore = 0.02 - COMPONENT_DEFAULTS.bodytube.thickness;

  it('fills the tube bore rather than stopping at the 85% cap', () => {
    const { overlay } = build([{ type: 'tubecoupler', id: 'c', length: 0.05 } as ComponentNode]);
    const r = rectsByTitle(overlay).get('Tube coupler')!;
    expect(r).toBeDefined();
    expect(r.props['height']).toBeCloseTo(2 * bore * 1000, 6);
    expect(r.props['height']).toBeGreaterThan(2 * 0.02 * 0.85 * 1000);
  });

  it('gives a centering ring the same treatment', () => {
    const { overlay } = build([{ type: 'centeringring', id: 'cr', length: 0.003 } as ComponentNode]);
    expect(rectsByTitle(overlay).get('Centering ring')!.props['height']).toBeCloseTo(2 * bore * 1000, 6);
  });

  it('leaves a chute capped, since its box is a fallback and not a dimension', () => {
    const { overlay } = build([{ type: 'parachute', id: 'p', length: 0.04 } as ComponentNode]);
    expect(rectsByTitle(overlay).get('Parachute')!.props['height']).toBeCloseTo(2 * 0.02 * 0.7 * 1000, 6);
  });

  it('tells a coupler and an inner tube apart by ink, not only by size', () => {
    // They were the two parts left neutral, on the grounds that they are "tube
    // segments" - which left them as two unlabeled gray boxes, distinguished by
    // a size the cap was distorting.
    const c = rectsByTitle(build([{ type: 'tubecoupler', id: 'c', length: 0.05 } as ComponentNode]).overlay).get(
      'Tube coupler',
    )!;
    const i = rectsByTitle(
      build([{ type: 'innertube', id: 'i', length: 0.07, outerRadius: 0.0095 } as ComponentNode]).overlay,
    ).get('Inner tube')!;
    expect(c.props['stroke']).not.toBe('#9a978f');
    expect(i.props['stroke']).not.toBe('#9a978f');
    expect(c.props['stroke']).not.toBe(i.props['stroke']);
  });
});
