// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { serveData } from '../../testing/serveData';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The `.ork` and `.rkt` files the app saves, through the store's own save
 * paths, for the default design and every bundled example opened and saved
 * again.
 *
 * Each file is checked here for what this side can see. With ORK_SAMPLES_DIR
 * set, the files are also written there, so `npm run check:ork` can open them
 * in the pinned desktop OpenRocket: `npm run audit` in web does that, because only
 * the desktop can say whether it accepts what the writers emit. The desktop's
 * GeneralRocketLoader reads a RockSim file as well as its own.
 *
 * Beside each file goes `<file>.kernel.json`: every part of the saved design as
 * the app's kernel holds it (`getComponentFields`), in tree order. The audit's
 * `fields` step opens the file in desktop and requires each part to come back
 * with the same values (`scripts/check-desktop-fields.mjs`), so a writer that
 * emits a number the app does not fly fails there.
 *
 * The bundled examples use few of the fields a part can carry, so one more design
 * holds every part type, with the settings the writers have to spell out rather
 * than leave to a default: automatic sizes, repeated parts, a fin tab, shoulders,
 * a pod and a booster.
 */

const saved = vi.hoisted(() => ({ archives: [] as Uint8Array[], rkt: [] as string[] }));
vi.mock('../../../src/services/files/saveOrk', async (orig) => {
  const real = await orig<typeof import('../../../src/services/files/saveOrk')>();
  return {
    ...real,
    downloadOrk: (input: Parameters<typeof real.orkArchive>[0]) => {
      saved.archives.push(real.orkArchive(input));
    },
    downloadRkt: async (...[name, tree, componentInfo]: Parameters<typeof real.downloadRkt>) => {
      const { exportRkt } = await import('../../../src/services/files/rktExport');
      const { xml, skipped } = exportRkt(name, tree, componentInfo);
      saved.rkt.push(xml);
      return skipped;
    },
  };
});

import { __setEngineForTests, type ComponentNode, type RocketTree } from '../../../src/engine/openRocketEngine';
import { buildRocketTree } from '../../../src/engine/api';
import { useWorkspaceStore } from '../../../src/state/store';
import { defaultNode, syncDerived } from '../../../src/services/design/treeEdit';
import { clusterCount } from '../../../src/tree/cluster';

const EXAMPLES = join(__dirname, '../../../public/examples');
const OUT = process.env.ORK_SAMPLES_DIR;

const s = () => useWorkspaceStore.getState();

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Every part of a design with its depth, parents before their children, as the desktop iterates a rocket. */
function inOrder(
  nodes: readonly ComponentNode[],
  depth = 0,
  out: { node: ComponentNode; depth: number }[] = [],
): { node: ComponentNode; depth: number }[] {
  for (const node of nodes) {
    out.push({ node, depth });
    inOrder((node.children ?? []) as ComponentNode[], depth + 1, out);
  }
  return out;
}

/**
 * How many parts a RockSim file writes this one as: a cluster's tubes and a pod
 * or booster set's members each become a part of their own (rktExport).
 */
const rktCopies = (n: ComponentNode): number =>
  n.type === 'innertube'
    ? clusterCount(typeof n['cluster'] === 'string' ? n['cluster'] : undefined)
    : n.type === 'podset' || n.type === 'parallelstage'
      ? Number(n['instanceCount'] ?? 1)
      : 1;

/** What the app's kernel holds for each part of the open design, for the desktop to be compared with. */
function writeKernelFields(name: string): void {
  if (!OUT) return;
  const tree = s().tree;
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const parts = inOrder(tree.components).map(({ node: n, depth }) => {
    const fields = JSON.parse(engine.getComponentFields(handle, n.id)) as Record<string, unknown>;
    expect(fields.error, `${name}: ${n.type}`).toBeUndefined();
    return { type: n.type, name: n.name ?? '', depth, rktCopies: rktCopies(n), fields };
  });
  writeFileSync(join(OUT, `${name}.kernel.json`), JSON.stringify(parts));
}

/** A part as the editor creates it, with the given settings on top. */
const part = (type: ComponentNode['type'], patch: Partial<ComponentNode> = {}): ComponentNode => ({
  ...defaultNode(type),
  ...patch,
});

