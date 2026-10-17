// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { findNode } from '../../src/services/design/treeEdit';
import { DEFAULT_PRESETS } from '../../src/services/design/defaultRocket';
import { KERNEL_MATERIALS } from '../../src/tree/kernelDefaults';

/**
 * What the default rocket is made of, and whether those parts still exist.
 *
 * It is built out of catalog Estes parts, by part number, each carrying the
 * same preset link the component picker writes. This file checks that each link
 * still matches the catalog.
 *
 * Both catalogs are generated from upstream (`sync-components.mjs`,
 * `sync-materials.mjs`). A sync that renames a part, re-weighs a material or
 * drops a part number would otherwise leave the default rocket flying at
 * dimensions and densities no catalog row has, with a panel still naming the
 * part. So every row the design claims is looked up on disk and compared field
 * by field.
 */
type MaterialRow = { name: string; type: string; density: number; group: string };
type PartRow = {
  type: string;
  mfr: string;
  partNo: string;
  digest?: string;
  desc?: string;
  material?: string;
  materialDensity?: number;
  outerDiameter?: number;
  innerDiameter?: number;
  length?: number;
  diameter?: number;
  cd?: number | null;
  lineCount?: number;
  lineLength?: number;
  lineMaterial?: string;
  lineMaterialDensity?: number;
};

// From disk rather than fetched: this is about what ships in the catalogs, and
// the test environment has no server to serve them from.
const read = <T>(name: string): T => JSON.parse(readFileSync(resolve(process.cwd(), 'public/data', name), 'utf8')) as T;
const MATERIALS = read<MaterialRow[]>('materials.generated.json');
const PARTS = read<{ components: PartRow[] }>('components.generated.json').components;

const bulk = (name: string) => MATERIALS.find((m) => m.type === 'bulk' && m.name === name);
const row = (partNo: string) => PARTS.find((p) => p.mfr === 'Estes' && p.partNo === partNo);
const part = (id: string) => findNode(useWorkspaceStore.getState().tree, id) as unknown as Record<string, unknown>;

