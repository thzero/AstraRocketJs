import { describe, it, expect } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { KERNEL_DEFAULTS, KERNEL_MASSCOMPONENT_RADIUS } from '../../../src/tree/kernelDefaults.js';
import { COMPONENT_DEFAULTS } from '../../../src/services/design/componentDefaults';

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
  });
};

/**
 * The internal-component box's radius fallback. A mass component with no
 * `radius` key draws at the kernel's default, because that is what it flies at.
 * Every other internal type keeps the 70% fraction of the parent: the kernel
 * does not read `radius` for a parachute, and the 5 mm mass default would shrink
 * the default design's chute box until its glyph no longer fit.
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
 * A shoulder has to be distinguishable from the tube it is inside.
 *
 * A shoulder is a snug fit by definition, so its box sits within a pixel or two
 * of the tube's own outline, and in a gray close to the tube's stroke there is
 * nothing to see even though the rect is in the DOM. These hold the two things
 * that make it visible (its own ink, and the owning part's color when that part
 * has one) rather than holding that a rect exists.
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
    // The tube it sits in is stroked #7a786f and internal parts with no ink of
    // their own are #9a978f. Either one and the stub is invisible against the wall.
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
 * coupler is the opposite: it fills the bore by definition, so under that cap it
 * would be drawn narrower than it is every time, while the DXF cut sheet, the
 * printed solid and the 3D model size it from the real bore.
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
    // Both are tube segments; in the neutral ink they would be two unlabeled gray
    // boxes, told apart only by size.
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

/**
 * A launch lug with no size keys is drawn at the size the kernel flies it:
 * ComponentFactory's launch lug is 50 mm long with a 2.2 mm outer radius
 * (KERNEL_DEFAULTS.launchlug), the same size the 3D view, the `.ork` writer and
 * RASAero use.
 */
describe('a launch lug with no size keys', () => {
  it('is drawn at the kernel default length and radius', () => {
    // The lug's rect carries no <title>; it is the one shorter than the 300 mm tube.
    const { shapes } = build([{ type: 'launchlug', id: 'l', angleOffset: 0 } as ComponentNode]);
    const lug = shapes
      .filter((n): n is ReactElement<Record<string, unknown>> => isValidElement(n) && n.type === 'rect')
      .find((r) => Number(r.props['width']) < 300);
    expect(lug).toBeDefined();
    expect(lug!.props['width']).toBeCloseTo(KERNEL_DEFAULTS.launchlug.length * 1000, 6);
    expect(lug!.props['height']).toBeCloseTo(2 * KERNEL_DEFAULTS.launchlug.outerRadius * 1000, 6);
  });
});

/**
 * An inner tube is drawn at the size it flies. With no keys that is the kernel's
 * 70 mm long with a 9.5 mm outer radius (ComponentFactory, case "innertube").
 * And a stated radius is drawn as stated: the 85% cap that keeps an invented
 * chute box off the wall is not for a real motor mount.
 */
describe('an inner tube', () => {
  const mount = (o: Record<string, unknown> = {}) =>
    rectsByTitle(build([{ type: 'innertube', id: 'm', ...o } as unknown as ComponentNode]).overlay).get('Inner tube');

  it('is drawn at the kernel default size when it states none', () => {
    const r = mount()!;
    expect(r).toBeDefined();
    expect(r.props['width']).toBeCloseTo(KERNEL_DEFAULTS.innertube.length * 1000, 6);
    expect(r.props['height']).toBeCloseTo(2 * KERNEL_DEFAULTS.innertube.outerRadius * 1000, 6);
  });

  it('is not capped below its stated radius', () => {
    expect(mount({ outerRadius: 0.019, length: 0.1 })!.props['height']).toBeCloseTo(38, 6);
  });
});

/**
 * A nose cone, body tube or transition with no `length` key is laid out at the
 * kernel's length for its type (ComponentFactory: nose 70 mm, body 300 mm,
 * transition 50 mm), not at zero. At zero the part would draw as nothing while
 * the engine flies it full length. An explicit 0 (the phantom tube a T-tail hangs
 * from) is still 0.
 */
describe('a chain part with no length key', () => {
  it('pushes the next part back by the kernel length', () => {
    const { shapes } = buildSchematicShapes({
      chain: [
        { type: 'nosecone', id: 'n', aftRadius: 0.02 } as unknown as ComponentNode,
        { type: 'bodytube', id: 'b', outerRadius: 0.02, length: 0.3 } as ComponentNode,
      ],
      ctx: { scale: 1000, cy: 200, x0: 0 },
      scale: 1000,
      w: 800,
      h: 400,
      roll: 0,
      uid: 't',
      setHoverId: () => {},
    });
    const body = shapes
      .filter((n): n is ReactElement<Record<string, unknown>> => isValidElement(n) && n.type === 'rect')
      .find((r) => Number(r.props['width']) === 300);
    expect(body).toBeDefined();
    expect(body!.props['x']).toBeCloseTo(KERNEL_DEFAULTS.nosecone.length * 1000, 6);
  });
});
