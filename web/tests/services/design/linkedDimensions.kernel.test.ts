// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { FIELDS } from '../../../src/services/design/componentFields';
import {
  RAIL_BUTTON_FALLBACK,
  clampToBounds,
  settleLinkedDimensions,
  settleRailButtonLoad,
} from '../../../src/services/design/linkedDimensions';
import { num } from '../../../src/tree/nodeProps';
import { importOrk } from '../../../src/services/files/orkFile';
import { syncAutoRadii } from '../../../src/services/design/autoRadius';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine, walkTree } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The panel's bounds on a rail button's and a centering ring's linked
 * dimensions, against the kernel that flies them.
 *
 * Each case types a value into one field the way the panel does (clamped by
 * that field's declared bounds), builds the resulting part in the kernel, and
 * reads it back: every linked dimension has to come back as the panel holds it.
 * Without the bounds, or with the bridge setting the heights in an order that
 * clamps against the constructor's, the kernel flies a different part.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
});

const field = (type: string, key: string) => {
  const f = FIELDS[type]!.find((x) => x.key === key);
  if (!f) throw new Error(`${type} has no ${key} field`);
  return f;
};

/** Type `v` into the field the way the panel stores it. */
const typeInto = (node: ComponentNode, key: string, v: number): ComponentNode => ({
  ...node,
  [key]: clampToBounds(node, field(node.type, key).bounds, v),
});

const design = (part: ComponentNode): RocketTree =>
  ({
    name: 'Linked',
    components: [
      {
        type: 'stage',
        id: 's',
        name: 'S',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.03 },
          { type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.03, thickness: 0.001, children: [part] },
        ],
      },
    ],
  }) as unknown as RocketTree;

const flown = (part: ComponentNode) => kernelGeometry(engine, design(part)).get(part.id as string)!;

const button = (o: object): ComponentNode =>
  ({
    id: 'rb',
    type: 'railbutton',
    outerDiameter: 0.01,
    innerDiameter: 0.006,
    height: 0.01,
    baseHeight: 0.002,
    flangeHeight: 0.002,
    ...o,
  }) as unknown as ComponentNode;

/** The button's linked dimensions as the panel holds them, and as the kernel flies them. */
const held = (node: ComponentNode) => ({
  outerDiameter: node['outerDiameter'],
  innerDiameter: node['innerDiameter'],
  totalHeight: node['height'],
  baseHeight: node['baseHeight'],
  flangeHeight: node['flangeHeight'],
});
const flownButton = (node: ComponentNode) => {
  const k = flown(node);
  return {
    outerDiameter: k.outerDiameter,
    innerDiameter: k.innerDiameter,
    totalHeight: k.totalHeight,
    baseHeight: k.baseHeight,
    flangeHeight: k.flangeHeight,
  };
};

describe('rail button bounds against the kernel', () => {
  it.each([
    ['innerDiameter above the outer', 'innerDiameter', 0.02, 0.01],
    ['outerDiameter below the bore', 'outerDiameter', 0.004, 0.006],
    ['height below base and flange', 'height', 0.001, 0.004],
    ['baseHeight past the height left by the flange', 'baseHeight', 0.009, 0.008],
    ['flangeHeight past the height left by the base', 'flangeHeight', 0.009, 0.008],
  ])('%s', (_name, key, typed, clamped) => {
    const node = typeInto(button({}), key, typed);
    expect(node[key]).toBeCloseTo(clamped, 12);
    expect(flownButton(node)).toEqual(held(node));
  });

  it.each([
    // Both under the constructor's 2 mm base and flange.
    ['a height under the constructor base and flange', { height: 0.003, baseHeight: 0, flangeHeight: 0 }],
    // A base past the constructor's height minus its flange.
    ['a base past the constructor room for it', { height: 0.01, baseHeight: 0.009, flangeHeight: 0.0005 }],
  ])('builds heights that agree exactly: %s', (_name, o) => {
    const node = button(o);
    expect(flownButton(node)).toEqual(held(node));
  });
});

describe('stored linked dimensions settled as the kernel builds them', () => {
  it.each([
    ['a base past the room the flange leaves', { height: 0.01, baseHeight: 0.009, flangeHeight: 0.002 }],
    ['a bore past the outer diameter', { outerDiameter: 0.006, innerDiameter: 0.008 }],
    ['a base and flange past the height', { height: 0.003, baseHeight: 0.004, flangeHeight: 0.002 }],
    ['an absent bore past a small outer diameter', { outerDiameter: 0.005, innerDiameter: undefined }],
  ])('%s', (_name, o) => {
    const raw = button(o);
    const node = settleLinkedDimensions(design(raw)).components[0]!.children![1]!.children![0]!;
    const full = Object.fromEntries(
      (['outerDiameter', 'innerDiameter', 'height', 'baseHeight', 'flangeHeight'] as const).map((k) => [
        k,
        num(node, k, RAIL_BUTTON_FALLBACK[k]),
      ]),
    );
    const settled = { ...node, ...full } as ComponentNode;
    expect(flownButton(raw)).toEqual(held(settled));
  });

  it('a fixed ring outer radius raised to its inner radius', () => {
    const raw = {
      id: 'cr',
      type: 'centeringring',
      length: 0.003,
      outerRadius: 0.01,
      innerRadius: 0.015,
    } as ComponentNode;
    const node = settleLinkedDimensions(design(raw)).components[0]!.children![1]!.children![0]!;
    const k = flown(raw);
    expect(node['outerRadius']).toBe(k.outerRadius);
    expect(node['innerRadius']).toBe(k.innerRadius);
  });
});

