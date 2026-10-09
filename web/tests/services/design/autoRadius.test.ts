// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { syncAutoRadii } from '../../../src/services/design/autoRadius';
import { addPart, catalogPatch, defaultNode, updateNode } from '../../../src/services/design/treeEdit';
import { importOrk, exportOrk } from '../../../src/services/files/orkFile';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';

/**
 * Automatic diameters: OpenRocket's Automatic checkbox, where a part takes the
 * diameter of the one next door.
 *
 * The rule under test is the kernel's, from `BodyTube.getAutoOuterRadius`:
 * behind first, then ahead, skipping a neighbor whose own facing end is itself
 * automatic, which is what stops two parts pointing at each other. Getting the
 * side wrong is the failure that hides, because on a plain body tube both
 * answers are the same and only a transition tells them apart.
 */
const stage = (children: ComponentNode[]) =>
  ({ name: 'T', components: [{ type: 'stage', name: 'S', children }] }) as unknown as RocketTree;

const chainOf = (t: RocketTree) => (t.components[0] as unknown as { children: ComponentNode[] }).children;

const tube = (id: string, outerRadius: number) =>
  ({ type: 'bodytube', id, length: 0.3, outerRadius, thickness: 0.001 }) as unknown as ComponentNode;

describe('syncAutoRadii', () => {
  it('takes a body tube diameter from the part behind it', () => {
    const t = syncAutoRadii(
      stage([
        { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.025 } as unknown as ComponentNode,
        { type: 'bodytube', id: 'b', length: 0.3, outerRadiusAuto: true } as unknown as ComponentNode,
      ]),
    );
    expect(chainOf(t)[1]!['outerRadius']).toBeCloseTo(0.025, 9);
  });

  it('looks ahead when there is nothing behind', () => {
    const t = syncAutoRadii(
      stage([
        { type: 'bodytube', id: 'b', length: 0.3, outerRadiusAuto: true } as unknown as ComponentNode,
        tube('c', 0.019),
      ]),
    );
    expect(chainOf(t)[0]!['outerRadius']).toBeCloseTo(0.019, 9);
  });

  it('reads the END that faces it, which only a transition can prove', () => {
    // The transition is 30 mm at the end it shows the tube behind it and 10 mm
    // at the other. A rule that grabbed "the neighbor's radius" without saying
    // which end would take 0.01 and no plain-tube test would notice.
    const t = syncAutoRadii(
      stage([
        {
          type: 'transition',
          id: 'tr',
          length: 0.05,
          foreRadius: 0.01,
          aftRadius: 0.03,
        } as unknown as ComponentNode,
        { type: 'bodytube', id: 'b', length: 0.3, outerRadiusAuto: true } as unknown as ComponentNode,
      ]),
    );
    expect(chainOf(t)[1]!['outerRadius']).toBeCloseTo(0.03, 9);
  });

  it('gives a transition each end its own neighbor', () => {
    const t = syncAutoRadii(
      stage([
        tube('a', 0.026),
        {
          type: 'transition',
          id: 'tr',
          length: 0.05,
          foreRadiusAuto: true,
          aftRadiusAuto: true,
        } as unknown as ComponentNode,
        tube('b', 0.014),
      ]),
    );
    const tr = chainOf(t)[1]!;
    expect(tr['foreRadius']).toBeCloseTo(0.026, 9);
    expect(tr['aftRadius']).toBeCloseTo(0.014, 9);
  });

  it('will not follow a neighbor that is itself automatic', () => {
    // Two tubes both on auto: the second must not copy the first's resolved
    // guess, or one of them silently defines the other.
    const t = syncAutoRadii(
      stage([
        { type: 'bodytube', id: 'a', length: 0.3, outerRadiusAuto: true } as unknown as ComponentNode,
        { type: 'bodytube', id: 'b', length: 0.3, outerRadiusAuto: true } as unknown as ComponentNode,
      ]),
    );
    for (const n of chainOf(t)) expect(n['outerRadius']).toBeCloseTo(KERNEL_DEFAULTS.bodytube.outerRadius, 9);
  });

  it('touches nothing without the flag', () => {
    const before = stage([tube('a', 0.026), tube('b', 0.014)]);
    expect(syncAutoRadii(before)).toBe(before);
  });

  it('follows the neighbor through an edit', () => {
    let t = syncAutoRadii(
      stage([
        { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.025 } as unknown as ComponentNode,
        { type: 'bodytube', id: 'b', length: 0.3, outerRadiusAuto: true } as unknown as ComponentNode,
      ]),
    );
    t = updateNode(t, 'n', { aftRadius: 0.031 });
    expect(chainOf(t)[1]!['outerRadius']).toBeCloseTo(0.031, 9);
  });
});

