import { describe, it, expect, beforeAll, vi } from 'vitest';
import { __setEngineForTests, OpenRocketDesign, type RocketTree } from '../../src/engine/openRocketEngine';
import { FIELDS, type Field } from '../../src/services/design/componentFields';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

beforeAll(async () => {
  __setEngineForTests(await import('../../src/engine/vendor/openrocket-engine.mjs'));
});

/**
 * Every field the Design tab shows reaches the kernel.
 *
 * Driven by FIELDS: each field is set to two values and the rocket is built
 * twice. If nothing the kernel reports moves (mass, CG, CP, inertia, drag),
 * the bridge most likely never read it, and the field is an inert control.
 *
 * A few fields rightly change nothing in a static build. They are listed in
 * NO_STATIC_EFFECT with the reason, and the list is checked both ways: a new
 * inert field fails, and so does an entry that has started to matter.
 */

const NO_STATIC_EFFECT: Record<string, string> = {
  // Only matter with a motor loaded or in flight.
  'bodytube.motorMount': 'mount flag; no motor in this build',
  'bodytube.motorOverhang': 'moves the motor; no motor in this build',
  'innertube.motorMount': 'mount flag; no motor in this build',
  'innertube.motorOverhang': 'moves the motor; no motor in this build',
  'parachute.cd': 'descent drag only',
  'parachute.deployEvent': 'flight event',
  'parachute.deployAltitude': 'flight event',
  'parachute.deployDelay': 'flight event',
  'streamer.cd': 'descent drag only',
  'streamer.deployEvent': 'flight event',
  'streamer.deployAltitude': 'flight event',
  'streamer.deployDelay': 'flight event',
  'parallelstage.separationEvent': 'flight event',
  'parallelstage.separationDelay': 'flight event',
  'parallelstage.separationAltitude': 'flight event',
  'masscomponent.massComponentType': 'a label; desktop uses it only to name and picture the part',
  // Turning an axially symmetric arrangement changes no mass, CG or inertia.
  'tubefinset.rotation': 'symmetric fin pattern',
  'innertube.clusterRotation': 'symmetric cluster',
  'innertube.radialDirection': 'roll inertia depends on distance, not direction',
  // OpenRocket's RingComponent.getComponentCG puts a ring part on the axis.
  'tubecoupler.radialDirection': 'ring part flies on the axis',
  'centeringring.radialDirection': 'ring part flies on the axis',
  'bulkhead.radialDirection': 'ring part flies on the axis',
  'engineblock.radialDirection': 'ring part flies on the axis',
};

const TOP = new Set(['nosecone', 'transition', 'bodytube']);
const BASE: Record<string, Record<string, unknown>> = {
  nosecone: { length: 0.1, aftRadius: 0.02, thickness: 0.001, shape: 'ogive' },
  transition: { length: 0.05, foreRadius: 0.02, aftRadius: 0.015, thickness: 0.001, shape: 'conical' },
  bodytube: { length: 0.1, outerRadius: 0.02, thickness: 0.001 },
  trapezoidfinset: { finCount: 3, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05, thickness: 0.003 },
  ellipticalfinset: { finCount: 3, rootChord: 0.06, height: 0.05, thickness: 0.003 },
  freeformfinset: {
    finCount: 3,
    thickness: 0.003,
    points: [
      [0, 0],
      [0.03, 0.04],
      [0.06, 0],
    ],
  },
  tubefinset: { finCount: 4, length: 0.05, outerRadius: 0.006, thickness: 0.0005 },
  innertube: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
  tubecoupler: { length: 0.05, outerRadius: 0.0185, thickness: 0.001 },
  centeringring: { length: 0.003, outerRadius: 0.019, innerRadius: 0.01 },
  bulkhead: { length: 0.003, outerRadius: 0.019 },
  engineblock: { length: 0.005, outerRadius: 0.0092, thickness: 0.002 },
  launchlug: { length: 0.03, outerRadius: 0.012, thickness: 0.0005 },
  railbutton: { outerDiameter: 0.0097 },
  parachute: { diameter: 0.4, cd: 0.8, length: 0.05, radius: 0.01 },
  streamer: { stripLength: 0.5, stripWidth: 0.05, length: 0.05, radius: 0.01 },
  masscomponent: { mass: 0.05, length: 0.02, radius: 0.005 },
  shockcord: { cordLength: 1, length: 0.03, radius: 0.008 },
  podset: { instanceCount: 2, radiusOffset: 0.03 },
  parallelstage: { instanceCount: 2, radiusOffset: 0.03 },
};
const POD_KIDS = [{ id: 'podtube', type: 'bodytube', length: 0.1, outerRadius: 0.01, thickness: 0.001 }];

