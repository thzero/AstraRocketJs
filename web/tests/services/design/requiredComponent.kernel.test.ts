// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { __setEngineForTests, OpenRocketDesign, type RocketTree } from '../../../src/engine/openRocketEngine';
import { C6 } from '../../../src/engine/api';
import { importOrk } from '../../../src/services/files/orkFile';
import { findMounts } from '../../../src/services/design/treeEdit';
import { badDimensions, REQUIRED_COMPONENT_FIELDS } from '../../../src/services/design/requiredComponent';
import { FIELDS } from '../../../src/services/design/componentFields';
import { designBlocker } from '../../../src/services/flight/runnability';
import { walkNodes } from '../../../src/tree/treeWalk';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The run refuses a design for its geometry only where the kernel cannot fly
 * it. Each number the editor edits on each part type is set to 0 in turn, the design is built
 * and flown through the bridge, and the pre-run check has to refuse exactly the
 * ones the kernel fails on: refusing more turns away a design desktop flies,
 * refusing less sends the user an engine error in place of the field to fix.
 */

beforeAll(async () => {
  __setEngineForTests(await loadEngine());
});

/** The kernel's verdict: null when it builds and flies to a finite apogee, else why not. */
function kernelFails(tree: RocketTree): string | null {
  try {
    const d = OpenRocketDesign.buildTree(tree);
    for (const m of findMounts(tree)) d.setMotorById(m.id as string, C6);
    const apogee = d.simulate({ launchRodLength: 1 }).summary.maxAltitude;
    return Number.isFinite(apogee) ? null : `apogee ${String(apogee)}`;
  } catch (e) {
    return String((e as Error).message);
  }
}

const part = (type: string, id: string, extra: Record<string, unknown>) => ({ type, id, ...extra });

/** Every part type the editor makes, each with every number it is sized by. */
const design = (): RocketTree =>
  ({
    name: 'every part',
    components: [
      {
        type: 'stage',
        id: 's',
        name: 'S',
        children: [
          part('nosecone', 'nosecone', { length: 0.1, aftRadius: 0.0125, thickness: 0.002 }),
          {
            ...part('bodytube', 'bodytube', { length: 0.4, outerRadius: 0.0125, thickness: 0.0005 }),
            children: [
              part('innertube', 'innertube', {
                length: 0.07,
                outerRadius: 0.0095,
                thickness: 0.0005,
                motorMount: true,
                position: { method: 'bottom', offset: 0 },
              }),
              part('centeringring', 'centeringring', {
                length: 0.003,
                outerRadius: 0.012,
                innerRadius: 0.0095,
                position: { method: 'bottom', offset: -0.01 },
              }),
              part('bulkhead', 'bulkhead', {
                length: 0.003,
                outerRadius: 0.012,
                position: { method: 'top', offset: 0.05 },
              }),
              part('engineblock', 'engineblock', {
                length: 0.005,
                outerRadius: 0.0095,
                thickness: 0.002,
                position: { method: 'bottom', offset: -0.07 },
              }),
              part('tubecoupler', 'tubecoupler', {
                length: 0.04,
                outerRadius: 0.012,
                thickness: 0.0005,
                position: { method: 'top', offset: 0.1 },
              }),
              part('launchlug', 'launchlug', { length: 0.03, outerRadius: 0.003, thickness: 0.0005 }),
              part('railbutton', 'railbutton', { outerDiameter: 0.009, innerDiameter: 0.006, height: 0.008 }),
              part('trapezoidfinset', 'trapezoidfinset', {
                finCount: 3,
                rootChord: 0.05,
                tipChord: 0.03,
                sweep: 0.02,
                height: 0.03,
                thickness: 0.003,
              }),
              part('ellipticalfinset', 'ellipticalfinset', {
                finCount: 3,
                rootChord: 0.04,
                height: 0.02,
                thickness: 0.002,
                position: { method: 'top', offset: 0.15 },
              }),
              part('freeformfinset', 'freeformfinset', {
                finCount: 3,
                thickness: 0.002,
                points: [
                  [0, 0],
                  [0.02, 0.02],
                  [0.04, 0],
                ],
                position: { method: 'top', offset: 0.22 },
              }),
              part('tubefinset', 'tubefinset', {
                finCount: 6,
                length: 0.05,
                outerRadius: 0.005,
                thickness: 0.0005,
                position: { method: 'top', offset: 0.3 },
              }),
              part('parachute', 'parachute', { diameter: 0.3, cd: 0.8 }),
              part('streamer', 'streamer', { stripLength: 0.5, stripWidth: 0.05, cd: 0.6 }),
              part('shockcord', 'shockcord', { cordLength: 0.5 }),
              part('masscomponent', 'masscomponent', { mass: 0.01, length: 0.02, radius: 0.005 }),
              {
                ...part('podset', 'podset', { instanceCount: 2, radialDistance: 0.03 }),
                children: [part('bodytube', 'pod-tube', { length: 0.1, outerRadius: 0.008, thickness: 0.0005 })],
              },
              {
                ...part('parallelstage', 'parallelstage', { instanceCount: 2, radialDistance: 0.03 }),
                children: [part('bodytube', 'booster-tube', { length: 0.1, outerRadius: 0.008, thickness: 0.0005 })],
              },
            ],
          },
          part('transition', 'transition', { length: 0.05, foreRadius: 0.0125, aftRadius: 0.009, thickness: 0.001 }),
        ],
      },
    ],
  }) as unknown as RocketTree;

