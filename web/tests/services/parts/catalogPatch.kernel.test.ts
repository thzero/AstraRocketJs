import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogPatch, defaultNode } from '../../../src/services/design/treeEdit';
import { isComponentRow, type Component, type ParachuteComponent } from '../../../src/services/parts/componentDb';
import { KERNEL_MATERIALS } from '../../../src/tree/kernelDefaults';
import type { ComponentNode, ComponentType } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { loadEngine } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Every kind of catalog row, applied to a part and built by the real engine.
 *
 * `catalogPatch` writes node keys the bridge reads by name, so a key spelled
 * wrong (or one the bridge does not know) is simply ignored: the part keeps its
 * default size and the picker looks like it did nothing. Building each row and
 * reading back the length the kernel gives the part catches that, and a
 * positive mass says the material reached it too.
 */

const catalog = (
  JSON.parse(readFileSync(join(__dirname, '../../../public/data/components.generated.json'), 'utf8')) as {
    components: unknown[];
  }
).components.filter(isComponentRow) as Component[];

/** A few rows of a type, spread across the catalog rather than the first maker's. */
const sample = (type: string): Component[] => {
  const rows = catalog.filter((p) => p.type === type);
  return [0, 0.5, 0.999].map((at) => rows[Math.floor(at * (rows.length - 1))]!);
};

const node = (type: ComponentType, id: string, extra: Partial<ComponentNode> = {}, children: ComponentNode[] = []) =>
  ({ ...defaultNode(type), id, ...extra, children }) as ComponentNode;

/** The part inside something that may hold it, inside a stage. */
function design(probe: ComponentNode): unknown {
  const body = { outerRadius: 0.1, length: 1 } as Partial<ComponentNode>;
  const holders: Record<string, (p: ComponentNode) => ComponentNode[]> = {
    transition: (p) => [node('bodytube', 'tube', body), p],
    nosecone: (p) => [p],
    bodytube: (p) => [p],
    engineblock: (p) => [node('bodytube', 'tube', body, [node('innertube', 'mmt', { outerRadius: 0.05 }, [p])])],
  };
  const chain = (holders[probe.type] ?? ((p) => [node('bodytube', 'tube', body, [p])]))(probe);
  return { components: [node('stage' as ComponentType, 'st', {}, chain)] };
}

/** The length a row states, as the kernel should report it. */
const statedLength = (p: Component): number | null =>
  p.type === 'parachute' || p.type === 'streamer' || p.type === 'railbutton' ? null : p.length;

describe('catalogPatch through the kernel', () => {
  for (const type of ['transition', 'engineblock', 'launchlug', 'streamer', 'nosecone', 'bodytube', 'centeringring'])
    it(`builds ${type} rows at their stated size`, async () => {
      const engine = await loadEngine();
      for (const row of sample(type)) {
        const probe = { ...node(row.type as ComponentType, 'probe'), ...catalogPatch(row) } as ComponentNode;
        engine.reset();
        const handle = engine.buildRocket(JSON.stringify(design(probe)));
        const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
        expect(info.error, `${row.mfr} ${row.partNo}`).toBeUndefined();
        expect(info.mass, `${row.mfr} ${row.partNo}`).toBeGreaterThan(0);
        const length = statedLength(row);
        if (length != null) expect(info.length, `${row.mfr} ${row.partNo}`).toBeCloseTo(length, 6);
        // A streamer has no length of its own: its mass is the strip's area in its surface material.
        if (row.type === 'streamer')
          expect(info.mass, `${row.mfr} ${row.partNo}`).toBeCloseTo(
            row.stripLength * row.stripWidth * row.materialDensity,
            6,
          );
      }
    });
});

/**
 * A catalog part that states a mass weighs that mass when it flies, as on the
 * desktop: `ComponentPresetFactory` turns the mass of a tube, ring, bulkhead,
 * nose cone or transition into its material's density, and
 * `Parachute.loadPreset` takes a parachute's as its mass override. Every such
 * row is applied through catalogPatch and built in the kernel, so a node that
 * reaches the kernel with a different shape, wall or volume than the desktop
 * gave the preset shows up as a different mass.
 */