describe('the automatic state through a file', () => {
  const xml = exportOrk({
    name: 'Auto',
    tree: stage([
      { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.1, aftRadius: 0.025, thickness: 0.001 },
      { type: 'bodytube', id: 'b', length: 0.3, thickness: 0.001, outerRadiusAuto: true },
    ] as unknown as ComponentNode[]),
  });

  it('writes an automatic diameter as auto', () => {
    expect(xml).toContain('<radius>auto</radius>');
  });

  it('reads it back as automatic AND resolved', () => {
    // Resolved at import, not at the first edit: everything downstream reads a
    // plain radius, and an unresolved one draws at a default nobody chose: the
    // kernel would fly the neighbor's diameter while the schematic and the 3D
    // view drew the fallback.
    const back = importOrk(xml).tree;
    const bt = chainOf(back).find((n) => n.type === 'bodytube')!;
    expect(bt['outerRadiusAuto']).toBe(true);
    expect(bt['outerRadius']).toBeCloseTo(0.025, 9);
  });
});

/**
 * The automatic values that are not diameters: a ring filling its tube, a tube
 * fin sized from the body, a packed radius taking the room its parent gives it,
 * and the three the kernel works out for itself. Each is `auto` in the file and
 * a checkbox on the desktop, and each must resolve rather than arrive as a
 * silent default.
 */
describe('automatic values other than the neighbor rule', () => {
  const inTube = (child: ComponentNode) =>
    ({
      name: 'T',
      components: [
        {
          type: 'stage',
          name: 'S',
          children: [
            { type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.026, thickness: 0.001, children: [child] },
          ],
        },
      ],
    }) as unknown as RocketTree;

  const kid = (t: RocketTree) =>
    ((t.components[0] as unknown as { children: ComponentNode[] }).children[0]!.children as ComponentNode[])[0]!;

  it('fills a ring to the bore of the tube it sits in', () => {
    const t = syncAutoRadii(
      inTube({ type: 'centeringring', id: 'cr', length: 0.003, outerRadiusAuto: true } as unknown as ComponentNode),
    );
    expect(kid(t)['outerRadius']).toBeCloseTo(0.025, 9); // 26 mm tube, 1 mm wall
  });

  it('gives a mass object the room its parent has', () => {
    const t = syncAutoRadii(
      inTube({
        type: 'masscomponent',
        id: 'm',
        mass: 0.02,
        length: 0.02,
        radiusAuto: true,
      } as unknown as ComponentNode),
    );
    expect(kid(t)['radius']).toBeCloseTo(0.025, 9);
  });

  /**
   * A disc inside an automatic-radius coupler, which is every coupler the Add
   * menu makes.
   *
   * The parent must resolve before the child: resolving inside-out gives the
   * child its parent's bare default rather than the bore the parent takes from
   * the airframe. That number is what the schematic draws, what the DXF cuts and
   * what the 1:1 template measures.
   */
  it('fills a ring to the bore of an automatic coupler, not the coupler default', () => {
    const t = syncAutoRadii(
      inTube({
        type: 'tubecoupler',
        id: 'cp',
        length: 0.03,
        thickness: 0.0005,
        outerRadius: 0.0125, // the Add menu's default, pending resolution
        outerRadiusAuto: true,
        children: [{ type: 'bulkhead', id: 'bh', length: 0.003, outerRadius: 0.0125, outerRadiusAuto: true }],
      } as unknown as ComponentNode),
    );
    const coupler = kid(t);
    const bulkhead = (coupler.children as ComponentNode[])[0]!;
    expect(coupler['outerRadius']).toBeCloseTo(0.025, 9); // the 26 mm tube's bore
    expect(bulkhead['outerRadius']).toBeCloseTo(0.0245, 9); // the coupler's bore
  });

  it('sizes a tube fin set from the body and the fin count', () => {
    const t = syncAutoRadii(
      inTube({
        type: 'tubefinset',
        id: 'tf',
        finCount: 6,
        length: 0.1,
        outerRadiusAuto: true,
      } as unknown as ComponentNode),
    );
    // Six tubes ringing a 26 mm body: the kernel's own auto-size, not a default.
    expect(kid(t)['outerRadius']).toBeGreaterThan(0);
    expect(kid(t)['outerRadius']).toBeLessThan(0.026);
  });
});