const NUMERIC: ReadonlySet<string> = new Set(['angle', 'bore', 'count', 'distance', 'length', 'mass', 'number']);

/** Every number the editor edits on each part, by part id: what a user can type a 0 into. */
const SIZED = [...walkNodes(design().components)].flatMap((n) =>
  (FIELDS[n.type] ?? [])
    .filter((f) => NUMERIC.has(f.kind))
    .map((f) => ({ id: n.id as string, type: n.type, field: f.key, flag: f.auto?.flag })),
);

const withZero = (id: string, fields: string[], flag?: string): RocketTree => {
  const tree = design();
  const node = [...walkNodes(tree.components)].find((n) => n.id === id)!;
  for (const f of fields) node[f] = 0;
  // A typed number turns the field's Auto off, as the panel does.
  if (flag) node[flag] = false;
  return tree;
};

describe('the pre-run geometry check', () => {
  it('lets the whole design fly, as the kernel does', () => {
    expect(kernelFails(design())).toBeNull();
    expect(badDimensions(design())).toEqual([]);
  });

  it('covers every part type the rule names', () => {
    const types = new Set(SIZED.map((s) => s.type));
    for (const type of Object.keys(REQUIRED_COMPONENT_FIELDS)) expect(types).toContain(type);
  });

  it.each(SIZED)('refuses $type $field at 0 exactly when the kernel cannot fly it', ({ id, field, flag }) => {
    const tree = withZero(id, [field], flag);
    const kernel = kernelFails(tree);
    const refused = badDimensions(tree).some((b) => b.id === id && b.field === field);
    expect({ field, refused }).toEqual({ field, refused: kernel !== null });
  });

  it.each(['bodytube', 'pod-tube', 'nosecone', 'transition'])(
    'lets a %s with every dimension at 0 fly, as the kernel does',
    (id) => {
      const node = [...walkNodes(design().components)].find((n) => n.id === id)!;
      const fields = ['length', 'outerRadius', 'aftRadius', 'foreRadius', 'thickness'].filter((f) => f in node);
      const tree = withZero(id, fields);
      expect(kernelFails(tree)).toBeNull();
      expect(badDimensions(tree)).toEqual([]);
    },
  );
});

describe('the bundled pods example', () => {
  const bytes = readFileSync(resolve(process.cwd(), 'public/examples/pods-airframes-and-winglets.ork'));
  const tree = importOrk(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).tree;

  it('carries a body tube with no length, radius or wall', () => {
    const phantom = [...walkNodes(tree.components)].find((n) => n.name === '(phantom body)')!;
    expect([phantom['length'], phantom['outerRadius'], phantom['thickness']]).toEqual([0, 0, 0]);
  });

  it('flies through the bridge, and the run lets it', () => {
    expect(kernelFails(tree)).toBeNull();
    expect(designBlocker(tree)).toBeNull();
  });
});