describe('a stated catalog mass', () => {
  it('is the mass the part flies at', async () => {
    const engine = await loadEngine();
    const massed = catalog.filter((p) => typeof p.mass === 'number');
    expect(massed.length).toBeGreaterThan(100);
    const wrong: string[] = [];
    for (const row of massed) {
      const probe = { ...node(row.type as ComponentType, 'probe'), ...catalogPatch(row) } as ComponentNode;
      engine.reset();
      const handle = engine.buildRocket(JSON.stringify(design(probe)));
      const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
      if (info.error || !(Math.abs(info.mass / row.mass! - 1) < 0.005))
        wrong.push(`${row.type} ${row.mfr} ${row.partNo}: catalog ${row.mass} kg, flies ${info.mass ?? info.error}`);
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * A catalog parachute with no stated mass weighs what the desktop gives it:
 * `Parachute.loadFromPreset` applies the part's line count and length and its
 * canopy and line materials, so the canopy's area in its material plus the
 * lines in theirs is the mass desktop flies. A row that loses any of those on
 * the way to the kernel weighs a new parachute's lines or nylon instead.
 */
describe('a catalog parachute', () => {
  it('flies at the mass of its own canopy and lines', async () => {
    const engine = await loadEngine();
    const chutes = catalog.filter((p): p is ParachuteComponent => p.type === 'parachute' && p.mass == null);
    expect(chutes.length).toBeGreaterThan(100);
    // Every field the desktop applies is carried, or the rows test nothing.
    expect(chutes.every((p) => p.lineCount != null && p.lineLength != null)).toBe(true);
    const wrong: string[] = [];
    for (const row of chutes) {
      const probe = { ...node('parachute', 'probe'), ...catalogPatch(row) } as ComponentNode;
      engine.reset();
      const handle = engine.buildRocket(JSON.stringify(design(probe)));
      const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
      // Parachute.getComponentMass: the canopy's area in its material, plus the lines in theirs.
      const canopy = ((Math.PI * row.diameter ** 2) / 4) * (row.materialDensity ?? KERNEL_MATERIALS.surface.density);
      const lines = row.lineCount! * row.lineLength! * (row.lineMaterialDensity ?? KERNEL_MATERIALS.line.density);
      const expected = canopy + lines;
      if (info.error || !(Math.abs(info.mass / expected - 1) < 0.005))
        wrong.push(`${row.mfr} ${row.partNo}: expected ${expected} kg, flies ${info.mass ?? info.error}`);
    }
    expect(wrong).toEqual([]);
  });
});

const JAVA_ROOT = join(__dirname, '../../../../engine-java/src/java/info/openrocket/core/rocketcomponent/');
/** Java source with runs of whitespace collapsed, so the guards survive reformatting. */
const javaSource = (file: string): string => readFileSync(join(JAVA_ROOT, file), 'utf8').replace(/\s+/g, ' ');

/**
 * A recovery part picked from the catalog, against `Streamer.loadFromPreset`,
 * `RecoveryDevice.loadFromPreset` and `Parachute.loadFromPreset`.
 */
describe('a picked recovery part', () => {
  it('is generated from the rules the patch was written against', () => {
    expect(javaSource('Streamer.java')).toContain('this.length = this.stripWidth;');
    expect(javaSource('RecoveryDevice.java')).toContain('} else { this.material = defaultMaterial; }');
    expect(javaSource('Parachute.java')).toContain(
      'if (size > 0) { this.name = preset.get(ComponentPreset.DESCRIPTION); } else { this.name = getComponentName(); }',
    );
  });

  it('packs a streamer to its strip width, whatever the part before it had', async () => {
    const engine = await loadEngine();
    for (const row of sample('streamer')) {
      if (row.type !== 'streamer') throw new Error('sample returned another type');
      const probe = { ...node('streamer', 'probe', { length: 0.37 }), ...catalogPatch(row) } as ComponentNode;
      engine.reset();
      const info = JSON.parse(engine.getComponentInfo(engine.buildRocket(JSON.stringify(design(probe))), 'probe'));
      expect(info.length, `${row.mfr} ${row.partNo}`).toBeCloseTo(row.stripWidth, 9);
    }
  });

  it('gives a streamer that states no material the kernel default, not the previous one', async () => {
    const engine = await loadEngine();
    const strip = { stripLength: 1, stripWidth: 0.1 };
    const bare = { ...node('streamer', 'probe'), ...strip } as Record<string, unknown>;
    delete bare['surfaceMaterialName'];
    delete bare['surfaceDensity'];
    engine.reset();
    const fresh = JSON.parse(
      engine.getComponentInfo(engine.buildRocket(JSON.stringify(design(bare as never))), 'probe'),
    );
    const row = { type: 'streamer', mfr: 'X', partNo: 'Y', desc: '', materialDensity: 0, ...strip } as Component;
    const probe = {
      ...node('streamer', 'probe', { surfaceMaterialName: 'Heavy', surfaceDensity: 0.5 }),
      ...catalogPatch(row),
    } as ComponentNode;
    engine.reset();
    const picked = JSON.parse(engine.getComponentInfo(engine.buildRocket(JSON.stringify(design(probe))), 'probe'));
    expect(picked.mass).toBeCloseTo(fresh.mass, 9);
  });

  it('names a parachute after the description it states', () => {
    const row = catalog.find((p): p is ParachuteComponent => p.type === 'parachute' && p.desc.length > 0)!;
    expect(catalogPatch(row, node('parachute', 'probe', { name: 'Main' }))['name']).toBe(row.desc);
    // An empty description falls back to the type's own name.
    expect(catalogPatch({ ...row, desc: '' }, node('parachute', 'probe', { name: 'Main' }))['name']).toBeUndefined();
  });
});