describe('the values the kernel works out, through a file', () => {
  const chute = (extra: Record<string, unknown>) =>
    ({
      name: 'R',
      components: [
        {
          type: 'stage',
          name: 'S',
          children: [
            {
              type: 'bodytube',
              id: 'b',
              length: 0.3,
              outerRadius: 0.026,
              thickness: 0.001,
              children: [{ type: 'parachute', id: 'p', diameter: 0.4, lineCount: 6, ...extra }],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  const find = (t: RocketTree, type: string): ComponentNode => {
    const walk = (ns: ComponentNode[]): ComponentNode | undefined => {
      for (const n of ns) {
        if (n.type === type) return n;
        const hit = walk((n.children ?? []) as ComponentNode[]);
        if (hit) return hit;
      }
      return undefined;
    };
    return walk(t.components)!;
  };

  it('keeps an automatic drag coefficient automatic', () => {
    const xml = exportOrk({ name: 'R', tree: chute({ cdAuto: true }) });
    expect(xml).toContain('<cd>auto</cd>');
    expect(find(importOrk(xml).tree, 'parachute')['cdAuto']).toBe(true);
  });

  it('keeps an automatic shroud-line length', () => {
    const xml = exportOrk({ name: 'R', tree: chute({ lineLengthAuto: true }) });
    expect(xml).toContain('<linelength>auto</linelength>');
    expect(find(importOrk(xml).tree, 'parachute')['lineLengthAuto']).toBe(true);
  });

  it('writes a packed radius the way the desktop does, marker and value', () => {
    // `auto 0.025`, not a bare marker: MassObjectSaver writes both so a reader
    // that does not understand the flag still gets a usable size.
    const xml = exportOrk({ name: 'R', tree: chute({ radiusAuto: true, radius: 0.025 }) });
    expect(xml).toMatch(/<packedradius>auto 0\.025<\/packedradius>/);
    const back = find(importOrk(xml).tree, 'parachute');
    expect(back['radiusAuto']).toBe(true);
    expect(back['radius']).toBeCloseTo(0.025, 9);
  });
});

/**
 * A new bore-filling part starts automatic, because that is what its kernel
 * constructor does.
 *
 * `TubeCoupler()`, `Bulkhead()` and `EngineBlock()` each call
 * `setOuterRadiusAutomatic(true)`; `CenteringRing()` turns on both its outer
 * radius and its inner one. With the flags off, a ring dropped into a 54 mm
 * airframe would keep its default size and simulate quietly at it until someone
 * ticked the checkbox.
 */
describe('what a new part starts as', () => {
  it.each([
    ['centeringring', ['outerRadiusAuto', 'innerRadiusAuto']],
    ['bulkhead', ['outerRadiusAuto']],
    ['tubecoupler', ['outerRadiusAuto']],
    ['engineblock', ['outerRadiusAuto']],
  ] as const)('gives a new %s its automatic diameters', (type, flags) => {
    const node = defaultNode(type);
    for (const flag of flags) expect(node[flag], `${type}.${flag}`).toBe(true);
  });

  it('leaves an inner tube pinned, since the kernel sizes one to a motor', () => {
    // `InnerTube()` sets an explicit A-C motor size and no automatic flag: a
    // motor mount is sized by the motor, not by the tube around it.
    expect(defaultNode('innertube')['outerRadiusAuto']).toBeUndefined();
  });

  it('resolves the new part against the tube it lands in, in the same edit', () => {
    // `tube` takes a radius: 26 mm of it, with a 1 mm wall, so the bore radius
    // is 25 mm. The ring fills it rather than keeping its 12.5 mm default radius.
    const host = tube('b', 0.026);
    const { tree, id } = addPart(stage([host]), 'centeringring', 'b');
    const ring = (chainOf(tree)[0]!.children as ComponentNode[])[0]!;
    expect(ring.id).toBe(id);
    expect(ring['outerRadius']).toBeCloseTo(0.025, 9);
    // No motor mount beside it, so the bore is 0 - a solid disc, which is what
    // `CenteringRing.getInnerRadius` gives with no InnerTube sibling too.
    expect(ring['innerRadius']).toBe(0);
  });

  it('follows the mount when there is one', () => {
    const host = { ...tube('b', 0.026), children: [] as ComponentNode[] } as unknown as ComponentNode;
    host.children = [
      { type: 'innertube', id: 'mt', length: 0.07, outerRadius: 0.0095, motorMount: true } as unknown as ComponentNode,
    ];
    const { tree } = addPart(stage([host]), 'centeringring', 'b');
    const kids = chainOf(tree)[0]!.children as ComponentNode[];
    const ring = kids.find((n) => n.type === 'centeringring')!;
    expect(ring['innerRadius']).toBeCloseTo(0.0095, 9);
  });
});

/**
 * A dimension a picked part states pins itself.
 *
 * The kernel's setters do this - `RadiusRingComponent.setOuterRadius` clears
 * `outerRadiusAutomatic` - and here it is load-bearing: applied to a ring whose
 * diameter is automatic, an unpinned patch is overwritten by `syncAutoRadii` on
 * its next pass, so the picker would read as doing nothing at all.
 */
describe('applying a catalog part', () => {
  // 40 mm outside, deliberately not the 50 mm bore of the tube it lands in: a part
  // whose diameter happened to equal the resolved one would pass this whether
  // it was pinned or overwritten.
  const row = (over: Record<string, unknown>) =>
    ({ type: 'centeringring', outerDiameter: 0.04, innerDiameter: 0.029, length: 0.003, ...over }) as never;

  it('turns the automatic flag off for each diameter it states', () => {
    const patch = catalogPatch(row({}));
    expect(patch['outerRadiusAuto']).toBe(false);
    expect(patch['innerRadiusAuto']).toBe(false);
  });

  it('survives the resolver it would otherwise lose to', () => {
    // Automatic would give the ring the 25 mm bore radius of the tube; the
    // picked part is 40 mm across, so 20 mm.
    const { tree, id } = addPart(stage([tube('b', 0.026)]), 'centeringring', 'b');
    const picked = updateNode(tree, id, catalogPatch(row({})));
    const ring = (chainOf(syncAutoRadii(picked))[0]!.children as ComponentNode[])[0]!;
    expect(ring['outerRadius']).toBeCloseTo(0.02, 9); // the part, not the bore
    expect(ring['innerRadius']).toBeCloseTo(0.0145, 9);
  });
});