describe('the default rocket is built from catalog parts', () => {
  it.each(Object.entries(DEFAULT_PRESETS))('%s names a part the catalog still has', (_slot, preset) => {
    const found = row(preset.partNo);
    expect(found, `${preset.partNo} is no longer an Estes row in the component catalog`).toBeTruthy();
    expect(found!.type).toBe(preset.type);
    // Every dimension the design copied out of the row, still the row's.
    for (const key of [
      'outerDiameter',
      'innerDiameter',
      'length',
      'diameter',
      'materialDensity',
      'material',
      'desc',
      'cd',
      'lineCount',
      'lineLength',
      'lineMaterial',
      'lineMaterialDensity',
    ] as const) {
      const claimed = (preset as Record<string, unknown>)[key];
      if (claimed === undefined) continue;
      expect(found![key], `${preset.partNo}.${key}`).toBe(claimed);
    }
  });

  it.each([
    ['nose', 'nosecone', DEFAULT_PRESETS.nose.partNo],
    ['body', 'bodytube', DEFAULT_PRESETS.body.partNo],
    ['mount', 'bodytube', DEFAULT_PRESETS.mount.partNo],
    ['ring-fore', 'centeringring', DEFAULT_PRESETS.ring.partNo],
    ['ring-aft', 'centeringring', DEFAULT_PRESETS.ring.partNo],
    ['chute', 'parachute', DEFAULT_PRESETS.chute.partNo],
  ])('%s carries the preset link for %s', (id, type, partNo) => {
    // The link is what makes the panel say which part this is. `breaksPreset`
    // drops it when a dimension the kernel ties to the preset moves, so a link
    // that survives is also proof the design states the row's own dimensions.
    expect(part(id)['preset']).toMatchObject({ type, manufacturer: 'Estes', partNo });
  });

  it('weighs the airframe as Estes paper, not as generic cardboard', () => {
    // 894.4 against the kernel's stock 680 adds about a third to the mass of the
    // heaviest structural part: it moves the mass, the CG and the margin.
    const body = part('body');
    expect(body['density']).toBe(DEFAULT_PRESETS.body.materialDensity);
    expect(body['materialName']).toBe(DEFAULT_PRESETS.body.material);
    expect(body['density']).not.toBe(KERNEL_MATERIALS.bulk.density);
  });

  it('cuts the fins from the material catalog’s own balsa', () => {
    // The one structural part with no preset to name, because the catalog has no
    // fin rows at all. Its material therefore has to hold against the material
    // catalog instead, the same way every other named material in the app does.
    const balsa = bulk('Balsa');
    expect(balsa, 'Balsa is no longer a bulk material in the catalog').toBeTruthy();
    const fins = part('fins');
    expect(fins['materialName']).toBe('Balsa');
    expect(fins['density']).toBe(balsa!.density);
    // The `.ork` group too, so a saved design files the material under the
    // category the desktop would.
    expect(fins['materialGroup']).toBe(balsa!.group);
  });

  it('has the four parts no preset database carries', () => {
    // A kit of this class has all four: the block the motor pushes against, the
    // cord the nose comes back on, the wadding that keeps the ejection gas off the
    // canopy, and the lug that guides it off a rod.
    const parts: [string, string][] = [
      ['block', 'engineblock'],
      ['cord', 'shockcord'],
      ['wadding', 'masscomponent'],
      ['lug', 'launchlug'],
    ];
    for (const [id, type] of parts) {
      expect(part(id), id).toBeTruthy();
      expect(part(id)['type'], id).toBe(type);
    }
  });

  it('plugs the nose cone into the tube it is sold for', () => {
    // The shoulder is the fit, and the row states none, so it is stated here:
    // the tube's bore, not its outside.
    expect(part('nose')['shoulderRadius']).toBe(DEFAULT_PRESETS.body.innerDiameter / 2);
    expect(part('nose')['shoulderLength']).toBeGreaterThan(0);
  });

  it('gives the parachute the canopy and lines its catalog row states', () => {
    // As a pick of the row gives them (`Parachute.loadFromPreset`): the canopy
    // film, the lines and their thread, and an automatic Cd for a row with none.
    const found = row(DEFAULT_PRESETS.chute.partNo)!;
    const chute = part('chute');
    expect(chute['surfaceMaterialName']).toBe(found.material);
    expect(chute['surfaceDensity']).toBe(found.materialDensity);
    expect(chute['lineMaterialName']).toBe(found.lineMaterial);
    expect(chute['lineDensity']).toBe(found.lineMaterialDensity);
    expect(chute['lineCount']).toBe(found.lineCount);
    expect(chute['lineLength']).toBe(found.lineLength);
    expect(chute['diameter']).toBe(found.diameter);
    expect(chute['cdAuto']).toBe(found.cd == null);
    expect(found.material).not.toBe(KERNEL_MATERIALS.surface.name);
  });

  it.each(Object.entries(DEFAULT_PRESETS).filter(([, preset]) => 'digest' in preset))(
    '%s carries the catalog’s own digest for its part',
    (_slot, preset) => {
      // The digest is what makes the `.ork` link valid: without it the desktop
      // rejects the element and the component opens unlinked. It is OpenRocket's
      // own checksum, put in the catalog by `npm run sync:preset-digests`, so a
      // catalog refreshed without that step fails here rather than quietly
      // shipping a design whose parts no longer reach the file.
      const found = row(preset.partNo);
      expect(found!.digest, `${preset.partNo} has no digest in the catalog`).toBeTruthy();
      expect(found!.digest).toBe((preset as { digest?: string }).digest);
    },
  );

  it('keeps most of the catalog digested', () => {
    // A floor, not a target: a classpath that half-loads, or a sync run against
    // one database instead of both, shows up as a cliff here. The rows without
    // one are parts OpenRocket's own databases do not contain at all.
    const digested = PARTS.filter((p) => p.digest).length;
    expect(digested).toBeGreaterThan(PARTS.length * 0.7);
  });
});
