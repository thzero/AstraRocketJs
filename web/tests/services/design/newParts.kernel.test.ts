import { describe, expect, it, vi } from 'vitest';
import { defaultNode } from '../../../src/services/design/treeEdit';
import { defaultMaterialPatch } from '../../../src/services/design/materialSlots';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';
import type { ComponentNode, ComponentType } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { loadEngine } from '../../testing/kernelGeometry';

/** The TeaVM bundle, which is untyped. */
type Engine = Awaited<ReturnType<typeof loadEngine>>;

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A part added from ＋ Add, with no preference set, is the part desktop
 * OpenRocket creates: its constructor's dimensions, material and automatic
 * settings, as the kernel builds them.
 *
 * The seed states those values on the node so the panel shows them. A seed that
 * drifts from the constructor (a rail button stamped Cardboard when
 * `RailButton()` is Delrin, a 24 mm tube fin on any airframe) would show and
 * save one part and fly another.
 *
 * The oracle is the kernel itself: the same type built from a node with no
 * keys, which the bridge fills from the constructor. Every field the kernel
 * reports for that part has to read the same on the seeded part, except the
 * seeds `defaultNode`'s docstring lists as the app's own, which are held here
 * in `APP_CHOICES` so the two lists cannot drift apart silently.
 */

const seeded = (type: ComponentType): ComponentNode =>
  ({ ...defaultNode(type), ...defaultMaterialPatch(type, {}), id: 'probe' }) as ComponentNode;

/**
 * The automatic settings each constructor turns on, which the bridge turns off
 * again for an absent key because its setters take a stated value, so the
 * keyless oracle carries the flag and nothing else:
 * `BodyTube()` (BodyTube.java:42), `Transition()` (Transition.java:49-50),
 * `TubeFinSet` (TubeFinSet.java:26), `TubeCoupler()` (TubeCoupler.java:12),
 * `CenteringRing()` (CenteringRing.java:12-13), `Bulkhead()` (Bulkhead.java:12),
 * `EngineBlock()` (EngineBlock.java:15), `RecoveryDevice` (RecoveryDevice.java:27),
 * `Parachute` (Parachute.java:24), `ShockCord` (ShockCord.java:17).
 */
const CONSTRUCTOR_AUTO: Partial<Record<ComponentType, string[]>> = {
  bodytube: ['outerRadiusAuto'],
  transition: ['foreRadiusAuto', 'aftRadiusAuto'],
  tubefinset: ['outerRadiusAuto'],
  tubecoupler: ['outerRadiusAuto'],
  centeringring: ['outerRadiusAuto', 'innerRadiusAuto'],
  bulkhead: ['outerRadiusAuto'],
  engineblock: ['outerRadiusAuto'],
  parachute: ['cdAuto', 'lineLengthAuto'],
  streamer: ['cdAuto'],
  shockcord: ['cordLengthAuto'],
};

/** The seeds that are the app's own, per `defaultNode`'s docstring, by the kernel field they move. */
const APP_CHOICES: Partial<Record<ComponentType, string[]>> = {
  innertube: ['motorMount', 'motorOverhang'],
  parachute: ['deployEvent'],
  streamer: ['deployEvent'],
  // The seeded tube inside the booster gives it a length, a front that sits
  // that much further forward, a distance from the axis that includes the
  // tube's radius, and a drag coefficient the kernel computes for it.
  parallelstage: ['length', 'positionX', 'instanceRadius', 'overrideCD'],
};

/** Every type the Add menu offers: the table's, less the stage and the fairing nothing in the editor creates. */
const TYPES = (Object.keys(KERNEL_DEFAULTS) as ComponentType[]).filter((t) => t !== 'stage' && t !== 'fairing');

/** The symmetric parts, which sit in the stage's chain; everything else sits inside the body tube. */
const CHAIN: ReadonlySet<ComponentType> = new Set(['nosecone', 'bodytube', 'transition']);

/** The probe in a stage: in the chain behind a nose, or inside a body tube of the given length. */
const design = (probe: ComponentNode, tubeLength = 0.5): unknown => {
  const nose = { type: 'nosecone', id: 'nose', length: 0.1, aftRadius: 0.025 };
  const chain = CHAIN.has(probe.type)
    ? probe.type === 'nosecone'
      ? [probe, { type: 'bodytube', id: 'tube', outerRadius: 0.025, length: tubeLength }]
      : [nose, probe]
    : [nose, { type: 'bodytube', id: 'tube', outerRadius: 0.025, length: tubeLength, children: [probe] }];
  return { components: [{ type: 'stage', id: 'st', children: chain }] };
};

