// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { findNode } from '../../src/services/treeEdit';
import { KERNEL_MATERIALS } from '../../src/tree/kernelDefaults';

/**
 * What the default rocket is made of.
 *
 * It is the first design anybody opens and the one every screenshot is of, so
 * "a shape with a density" is not good enough: an injection-molded polystyrene
 * nose cone and basswood fins are what a 24 mm-class sport model actually is.
 * Left unnamed both weighed as cardboard at 680 kg/m3 - 1.6x too light for the
 * nose and a third too heavy for the fins, mass at the two ENDS of the airframe,
 * which is where an error moves the CG and the stability margin furthest.
 *
 * The densities are the CATALOG's, not numbers typed here: `sync-materials.mjs`
 * regenerates that file from upstream, and a rename or a re-weigh there would
 * otherwise leave the default rocket quietly flying at a density no material in
 * the list has. That is what this checks.
 */
type CatalogRow = { name: string; type: string; density: number; group: string };
// From disk rather than fetched: this is about what SHIPS in the catalog, and
// the test environment has no server to serve it from.
const CATALOG: CatalogRow[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/materials.generated.json'), 'utf8'),
) as CatalogRow[];

const bulk = (name: string) => CATALOG.find((m) => m.type === 'bulk' && m.name === name);
const part = (id: string) => findNode(useWorkspaceStore.getState().tree, id) as unknown as Record<string, unknown>;

describe('the default rocket names its materials', () => {
  it.each([
    ['nose', 'Polystyrene'],
    ['fins', 'Basswood'],
  ])('builds %s out of %s, at the catalog density', (id, name) => {
    const row = bulk(name);
    expect(row, `${name} is no longer a bulk material in the catalog`).toBeTruthy();
    const node = part(id);
    expect(node['materialName']).toBe(name);
    expect(node['density']).toBe(row!.density);
    // The `.ork` group too, so a saved design files the material under the same
    // category the desktop would. Woods and Plastics spell it the same way in
    // the catalog and in `MaterialGroup.getDatabaseString()`; Paper does not,
    // which is why this is asserted rather than assumed.
    expect(node['materialGroup']).toBe(row!.group);
  });

  it('leaves the airframe, the motor tube and the rings as the stock cardboard', () => {
    // Right answer already for a cardboard body, a cardboard motor tube and
    // fiber centering rings, and it is what the kernel weighs them as, so
    // naming something else here would be a change of rocket, not of label.
    for (const id of ['body', 'mount', 'ring-fore', 'ring-aft']) {
      expect(part(id)['materialName'], id).toBe(KERNEL_MATERIALS.bulk.name);
      expect(part(id)['density'], id).toBe(KERNEL_MATERIALS.bulk.density);
    }
  });

  it('gives the parachute its canopy and its lines', () => {
    const chute = part('chute');
    expect(chute['surfaceMaterialName']).toBe(KERNEL_MATERIALS.surface.name);
    expect(chute['lineMaterialName']).toBe(KERNEL_MATERIALS.line.name);
  });
});
