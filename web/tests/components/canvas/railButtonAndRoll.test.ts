import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { buildPieces } from '../../../src/components/canvas/rocketPieces';
import { buildAftScene } from '../../../src/components/canvas/AftView';

/**
 * A rail button in every view is its outer diameter across and stands out from
 * the body by its total height plus its screw, the extent the kernel gives an
 * instance (`RailButton.getInstanceBoundingBox`: y to `totalHeight +
 * screwHeight`). ComponentFactory, case "railbutton", sets the total height
 * from `height`; absent, it keeps the constructor's 0.0097 m and no screw
 * (RailButton.java:60-66).
 *
 * The side view turns lugs, rail buttons and off-axis internal parts by the
 * view's roll, as it turns the fins: a part at angle θ draws at θ + roll.
 */
const R = 0.02;
const SCALE = 1000;
const CY = 200;
const tube = (children: ComponentNode[]): ComponentNode =>
  ({ type: 'bodytube', id: 'b', outerRadius: R, thickness: 0.001, length: 0.3, children }) as ComponentNode;

const side = (children: ComponentNode[], roll = 0) =>
  buildSchematicShapes({
    chain: [tube(children)],
    ctx: { scale: SCALE, cy: CY, x0: 0 },
    scale: SCALE,
    w: 800,
    h: 400,
    roll,
    uid: 't',
    setHoverId: () => {},
  });

const button = (extra: Record<string, unknown> = {}): ComponentNode =>
  ({
    type: 'railbutton',
    id: 'rb',
    outerDiameter: 0.008,
    angleOffset: 0,
    position: { method: 'top', offset: 0.1 },
    ...extra,
  }) as ComponentNode;

const t = ((k: string) => k) as unknown as TFunction;

describe('a rail button', () => {
  const sized = button({ height: 0.012, screwHeight: 0.003 });
  const reach = 0.012 + 0.003;

  it('stands out from the body by its height and screw in the side view', () => {
    const box = side([sized]).extents.get('rb')!.box;
    expect(box.y1 - box.y0).toBeCloseTo(reach * SCALE, 6);
    expect(box.x1 - box.x0).toBeCloseTo(0.008 * SCALE, 6);
    // Angle 0 stands above the tube: the outer edge at R + reach.
    expect(box.y0).toBeCloseTo(CY - (R + reach) * SCALE, 6);
  });

  it('is built in 3D as tall as its height and screw', () => {
    const tree = { name: 'T', components: [{ type: 'stage', id: 's', children: [tube([sized])] }] } as RocketTree;
    const [piece] = buildPieces(tree).pieces.filter((p) => p.id === 'rb');
    piece!.geometry.computeBoundingBox();
    const size = piece!.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(reach, 9);
    // Centered half its reach off the surface, at angle 0 (+y).
    expect(piece!.position![1]).toBeCloseTo(R + reach / 2, 9);
  });

  it('reaches from the body by its height and screw in the aft view', () => {
    const scene = buildAftScene(
      [{ type: 'stage', id: 's', children: [tube([sized])] }] as ComponentNode[],
      undefined,
      t,
    );
    const shape = scene.outer.find((s) => s.key === 'rb:0');
    expect(shape?.kind).toBe('fin');
    if (shape?.kind !== 'fin') return;
    expect(shape.from).toBeCloseTo(R, 12);
    expect(shape.to).toBeCloseTo(R + reach, 12);
    expect(shape.thick).toBeCloseTo(0.008, 12);
  });

  it('with no height on record stands at the kernel default', () => {
    const box = side([button()]).extents.get('rb')!.box;
    expect(box.y1 - box.y0).toBeCloseTo(0.0097 * SCALE, 6);
  });
});

/** Every `<rect>` titled `title`, in draw order. */
const rectsTitled = (nodes: ReactNode[], title: string): ReactElement<Record<string, number>>[] =>
  nodes.filter((n): n is ReactElement<Record<string, number>> => {
    if (!isValidElement(n) || n.type !== 'rect') return false;
    const child = (n.props as { children?: ReactNode }).children;
    return isValidElement(child) && (child.props as { children?: ReactNode }).children === title;
  });

describe('the side view roll', () => {
  it('turns a rail button to the far side at 180°', () => {
    const atRest = side([button({ height: 0.01 })], 0).extents.get('rb')!.box;
    const turned = side([button({ height: 0.01 })], Math.PI).extents.get('rb')!.box;
    // Above the axis at rest, below it rolled half a turn.
    expect(atRest.y1).toBeLessThan(CY);
    expect(turned.y0).toBeGreaterThan(CY);
    expect(turned.y0 - CY).toBeCloseTo(CY - atRest.y1, 6);
  });

  it('turns a launch lug to the far side at 180°', () => {
    const lug = {
      type: 'launchlug',
      id: 'lug',
      length: 0.03,
      outerRadius: 0.003,
      angleOffset: 0,
      position: { method: 'top', offset: 0.1 },
    } as ComponentNode;
    expect(side([lug], 0).extents.get('lug')!.box.y1).toBeLessThan(CY);
    expect(side([lug], Math.PI).extents.get('lug')!.box.y0).toBeGreaterThan(CY);
  });

  it('turns a cluster with the rest of the rocket', () => {
    const mount = {
      type: 'innertube',
      id: 'mm',
      name: 'Mount',
      length: 0.07,
      outerRadius: 0.005,
      thickness: 0.0005,
      cluster: 'double',
      position: { method: 'bottom', offset: 0 },
    } as ComponentNode;
    const centers = (roll: number) =>
      rectsTitled(side([mount], roll).overlay, 'Mount').map((r) => r.props['y']! + r.props['height']! / 2);
    // At rest the pair lies across the view, one above the axis and one below.
    const rest = centers(0);
    expect(rest).toHaveLength(2);
    expect(Math.abs(rest[0]! - rest[1]!)).toBeGreaterThan(1);
    // A quarter turn puts both in the line of sight, on the axis.
    for (const c of centers(Math.PI / 2)) expect(c).toBeCloseTo(CY, 6);
  });
});
