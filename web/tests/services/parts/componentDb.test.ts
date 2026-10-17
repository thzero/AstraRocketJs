import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isComponentCatalog,
  isComponentRow,
  projectByType,
  type Component,
} from '../../../src/services/parts/componentDb';

const parts = [
  { type: 'nosecone', mfr: 'Estes', partNo: 'PNC-50K', desc: 'Ogive nose cone' },
  { type: 'nosecone', mfr: 'Apogee', partNo: 'AC-29', desc: 'Conical nose cone' },
  { type: 'bodytube', mfr: 'Estes', partNo: 'BT-50', desc: 'Body tube' },
] as unknown as Component[];

describe('projectByType', () => {
  it('filters a loaded catalog to a single type', () => {
    const cat = { generated: '', count: parts.length, components: parts };
    const tubes = projectByType(cat, 'bodytube');
    expect(tubes.every((c) => c.type === 'bodytube')).toBe(true);
    expect(tubes).toHaveLength(1);
  });
});

const tube = (over: Record<string, unknown> = {}) => ({
  type: 'bodytube',
  mfr: 'Estes',
  partNo: 'BT-50',
  desc: 'Body tube',
  materialDensity: 680,
  outerDiameter: 0.0246,
  innerDiameter: 0.024,
  length: 0.3,
  ...over,
});

describe('isComponentCatalog (the gate handed to fetchCatalog)', () => {
  it('refuses a host that is up but serving the wrong shape', () => {
    // Served with HTTP 200 while the data branch rebuilds. Accepting any object
    // would memoize it, and the picker would throw on every open until reload.
    expect(isComponentCatalog({ error: 'rebuilding' })).toBe(false);
    expect(isComponentCatalog(null)).toBe(false);
    expect(isComponentCatalog([])).toBe(false);
  });
  it('accepts a body carrying a components array', () => {
    expect(isComponentCatalog({ generated: '', count: 0, components: [] })).toBe(true);
  });
});

describe('isComponentRow (per-type guard)', () => {
  it('keeps a well-formed row of each type', () => {
    expect(isComponentRow(tube())).toBe(true);
    expect(isComponentRow(tube({ type: 'tubecoupler', innerDiameter: null }))).toBe(true);
    expect(isComponentRow(tube({ type: 'centeringring' }))).toBe(true);
    expect(
      isComponentRow({
        type: 'nosecone',
        mfr: 'E',
        partNo: 'P',
        desc: 'D',
        materialDensity: 1,
        shape: 'ogive',
        filled: false,
        outerDiameter: 0.02,
        length: 0.1,
      }),
    ).toBe(true);
    expect(
      isComponentRow({
        type: 'bulkhead',
        mfr: 'E',
        partNo: 'P',
        desc: 'D',
        materialDensity: 1,
        outerDiameter: 0.02,
        length: 0.003,
        filled: true,
      }),
    ).toBe(true);
    expect(isComponentRow({ type: 'parachute', mfr: 'E', partNo: 'P', desc: 'D', diameter: 0.3, cd: null })).toBe(true);
  });

  it('drops a row missing outerDiameter (catalogPatch would divide undefined by 2)', () => {
    const { outerDiameter: _drop, ...noOd } = tube();
    expect(isComponentRow(noOd)).toBe(false);
    expect(isComponentRow(tube({ outerDiameter: 'big' }))).toBe(false);
    expect(isComponentRow(tube({ outerDiameter: NaN }))).toBe(false);
  });

  it('drops an unknown type and a row with no description fields', () => {
    expect(isComponentRow(tube({ type: 'finset' }))).toBe(false);
    expect(isComponentRow(tube({ mfr: 3 }))).toBe(false);
    expect(isComponentRow('BT-50')).toBe(false);
  });
});

describe('componentsForType filters rows through the guard', () => {
  it('serves the usable rows and drops the malformed one', async () => {
    vi.resetModules();
    vi.doMock('../../../src/services/app/remoteData', () => ({
      fetchCatalog: async (_name: string, valid?: (v: unknown) => boolean) => {
        const body = {
          generated: '',
          count: 2,
          components: [tube(), tube({ partNo: 'BAD', outerDiameter: undefined })],
        };
        if (valid && !valid(body)) throw new Error('unexpected catalog shape');
        return body;
      },
    }));
    const { componentsForType } = await import('../../../src/services/parts/componentDb');
    const tubes = await componentsForType('bodytube');
    expect(tubes.map((c) => c.partNo)).toEqual(['BT-50']);
    vi.doUnmock('../../../src/services/app/remoteData');
  });
});

describe('isComponentRow with the stated mass and the nose cone wall and shoulder', () => {
  const nose = {
    type: 'nosecone',
    mfr: 'Estes',
    partNo: 'PNC-50K',
    desc: 'Nose cone',
    materialDensity: 1050,
    shape: 'ogive',
    filled: false,
    outerDiameter: 0.0247,
    length: 0.0667,
  };

  it('accepts a nose cone row with no wall or shoulder fields', () => {
    expect(isComponentRow(nose)).toBe(true);
  });

  it('accepts the wall, the shoulder and a stated mass', () => {
    expect(
      isComponentRow({ ...nose, thickness: 0.0016, shoulderDiameter: 0.0241, shoulderLength: 0.0127, mass: 0.0065 }),
    ).toBe(true);
    expect(isComponentRow({ ...nose, thickness: null, shoulderDiameter: null, shoulderLength: null })).toBe(true);
  });

  it('refuses a mass or a shoulder that is not a number', () => {
    expect(isComponentRow({ ...nose, mass: '6 g' })).toBe(false);
    expect(isComponentRow({ ...nose, shoulderDiameter: 'wide' })).toBe(false);
  });
});