/** One of every part type, wide enough that an automatic size cannot match a default by chance. */
function everyPart(): RocketTree {
  const body = part('bodytube', { length: 0.5, outerRadius: 0.05, outerRadiusAuto: false, thickness: 0.002 });
  body.children = [
    part('innertube', { cluster: '3-ring', clusterScale: 1.2, clusterRotation: 0.3 }),
    part('innertube', { outerRadius: 0.012, thickness: 0.0005, motorMount: true, motorOverhang: 0.005 }),
    part('centeringring', { instanceCount: 2 }),
    part('bulkhead'),
    part('engineblock'),
    part('tubecoupler'),
    part('launchlug', { instanceCount: 2 }),
    part('railbutton', { instanceCount: 2 }),
    part('parachute'),
    part('streamer'),
    part('shockcord'),
    part('masscomponent', { overrideCGX: 0.01 }),
    part('masscomponent', { mass: 0.05, massComponentType: 'altimeter' }),
    part('podset'),
  ];
  // A part with its mass overridden and its CG left to the kernel, and one in
  // a material of its own.
  body.overrideMass = 0.2;
  body.materialName = 'Fiberglass';
  body.density = 1850;
  const tail = part('bodytube', { length: 0.3, outerRadius: 0.04, outerRadiusAuto: false, thickness: 0.002 });
  tail.children = [
    part('trapezoidfinset', { tabLength: 0.03, tabHeight: 0.01, tabOffset: 0, tabOffsetMethod: 'middle' }),
    part('ellipticalfinset', { rotation: 0.4, crossSection: 'airfoil' }),
    part('freeformfinset', { rotation: 0.8 }),
    part('tubefinset'),
    part('parallelstage'),
  ];
  const transition = part('transition', { foreShoulderLength: 0.03, aftShoulderLength: 0.03 });
  const booster = part('bodytube', { length: 0.3, outerRadius: 0.04, outerRadiusAuto: false, thickness: 0.002 });
  return syncDerived({
    name: 'Every part',
    components: [
      {
        ...part('stage'),
        children: [
          part('nosecone', { aftRadiusAuto: true }),
          body,
          transition,
          tail,
          part('nosecone', {
            flipped: true,
            aftRadius: 0.04,
            aftRadiusAuto: false,
            length: 0.06,
            shoulderAuto: false,
            shoulderRadius: 0.045,
            shoulderLength: 0.02,
            shoulderThickness: 0.002,
          }),
        ],
      },
      // A booster whose mass and CG are stated for the whole stage.
      {
        ...part('stage'),
        overrideMass: 0.3,
        overrideCGX: 0.12,
        overrideSubcomponentsMass: true,
        overrideSubcomponentsCG: true,
        children: [booster],
      },
    ],
  } as RocketTree);
}

/** Save the open design the way File > Save does, returning the archive. */
async function save(): Promise<Uint8Array> {
  saved.archives.length = 0;
  await s().saveOrk();
  expect(s().err).toBeNull();
  expect(saved.archives).toHaveLength(1);
  return saved.archives[0]!;
}

/** Save the open design the way File > Export > RockSim does, returning the XML. */
async function saveRkt(): Promise<string> {
  saved.rkt.length = 0;
  // The store's live build, which the app always has by the time a design can
  // be exported: the writer takes a part's own mass and CG from it.
  useWorkspaceStore.setState({ rocket: buildRocketTree(s().tree) });
  await s().saveRkt();
  expect(saved.rkt).toHaveLength(1);
  return saved.rkt[0]!;
}

function checkRkt(name: string, xml: string): void {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  expect(doc.querySelector('parsererror'), name).toBeNull();
  expect(doc.documentElement.tagName, name).toBe('RockSimDocument');
  if (OUT) writeFileSync(join(OUT, name), xml);
}

function check(name: string, archive: Uint8Array): void {
  const xml = strFromU8(unzipSync(archive)['rocket.ork']!);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  expect(doc.querySelector('parsererror'), name).toBeNull();
  // A motor with no name is one the desktop looks up and reports missing.
  for (const d of doc.querySelectorAll('motormount > motor > designation')) {
    expect(d.textContent, name).not.toBe('');
  }
  if (OUT) writeFileSync(join(OUT, name), archive);
}

beforeAll(async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  engine = await import('../../../src/engine/vendor/openrocket-engine.mjs' as string);
  __setEngineForTests(engine);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  serveData();
  if (OUT) mkdirSync(OUT, { recursive: true });
});

describe('.ork files the app saves', () => {
  it('for the default design', async () => {
    s().resetWorkspace();
    expect(s().err).toBeNull();
    check('default-design.ork', await save());
    checkRkt('default-design.rkt', await saveRkt());
    writeKernelFields('default-design.ork');
    writeKernelFields('default-design.rkt');
  });

  it('for a design with every part type', async () => {
    s().resetWorkspace();
    useWorkspaceStore.setState({ tree: everyPart() });
    expect(s().err).toBeNull();
    check('every-part.ork', await save());
    checkRkt('every-part.rkt', await saveRkt());
    writeKernelFields('every-part.ork');
    writeKernelFields('every-part.rkt');
  });

  it.each(readdirSync(EXAMPLES).filter((f) => f.endsWith('.ork')))(
    'for the example %s, opened and saved',
    async (f) => {
      await s().openOrkFile(new Blob([readFileSync(join(EXAMPLES, f))]));
      expect(s().err).toBeNull();
      check(f, await save());
      checkRkt(f.replace(/\.ork$/, '.rkt'), await saveRkt());
      writeKernelFields(f);
      writeKernelFields(f.replace(/\.ork$/, '.rkt'));
    },
  );
});