/** What a field needs beside it before it can have any effect. */
const shoulder = (side: string, r: number) => ({
  [`${side}Length`]: 0.02,
  [`${side}Radius`]: r,
  [`${side}Thickness`]: 0.001,
});
const TAB = { tabLength: 0.02, tabHeight: 0.005, tabOffset: 0.001, tabOffsetMethod: 'top' };
const PARTNER: Record<string, Record<string, unknown>> = {
  shoulderRadius: shoulder('shoulder', 0.018),
  shoulderThickness: shoulder('shoulder', 0.018),
  shoulderCapped: shoulder('shoulder', 0.018),
  foreShoulderRadius: shoulder('foreShoulder', 0.018),
  foreShoulderThickness: shoulder('foreShoulder', 0.018),
  foreShoulderCapped: shoulder('foreShoulder', 0.018),
  aftShoulderRadius: shoulder('aftShoulder', 0.013),
  aftShoulderThickness: shoulder('aftShoulder', 0.013),
  aftShoulderCapped: shoulder('aftShoulder', 0.013),
  tabLength: TAB,
  tabHeight: TAB,
  tabOffset: TAB,
  tabOffsetMethod: TAB,
  shapeParameter: { shape: 'power' },
  clipped: { shape: 'power' },
  clusterScale: { cluster: '3-ring' },
  clusterRotation: { cluster: '3-ring' },
  instanceSeparation: { instanceCount: 3 },
  radialDirection: { radialPosition: 0.005 },
};

const tree = (type: string, key: string, value: unknown): RocketTree => {
  const part: Record<string, unknown> = { id: 'p', type, ...BASE[type], ...PARTNER[key], [key]: value };
  // Both test radii must clear the ring's bore.
  if (type === 'centeringring' && key === 'outerRadius') part['innerRadius'] = 0.002;
  if (type === 'podset' || type === 'parallelstage') part['children'] = POD_KIDS;
  const nose = { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.02, thickness: 0.001, shape: 'ogive' };
  const tube = { id: 'tube', type: 'bodytube', length: 0.3, outerRadius: 0.02, thickness: 0.001 };
  const kids =
    type === 'nosecone' ? [part, tube] : TOP.has(type) ? [nose, part, tube] : [nose, { ...tube, children: [part] }];
  return { components: [{ id: 'stage1', type: 'stage', children: kids }] } as unknown as RocketTree;
};

const twoValues = (f: Field): [unknown, unknown] | undefined => {
  switch (f.kind) {
    case 'length':
      return [0.004, 0.009];
    case 'distance':
      return [50, 300];
    case 'mass':
      return [0.01, 0.08];
    case 'number':
      return [0.3, 0.9];
    case 'angle':
      return [0.1, 0.6];
    case 'count':
      return [2, 4];
    case 'bool':
      return [false, true];
    case 'select':
      return f.options.length > 1 ? [f.options[0], f.options[f.options.length - 1]] : undefined;
    default:
      // bore and derived rows are views onto other keys; text has no physics.
      return undefined;
  }
};

const staticResult = (t: RocketTree): string => JSON.stringify(OpenRocketDesign.buildTree(t).staticInfo());

describe('every Design tab field reaches the kernel', () => {
  it('changes the static result, or is listed with its reason', () => {
    const inert: string[] = [];
    for (const [type, fields] of Object.entries(FIELDS)) {
      if (!BASE[type]) continue;
      for (const f of fields) {
        const values = twoValues(f);
        if (!values) continue;
        const [a, b] = values.map((v) => staticResult(tree(type, f.key, v)));
        if (a === b) inert.push(`${type}.${f.key}`);
      }
    }
    expect(inert.sort()).toEqual(Object.keys(NO_STATIC_EFFECT).sort());
  });

  it('covers every component type the Design tab offers', () => {
    expect(Object.keys(FIELDS).filter((t) => t !== 'stage' && !BASE[t])).toEqual([]);
  });
});
