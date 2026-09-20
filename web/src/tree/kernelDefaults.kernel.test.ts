import { describe, expect, it } from 'vitest';
import { KERNEL_DEFAULTS } from './kernelDefaults';
import { defaultNode } from '../services/treeEdit';
import type { ComponentNode } from '../engine/openRocketEngine';

/**
 * Lock `KERNEL_DEFAULTS` to what the kernel actually does.
 *
 * The method is deliberately behavioral rather than declarative. There is no
 * way to ask `ComponentFactory` "what default did you use for bodytube
 * thickness", and a table that merely *claims* to mirror the Java is the same
 * hand-maintained artifact that produced the divergence in the first place.
 *
 * Each case builds the same component twice through the real engine - once
 * with the field absent, once with the value from the table - and requires the
 * observable to be identical.
 *
 * **Every case also asserts its own sensitivity**, because "identical" proves
 * nothing if the observable cannot see the field at all. The first version of
 * this file used component length/mass for all fourteen fields and passed
 * happily with a deliberately wrong mass-component radius: a mass component's
 * mass is an override, so its radius moves neither. Two fields therefore use a
 * whole-rocket observable, where the radius shows up in roll inertia and the
 * pod instance count in total mass.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const loadEngine = async (): Promise<any> => {
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  return import('../engine/vendor/openrocket-engine.mjs' as string);
};

const NOSE = {
  type: 'nosecone',
  id: 'n',
  shape: 'ogive',
  length: 0.07,
  aftRadius: 0.013,
  thickness: 0.001,
} as unknown as ComponentNode;

const TUBE = {
  type: 'bodytube',
  id: 'host',
  length: 0.2,
  outerRadius: 0.013,
  thickness: 0.0005,
} as unknown as ComponentNode;

/** Where the effect of the field shows up. */
type Scope = 'component' | 'rocket';

const build = (engine: any, node: ComponentNode, parent: ComponentNode | null): any => {
  engine.reset();
  const inner = { ...node, id: 'probe' };
  const components = parent ? [NOSE, { ...parent, children: [inner] }] : [NOSE, inner];
  return engine.buildRocket(JSON.stringify({ components }));
};

const observe = (engine: any, node: ComponentNode, parent: ComponentNode | null, scope: Scope): string => {
  const handle = build(engine, node, parent);
  if (scope === 'component') {
    const i = JSON.parse(engine.getComponentInfo(handle, 'probe'));
    if (i.error) throw new Error(`probe failed: ${i.error}`);
    return `${i.length}|${i.mass}|${i.sectionMass}`;
  }
  const s = JSON.parse(engine.getStaticInfo(handle));
  if (s.error) throw new Error(`probe failed: ${s.error}`);
  return `${s.mass}|${s.cg}|${s.rollInertia}|${s.pitchInertia}`;
};

type Case = [
  label: string,
  base: ComponentNode,
  parent: ComponentNode | null,
  field: string,
  expected: number,
  scope: Scope,
  /** A different value, used only to prove the observable can see the field. */
  probeOther: number,
];

const n = (o: Record<string, unknown>) => o as unknown as ComponentNode;

