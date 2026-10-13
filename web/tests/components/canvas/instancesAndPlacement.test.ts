import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { buildPieces } from '../../../src/components/canvas/rocketPieces';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { lineInstances, placementOffsets } from '../../../src/tree/placement';
import { MAX_INSTANCE_COUNT } from '../../../src/tree/nodeProps';

/**
 * The drawings put every copy of a part where the kernel flies it.
 *
 * Along the body, `getInstanceOffsets` (RadiusRingComponent, LaunchLug,
 * RailButton) puts copy i at `i × instanceSeparation` behind the first. Across
 * it, `RingComponent` and `MassObject` put a part at `radialPosition` in its
 * `radialDirection` (y = r cos θ, z = r sin θ), and `InnerTube.getClusterPoints`
 * shifts a cluster by the same.
 */
const tube = (children: ComponentNode[]): ComponentNode =>
  ({ type: 'bodytube', id: 'b', length: 0.4, outerRadius: 0.03, thickness: 0.001, children }) as ComponentNode;
const piecesOf = (children: ComponentNode[], id: string) =>
  buildPieces({
    name: 'T',
    components: [{ type: 'stage', id: 's', children: [tube(children)] }],
  } as RocketTree).pieces.filter((p) => p.id === id);

describe('a part repeated along the body', () => {
  const rings = {
    type: 'centeringring',
    id: 'cr',
    length: 0.003,
    outerRadius: 0.029,
    innerRadius: 0.01,
    instanceCount: 3,
    instanceSeparation: 0.05,
    position: { method: 'top', offset: 0.1 },
  } as ComponentNode;

  it('is one node per copy, each one separation behind the last', () => {
    expect(lineInstances(rings).map((n) => n.position?.offset)).toEqual([0.1, 0.15000000000000002, 0.2]);
  });

  it('is built once per copy in 3D, at those stations', () => {
    const xs = piecesOf([rings], 'cr').map((p) => p.position![0]);
    expect(xs).toHaveLength(3);
    expect(xs[1]! - xs[0]!).toBeCloseTo(0.05, 12);
    expect(xs[2]! - xs[1]!).toBeCloseTo(0.05, 12);
  });

  // Every view loops on this count, so it takes the same ceiling as every other
  // instance count, or a hostile file locks the tab.
  it('stops at the instance ceiling', () => {
    expect(lineInstances({ ...rings, instanceCount: 100000 })).toHaveLength(MAX_INSTANCE_COUNT);
  });

  it('leaves a part the kernel does not repeat as it is', () => {
    const block = { type: 'engineblock', id: 'eb', instanceCount: 3 } as ComponentNode;
    expect(lineInstances(block)).toEqual([block]);
  });
});

describe('a part placed off the axis', () => {
  it('is drawn at its radial position, in its radial direction', () => {
    const mass = {
      type: 'masscomponent',
      id: 'm',
      mass: 0.05,
      length: 0.03,
      radius: 0.01,
      radialPosition: 0.015,
      radialDirection: Math.PI / 2,
      position: { method: 'top', offset: 0.1 },
    } as ComponentNode;
    const [off] = placementOffsets(mass, 0.01);
    expect(off!.y).toBeCloseTo(0, 12);
    expect(off!.z).toBeCloseTo(0.015, 12);
    const [piece] = piecesOf([mass], 'm');
    expect(piece!.position![1]).toBeCloseTo(0, 12);
    expect(piece!.position![2]).toBeCloseTo(0.015, 12);
  });

  it('shifts a single motor mount off the axis by its own offset', () => {
    const mount = {
      type: 'innertube',
      id: 'mm',
      length: 0.07,
      outerRadius: 0.0095,
      radialPosition: 0.015,
      radialDirection: 0,
    } as ComponentNode;
    const [off] = placementOffsets(mount, 0.0095);
    expect(off!.y).toBeCloseTo(0.015, 12);
    expect(off!.z).toBeCloseTo(0, 12);
  });
});

/**
 * The side view's +y is up, for every part: a lug at angle 0 stands above the
 * body (y = R cos 0), and a part placed at radial direction 0 sits above the
 * axis by the same rule, not mirrored below it.
 */
describe('the side view', () => {
  const shapes = (children: ComponentNode[]) =>
    buildSchematicShapes({
      chain: [tube(children)],
      ctx: { scale: 1000, cy: 200, x0: 0 },
      scale: 1000,
      w: 800,
      h: 400,
      roll: 0,
      uid: 't',
      setHoverId: () => {},
    }).extents;

  it('draws a part at radial direction 0 above the axis, on the side a lug at angle 0 stands', () => {
    const ext = shapes([
      {
        type: 'masscomponent',
        id: 'm',
        mass: 0.05,
        length: 0.03,
        radius: 0.005,
        radialPosition: 0.015,
        radialDirection: 0,
        position: { method: 'top', offset: 0.1 },
      } as ComponentNode,
      {
        type: 'launchlug',
        id: 'l',
        length: 0.03,
        outerRadius: 0.002,
        angleOffset: 0,
        position: { method: 'top', offset: 0.2 },
      } as ComponentNode,
    ]);
    const mass = ext.get('m')!.box;
    const lug = ext.get('l')!.box;
    // SVG y grows down: above the axis (cy 200) is a smaller y.
    expect((mass.y0 + mass.y1) / 2).toBeCloseTo(200 - 15, 6);
    expect(lug.y1).toBeLessThan(200);
  });
});