/** The probe's componentInfo in a fresh build. */
const infoOf = (engine: Engine, tree: unknown): Record<string, number | string | undefined> => {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
  expect(info.error).toBeUndefined();
  return info;
};

/** Every field the kernel holds for the probe in a fresh build. */
const fieldsOf = (engine: Engine, tree: unknown): Record<string, unknown> => {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const fields = JSON.parse(engine.getComponentFields(handle, 'probe')) as Record<string, unknown>;
  expect(fields['error']).toBeUndefined();
  return fields;
};

const same = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 + 1e-9 * Math.abs(b) : a === b;

describe('a new part from the add list', () => {
  it.each(TYPES)('%s is the part the kernel builds from a node with no keys', async (type) => {
    const engine = await loadEngine();
    const flags = Object.fromEntries((CONSTRUCTOR_AUTO[type] ?? []).map((flag) => [flag, true]));
    const keyless = fieldsOf(engine, design({ type, id: 'probe', ...flags } as ComponentNode));
    const part = fieldsOf(engine, design(seeded(type)));
    const skip = new Set(APP_CHOICES[type] ?? []);
    const differences = Object.keys(keyless)
      .filter((key) => !skip.has(key) && !same(part[key], keyless[key]))
      .map((key) => `${key}: seeded ${String(part[key])}, constructor ${String(keyless[key])}`);
    expect(differences, differences.join('\n')).toEqual([]);
    // A key listed in APP_CHOICES that the seed does not move is a stale exception.
    const unused = [...skip].filter((key) => same(part[key], keyless[key]));
    expect(unused).toEqual([]);
  });

  it('is a rail button of desktop dimensions and material', async () => {
    const engine = await loadEngine();
    const mass = infoOf(engine, design(seeded('railbutton'))).mass as number;
    expect(mass).toBeGreaterThan(0);
    // A bare node is RailButton() as the kernel constructs it.
    expect(mass).toBeCloseTo(
      infoOf(engine, design({ type: 'railbutton', id: 'probe' } as ComponentNode)).mass as number,
      12,
    );
  });

  it('is a shock cord whose cord follows the rocket, as on desktop', async () => {
    const engine = await loadEngine();
    const short = infoOf(engine, design(seeded('shockcord'), 0.5));
    const long = infoOf(engine, design(seeded('shockcord'), 1.0));
    // The kernel's figure, not the stored one, and it grows with the rocket.
    expect(short.cordLength).not.toBeCloseTo(defaultNode('shockcord')['cordLength'] as number, 6);
    expect(long.cordLength as number).toBeGreaterThan(short.cordLength as number);
    expect(long.mass as number).toBeGreaterThan(short.mass as number);
  });

  it('is a tube fin set sized to the body it is on, as on desktop', async () => {
    const engine = await loadEngine();
    const fins = seeded('tubefinset');
    expect(fins['outerRadiusAuto']).toBe(true);
    expect(fins['outerRadius']).toBeUndefined();
    expect(fins['thickness']).toBeUndefined();
    // Two airframes, two tube radii: the kernel sizes the tubes from the body.
    const narrow = fieldsOf(engine, {
      components: [
        { type: 'nosecone', id: 'nose', length: 0.1, aftRadius: 0.0125 },
        { type: 'bodytube', id: 'tube', outerRadius: 0.0125, length: 0.5, children: [fins] },
      ],
    });
    const wide = fieldsOf(engine, design(fins));
    expect(narrow['outerRadius'] as number).toBeLessThan(wide['outerRadius'] as number);
  });

  it('is a pod set of two copies with nothing in it, as on desktop', async () => {
    const engine = await loadEngine();
    const pods = seeded('podset');
    expect(pods.children ?? []).toHaveLength(0);
    const info = infoOf(engine, design(pods));
    expect(info.error).toBeUndefined();
    expect(fieldsOf(engine, design(pods))['instanceCount']).toBe(KERNEL_DEFAULTS.podset.instanceCount);
  });

  it('is a booster that builds beside its tube and flies two copies', async () => {
    const engine = await loadEngine();
    const booster = seeded('parallelstage');
    const info = infoOf(engine, design(booster));
    expect(info.sectionMass as number).toBeGreaterThan(0);
    const handle = engine.buildRocket(JSON.stringify(design(booster)));
    const stat = JSON.parse(engine.getStaticInfo(handle));
    expect(stat.error).toBeUndefined();
    expect(booster['instanceCount']).toBe(2);
  });
});