describe('centering ring bounds against the kernel', () => {
  const ring = (o: object): ComponentNode =>
    ({ id: 'cr', type: 'centeringring', length: 0.003, outerRadius: 0.02, innerRadius: 0.01, ...o }) as ComponentNode;

  it.each([
    ['innerRadius above the outer', 'innerRadius', 0.025],
    ['outerRadius below the inner', 'outerRadius', 0.005],
  ])('%s', (_name, key, typed) => {
    const node = typeInto(ring({}), key, typed);
    expect(node['innerRadius']).toBeLessThanOrEqual(node['outerRadius'] as number);
    const k = flown(node);
    expect(k.outerRadius).toBe(node['outerRadius']);
    expect(k.innerRadius).toBe(node['innerRadius']);
  });
});

describe('.ork import of linked dimensions', () => {
  const ork = (inner: string) => `<?xml version="1.0" encoding="utf-8"?>
<openrocket version="1.9" creator="test"><rocket><name>R</name><subcomponents>
<stage><name>S</name><subcomponents>
<bodytube><name>B</name><length>0.3</length><thickness>0.001</thickness><radius>0.03</radius><subcomponents>
${inner}
</subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;

  const imported = (inner: string, type: string): ComponentNode => {
    const tree = importOrk(ork(inner)).tree;
    const hit = walkTree(tree).find((v) => v.node.type === type);
    if (!hit) throw new Error(`no ${type} imported`);
    return hit.node;
  };

  it('loads a rail button through the setters, in the order the desktop runs them', () => {
    // Height under the constructor's base and flange, a bore wider than the
    // button and a base taller than the height: desktop raises the height to
    // 4 mm, cuts the bore to the outside and the base to the room the flange
    // leaves.
    const node = imported(
      `<railbutton><name>RB</name><outerdiameter>0.008</outerdiameter><innerdiameter>0.012</innerdiameter>
<height>0.003</height><baseheight>0.005</baseheight><flangeheight>0.001</flangeheight></railbutton>`,
      'railbutton',
    );
    const want = settleRailButtonLoad({
      outerDiameter: 0.008,
      innerDiameter: 0.012,
      height: 0.003,
      baseHeight: 0.005,
      flangeHeight: 0.001,
    });
    expect(want).toMatchObject({ innerDiameter: 0.008, height: 0.004, baseHeight: 0.002, flangeHeight: 0.001 });
    // A value equal to the kernel default is left off the node and flies as that default.
    const dims = Object.fromEntries(
      (['outerDiameter', 'innerDiameter', 'height', 'baseHeight', 'flangeHeight'] as const).map((k) => [
        k,
        num(node, k, RAIL_BUTTON_FALLBACK[k]),
      ]),
    );
    const { screwHeight: _screw, ...settled } = want;
    expect(dims).toEqual(settled);
    const full = { ...node, ...dims, id: 'rb' } as ComponentNode;
    expect(flownButton(full)).toEqual(held(full));
  });

  it('keeps an automatic ring outer radius at the bore when the inner radius is past it, as the kernel flies it', () => {
    // The bridge sets the radii before the part has a parent, then turns the
    // outer radius back to automatic: the outer follows the 29 mm bore and the
    // inner keeps the 40 mm the file states.
    const tree = syncAutoRadii(
      importOrk(
        ork(
          `<centeringring><name>CR</name><length>0.003</length><outerradius>auto</outerradius><innerradius>0.04</innerradius></centeringring>`,
        ),
      ).tree,
    );
    const node = walkTree(tree).find((v) => v.node.type === 'centeringring')!.node;
    expect(node['outerRadiusAuto']).toBe(true);
    const k = kernelGeometry(engine, tree).get(node.id as string)!;
    expect(k.outerRadius).toBeCloseTo(0.029, 12);
    expect(node['outerRadius']).toBe(k.outerRadius);
    expect(node['innerRadius']).toBe(k.innerRadius);
  });

  it('raises a centering ring outer radius to an inner radius past it', () => {
    const node = imported(
      `<centeringring><name>CR</name><length>0.003</length><outerradius>0.01</outerradius><innerradius>0.015</innerradius></centeringring>`,
      'centeringring',
    );
    expect(node['outerRadius']).toBe(0.015);
    expect(node['innerRadius']).toBe(0.015);
    const k = flown({ ...node, id: 'cr' } as ComponentNode);
    expect(k.outerRadius).toBe(0.015);
    expect(k.innerRadius).toBe(0.015);
  });
});
