import { describe, expect, it } from 'vitest';
import { KERNEL_DEFAULTS, kernelLength } from './kernelDefaults';
import { defaultNode } from '../services/treeEdit';
import type { ComponentNode, ComponentType } from '../engine/openRocketEngine';

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
  // ---- The per-type lengths and the fin planform defaults ------------------
  // These used to live outside this table: `position.axialLength` fell back to
  // 0.025 for every non-fin type, `finPlanform.FIN_DEFAULTS` was declared as
  // "what treeEdit writes", and `tubefins` had a bare 6. Every one is now read
  // from KERNEL_DEFAULTS and pinned here against the engine.
  [
    'nosecone.length',
    n({ type: 'nosecone', shape: 'ogive', aftRadius: 0.013 }),
    null,
    'length',
    KERNEL_DEFAULTS.nosecone.length,
    'component',
    0.12,
  ],
  [
    'bodytube.length',
    n({ type: 'bodytube', outerRadius: 0.013 }),
    null,
    'length',
    KERNEL_DEFAULTS.bodytube.length,
    'component',
    0.5,
  ],
  [
    'bodytube.outerRadius',
    n({ type: 'bodytube', length: 0.2 }),
    null,
    'outerRadius',
    KERNEL_DEFAULTS.bodytube.outerRadius,
    'component',
    0.02,
  ],
  [
    'trapezoidfinset.rootChord',
    n({ type: 'trapezoidfinset', tipChord: 0.03, sweep: 0.02, height: 0.03, thickness: 0.003 }),
    TUBE,
    'rootChord',
    KERNEL_DEFAULTS.trapezoidfinset.rootChord,
    'component',
    0.09,
  ],
  [
    'trapezoidfinset.tipChord',
    n({ type: 'trapezoidfinset', rootChord: 0.05, sweep: 0.02, height: 0.03, thickness: 0.003 }),
    TUBE,
    'tipChord',
    KERNEL_DEFAULTS.trapezoidfinset.tipChord,
    'component',
    0.01,
  ],
  // Sweep moves the fin's CG, not its area, so only a whole-rocket observable
  // (cg, pitch inertia) can see it.
  [
    'trapezoidfinset.sweep',
    n({ type: 'trapezoidfinset', rootChord: 0.05, tipChord: 0.03, height: 0.03, thickness: 0.003 }),
    TUBE,
    'sweep',
    KERNEL_DEFAULTS.trapezoidfinset.sweep,
    'rocket',
    0.05,
  ],
  [
    'trapezoidfinset.height',
    n({ type: 'trapezoidfinset', rootChord: 0.05, tipChord: 0.03, sweep: 0.02, thickness: 0.003 }),
    TUBE,
    'height',
    KERNEL_DEFAULTS.trapezoidfinset.height,
    'component',
    0.06,
  ],
  [
    'trapezoidfinset.finCount',
    n({ type: 'trapezoidfinset', rootChord: 0.05, tipChord: 0.03, sweep: 0.02, height: 0.03, thickness: 0.003 }),
    TUBE,
    'finCount',
    KERNEL_DEFAULTS.trapezoidfinset.finCount,
    'rocket',
    4,
  ],
  [
    'ellipticalfinset.rootChord',
    n({ type: 'ellipticalfinset', height: 0.03, thickness: 0.003 }),
    TUBE,
    'rootChord',
    KERNEL_DEFAULTS.ellipticalfinset.rootChord,
    'component',
    0.09,
  ],
  [
    'ellipticalfinset.height',
    n({ type: 'ellipticalfinset', rootChord: 0.05, thickness: 0.003 }),
    TUBE,
    'height',
    KERNEL_DEFAULTS.ellipticalfinset.height,
    'component',
    0.06,
  ],
  [
    'ellipticalfinset.finCount',
    n({ type: 'ellipticalfinset', rootChord: 0.05, height: 0.03, thickness: 0.003 }),
    TUBE,
    'finCount',
    KERNEL_DEFAULTS.ellipticalfinset.finCount,
    'rocket',
    4,
  ],
  [
    'freeformfinset.finCount',
    n({
      type: 'freeformfinset',
      thickness: 0.003,
      points: [
        [0, 0],
        [0.02, 0.03],
        [0.05, 0],
      ],
    }),
    TUBE,
    'finCount',
    KERNEL_DEFAULTS.freeformfinset.finCount,
    'rocket',
    4,
  ],
  [
    'tubefinset.length',
    n({ type: 'tubefinset', outerRadius: 0.009 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.tubefinset.length,
    'component',
    0.15,
  ],
  [
    'tubefinset.finCount',
    n({ type: 'tubefinset', length: 0.08 }),
    TUBE,
    'finCount',
    KERNEL_DEFAULTS.tubefinset.finCount,
    'rocket',
    4,
  ],
  [
    'innertube.length',
    n({ type: 'innertube', outerRadius: 0.0092, thickness: 0.0005 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.innertube.length,
    'component',
    0.09,
  ],
  [
    'innertube.outerRadius',
    n({ type: 'innertube', length: 0.07, thickness: 0.0005 }),
    TUBE,
    'outerRadius',
    KERNEL_DEFAULTS.innertube.outerRadius,
    'component',
    0.012,
  ],
  [
    'tubecoupler.length',
    n({ type: 'tubecoupler', outerRadius: 0.0125, thickness: 0.0005 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.tubecoupler.length,
    'component',
    0.09,
  ],
  [
    'tubecoupler.thickness',
    n({ type: 'tubecoupler', length: 0.05, outerRadius: 0.0125 }),
    TUBE,
    'thickness',
    KERNEL_DEFAULTS.tubecoupler.thickness,
    'component',
    0.002,
  ],
  [
    'engineblock.length',
    n({ type: 'engineblock', outerRadius: 0.0092 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.engineblock.length,
    'component',
    0.009,
  ],
  [
    'launchlug.outerRadius',
    n({ type: 'launchlug', length: 0.05 }),
    TUBE,
    'outerRadius',
    KERNEL_DEFAULTS.launchlug.outerRadius,
    'component',
    0.004,
  ],
  [
    'launchlug.thickness',
    n({ type: 'launchlug', length: 0.05, outerRadius: 0.0022 }),
    TUBE,
    'thickness',
    KERNEL_DEFAULTS.launchlug.thickness,
    'component',
    0.001,
  ],
  ['fairing.length', n({ type: 'fairing' }), TUBE, 'length', KERNEL_DEFAULTS.fairing.length, 'component', 0.12],
  ['fairing.mass', n({ type: 'fairing' }), TUBE, 'mass', KERNEL_DEFAULTS.fairing.mass, 'component', 0.05],
  [
    'parachute.length',
    n({ type: 'parachute', diameter: 0.3 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.parachute.length,
    'component',
    0.05,
  ],
  [
    'parachute.diameter',
    n({ type: 'parachute', length: 0.025 }),
    TUBE,
    'diameter',
    KERNEL_DEFAULTS.parachute.diameter,
    'component',
    0.5,
  ],
  [
    'parachute.lineLength',
    n({ type: 'parachute', length: 0.025 }),
    TUBE,
    'lineLength',
    KERNEL_DEFAULTS.parachute.lineLength,
    'component',
    0.6,
  ],
  [
    'streamer.length',
    n({ type: 'streamer', stripWidth: 0.05 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.streamer.length,
    'component',
    0.05,
  ],
  [
    'streamer.stripWidth',
    n({ type: 'streamer', stripLength: 0.5 }),
    TUBE,
    'stripWidth',
    KERNEL_DEFAULTS.streamer.stripWidth,
    'component',
    0.1,
  ],
  ['shockcord.length', n({ type: 'shockcord' }), TUBE, 'length', KERNEL_DEFAULTS.shockcord.length, 'component', 0.05],
  [
    'shockcord.cordLength',
    n({ type: 'shockcord' }),
    TUBE,
    'cordLength',
    KERNEL_DEFAULTS.shockcord.cordLength,
    'component',
    0.6,
  ],
  [
    'masscomponent.length',
    n({ type: 'masscomponent', mass: 0.01 }),
    TUBE,
    'length',
    KERNEL_DEFAULTS.masscomponent.length,
    'component',
    0.04,
  ],
  [
    'masscomponent.mass',
    n({ type: 'masscomponent', length: 0.02 }),
    TUBE,
    'mass',
    KERNEL_DEFAULTS.masscomponent.mass,
    'component',
    0.05,
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

describe('every KERNEL_DEFAULTS entry has a behavioral case above', () => {
  // The table is only as trustworthy as its coverage: a value added to
  // KERNEL_DEFAULTS without a case here is exactly the hand-asserted number the
  // file header says this test exists to prevent.
  it('covers each type.field', () => {
    const labels = new Set(CASES.map(([label]) => label));
    const missing: string[] = [];
    for (const [type, row] of Object.entries(KERNEL_DEFAULTS)) {
      for (const field of Object.keys(row)) {
        if (!labels.has(`${type}.${field}`)) missing.push(`${type}.${field}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('kernelLength reads the same length the table declares', () => {
    for (const [type, row] of Object.entries(KERNEL_DEFAULTS)) {
      expect(kernelLength(type as ComponentType)).toBe((row as { length?: number }).length);
    }
    // No factory default: RocketComponent.length's initial 0 is the kernel's answer.
    expect(kernelLength('railbutton')).toBeUndefined();
    expect(kernelLength('stage')).toBeUndefined();
  });
});