const CASES: Case[] = [
  [
    'masscomponent.radius',
    n({ type: 'masscomponent', mass: 0.01, length: 0.02 }),
    TUBE,
    'radius',
    KERNEL_DEFAULTS.masscomponent.radius,
    'rocket',
    0.01,
  ],
  [
    'railbutton.outerDiameter',
    n({ type: 'railbutton' }),
    TUBE,
    'outerDiameter',
    KERNEL_DEFAULTS.railbutton.outerDiameter,
    'component',
    0.02,
  ],
  [
    'bodytube.thickness',
    n({ type: 'bodytube', length: 0.2, outerRadius: 0.013 }),
    null,
    'thickness',
    KERNEL_DEFAULTS.bodytube.thickness,
    'component',
    0.002,
  ],
  [
    'transition.thickness',
    n({ type: 'transition', shape: 'conical', length: 0.05, foreRadius: 0.013, aftRadius: 0.019 }),
    null,
    'thickness',
    KERNEL_DEFAULTS.transition.thickness,
    'component',
    0.004,
  ],
  [
    'transition.length',
    n({ type: 'transition', shape: 'conical', foreRadius: 0.013, aftRadius: 0.019 }),
    null,
    'length',
    KERNEL_DEFAULTS.transition.length,
    'component',
    0.09,
  ],
  [
    'nosecone.thickness',
    n({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.013 }),
    null,
    'thickness',
    KERNEL_DEFAULTS.nosecone.thickness,
    'component',
    0.004,
  ],
  [
    'nosecone.aftRadius',
    n({ type: 'nosecone', shape: 'ogive', length: 0.1 }),
    null,
    'aftRadius',
    KERNEL_DEFAULTS.nosecone.aftRadius,
    'component',
    0.02,
  ],
  [
    'bulkhead.length',
    n({ type: 'bulkhead', outerRadius: 0.0125 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.bulkhead.length,
    'component',
    0.006,
  ],
  [
    'engineblock.thickness',
    n({ type: 'engineblock', length: 0.005, outerRadius: 0.0092 }),
    TUBE,
    'thickness',
    KERNEL_DEFAULTS.engineblock.thickness,
    'component',
    0.003,
  ],
  [
    'centeringring.length',
    n({ type: 'centeringring', outerRadius: 0.0125, innerRadius: 0.0092 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.centeringring.length,
    'component',
    0.006,
  ],
  [
    'innertube.thickness',
    n({ type: 'innertube', length: 0.07, outerRadius: 0.0092 }),
    TUBE,
    'thickness',
    KERNEL_DEFAULTS.innertube.thickness,
    'component',
    0.002,
  ],
  [
    'launchlug.length',
    n({ type: 'launchlug', outerRadius: 0.0022 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.launchlug.length,
    'component',
    0.09,
  ],
  [
    'streamer.stripLength',
    n({ type: 'streamer', stripWidth: 0.05 }),
    TUBE,
    'stripLength',
    KERNEL_DEFAULTS.streamer.stripLength,
    'component',
    0.9,
  ],
  [
    'podset.instanceCount',
    n({
      type: 'podset',
      children: [{ type: 'bodytube', id: 'pb', length: 0.12, outerRadius: 0.009, thickness: 0.0005 }],
    }),
    TUBE,
    'instanceCount',
    KERNEL_DEFAULTS.podset.instanceCount,
    'rocket',
    4,
  ],
];

describe('KERNEL_DEFAULTS matches the kernel', () => {
  it.each(CASES)('%s', async (_label, base, parent, field, expected, scope, probeOther) => {
    const engine = await loadEngine();
    const absent = observe(engine, base, parent, scope);

    // The observable must be able to see this field, or the assertion below is
    // vacuous. This is not ceremony: it caught two fields that it was.
    const other = observe(engine, n({ ...base, [field]: probeOther }), parent, scope);
    expect(other, 'probe cannot observe this field, so the check below proves nothing').not.toBe(absent);

    const declared = observe(engine, n({ ...base, [field]: expected }), parent, scope);
    expect(declared).toBe(absent);
  });
});

describe('defaultNode does not leave a divergent field unset', () => {
  // Both fields were omitted, so the editor produced a node whose drawing and
  // simulation described different hardware. Setting them explicitly is what
  // makes all four sides agree for a newly created component.
  it('a mass component carries an explicit radius', () => {
    expect(defaultNode('masscomponent')['radius']).toBe(KERNEL_DEFAULTS.masscomponent.radius);
  });

  it('a rail button carries an explicit outer diameter', () => {
    expect(defaultNode('railbutton')['outerDiameter']).toBe(KERNEL_DEFAULTS.railbutton.outerDiameter);
  });
});