describe('isComponentRow refuses sizes and shapes the editor cannot build', () => {
  const nose = {
    type: 'nosecone',
    mfr: 'Estes',
    partNo: 'PNC-50K',
    desc: 'Nose cone',
    materialDensity: 1050,
    shape: 'ogive',
    filled: false,
    outerDiameter: 0.0247,
    length: 0.0667,
  };

  it('drops a zero or negative size, which would be a zero-volume part', () => {
    expect(isComponentRow(tube({ outerDiameter: 0 }))).toBe(false);
    expect(isComponentRow(tube({ length: -0.1 }))).toBe(false);
    expect(isComponentRow(tube({ innerDiameter: -0.001 }))).toBe(false);
    expect(isComponentRow({ ...nose, length: 0 })).toBe(false);
    expect(isComponentRow({ ...nose, mass: -1 })).toBe(false);
    expect(isComponentRow({ type: 'parachute', mfr: 'E', partNo: 'P', desc: 'D', diameter: 0, cd: null })).toBe(false);
  });

  it('drops a shape the editor does not know, rather than building a different one', () => {
    expect(isComponentRow({ ...nose, shape: 'blunted-ogive' })).toBe(false);
    expect(isComponentRow({ ...nose, shape: 'haack' })).toBe(true);
  });

  it('keeps a zero where a real row has one: no density on file, a solid part, no shoulder', () => {
    expect(isComponentRow(tube({ materialDensity: 0, innerDiameter: 0 }))).toBe(true);
    expect(isComponentRow({ ...nose, shoulderLength: 0 })).toBe(true);
  });

  it('keeps every row of the bundled catalog', () => {
    const cat = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/components.generated.json'), 'utf8')) as {
      components: unknown[];
    };
    expect(cat.components.filter((r) => !isComponentRow(r))).toEqual([]);
  });
});

/**
 * A row from the data host is a catalog row, never a saved part. `catalogPatch`
 * applies a `custom` row's `patch` as a whole node, so a published row carrying
 * one could write any key onto the part it is picked for.
 */
describe("a published row that carries a saved part's fields", () => {
  it('reaches the picker without them', async () => {
    vi.resetModules();
    vi.doMock('../../../src/services/app/remoteData', () => ({
      fetchCatalog: async () => ({
        generated: '',
        count: 1,
        components: [tube({ custom: true, id: 'mine', patch: { type: 'stage', children: [], overrideMass: 1e6 } })],
      }),
    }));
    const { componentsForType } = await import('../../../src/services/parts/componentDb');
    const { catalogPatch } = await import('../../../src/services/design/treeEdit');
    const [row] = await componentsForType('bodytube');
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('custom');
    expect(row).not.toHaveProperty('patch');
    expect(row).not.toHaveProperty('id');
    // Picked, it is a catalog body tube: its stated sizes, nothing from the patch.
    const patch = catalogPatch(row!);
    expect(patch['outerRadius']).toBe(0.0246 / 2);
    expect(patch).not.toHaveProperty('overrideMass');
    expect(patch).not.toHaveProperty('children');
    vi.doUnmock('../../../src/services/app/remoteData');
  });

  it('is refused when its material or digest is not a string, or its legacy flag not true', () => {
    expect(isComponentRow(tube({ material: 'Cardboard', digest: 'a87e783f' }))).toBe(true);
    expect(isComponentRow(tube({ material: { toString: 1 } }))).toBe(false);
    expect(isComponentRow(tube({ material: 5 }))).toBe(false);
    expect(isComponentRow(tube({ digest: ['x'] }))).toBe(false);
    expect(isComponentRow(tube({ legacy: true }))).toBe(true);
    expect(isComponentRow(tube({ legacy: 'yes' }))).toBe(false);
  });
});

/**
 * The parts desktop's library marks legacy (`ComponentPreset.LEGACY`, from the
 * `<Legacy/>` of the jar's `*-legacy.orc` files), by type: a dump of every
 * preset the 24.12 release jar loads (PresetDump and the full-property dump
 * agree). Desktop's chooser hides these until "Show Legacy Database" is
 * checked, so the catalog has to say which they are.
 */
describe('the legacy parts', () => {
  const LEGACY_BY_TYPE: Record<string, number> = {
    bodytube: 407,
    bulkhead: 71,
    centeringring: 199,
    engineblock: 26,
    launchlug: 43,
    nosecone: 397,
    parachute: 41,
    streamer: 12,
    transition: 253,
    tubecoupler: 95,
  };

  it('are the ones the release marks legacy, type by type', () => {
    const cat = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/components.generated.json'), 'utf8')) as {
      components: Component[];
    };
    const got: Record<string, number> = {};
    for (const p of cat.components) if (p.legacy) got[p.type] = (got[p.type] ?? 0) + 1;
    expect(got).toEqual(LEGACY_BY_TYPE);
  });

  it('tell two parts with one part number apart', () => {
    // SEMROC BC-08542 is in the database and in semroc-legacy.orc; the release
    // marks only the second legacy.
    const cat = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/components.generated.json'), 'utf8')) as {
      components: Component[];
    };
    const flag = (mfr: string) =>
      cat.components.find((p) => p.type === 'nosecone' && p.mfr === mfr && p.partNo === 'BC-08542')?.legacy;
    expect(flag('SEMROC')).toBeUndefined();
    expect(flag('SEMROC Astronautics')).toBe(true);
  });
});
