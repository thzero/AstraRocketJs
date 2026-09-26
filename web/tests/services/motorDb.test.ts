import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  filterMotors,
  allClasses,
  allManufacturers,
  findCatalogMotor,
  hasCurve,
  loadCatalog,
  type CatalogMotor,
  type MotorFilter,
} from '../../src/services/motorDb';
import { fetchCatalog } from '../../src/services/remoteData';

// `loadCatalog` is the only thing here that touches the network or storage.
vi.mock('../../src/services/remoteData', () => ({ fetchCatalog: vi.fn() }));
vi.mock('../../src/services/motorStore', () => ({ getMotorStore: () => ({ listCustomMotors: async () => [] }) }));

describe('hasCurve', () => {
  const m = (curves?: unknown): CatalogMotor =>
    ({
      designation: 'x',
      manufacturer: 'y',
      class: 'A',
      diameter: 18,
      impulse: 1,
      burn: 1,
      mass: 1,
      curves,
    }) as CatalogMotor;
  it('is true only for a bundled curve with ≥ 2 samples', () => {
    expect(
      hasCurve(
        m([
          {
            src: 'x',
            samples: [
              [0, 0],
              [1, 10],
            ],
          },
        ]),
      ),
    ).toBe(true);
    expect(hasCurve(m([{ src: 'x', samples: [[0, 0]] }]))).toBe(false); // one point
    expect(hasCurve(m([]))).toBe(false);
    expect(hasCurve(m(undefined))).toBe(false);
  });
});

const catalog: CatalogMotor[] = [
  { designation: 'C6', manufacturer: 'Estes', class: 'C', diameter: 18, impulse: 8.8, burn: 1.7, mass: 24 },
  { designation: 'C6', manufacturer: 'Quest', class: 'C', diameter: 18, impulse: 9.0, burn: 1.9, mass: 25 },
  { designation: 'D12', manufacturer: 'Estes', class: 'D', diameter: 24, impulse: 16.8, burn: 1.6, mass: 43 },
  { designation: 'B6', manufacturer: 'Estes', class: 'B', diameter: 18, impulse: 4.3, burn: 0.8, mass: 18 },
];

const filter = (over: Partial<MotorFilter> = {}): MotorFilter => ({
  classes: new Set(),
  manufacturers: new Set(),
  text: '',
  ...over,
});

describe('filterMotors', () => {
  it('returns everything with no active facets', () => {
    expect(filterMotors(catalog, filter())).toHaveLength(4);
  });

  it('filters by impulse class', () => {
    expect(filterMotors(catalog, filter({ classes: new Set(['C']) }))).toHaveLength(2);
    expect(filterMotors(catalog, filter({ classes: new Set(['D']) }))).toHaveLength(1);
  });

  it('filters by manufacturer', () => {
    expect(filterMotors(catalog, filter({ manufacturers: new Set(['Estes']) }))).toHaveLength(3);
  });

  it('filters by case-insensitive designation substring', () => {
    expect(filterMotors(catalog, filter({ text: 'c6' }))).toHaveLength(2);
    expect(filterMotors(catalog, filter({ text: '  D1 ' }))).toHaveLength(1);
  });

  it('filters by a diameter range (mm), inclusive', () => {
    expect(filterMotors(catalog, filter({ maxDiameter: 18 })).map((m) => m.designation)).toEqual(['C6', 'C6', 'B6']);
    expect(filterMotors(catalog, filter({ maxDiameter: 24 }))).toHaveLength(4); // open min
    expect(filterMotors(catalog, filter({ minDiameter: 24 })).map((m) => m.designation)).toEqual(['D12']);
    expect(filterMotors(catalog, filter({ minDiameter: 18, maxDiameter: 18 }))).toHaveLength(3); // just 18 mm
    expect(filterMotors(catalog, filter({ minDiameter: 24, maxDiameter: 18 }))).toEqual([]); // empty range
  });

  it('filters by a total impulse range (N·s), inclusive', () => {
    // The question a class cannot answer: a class is a doubling bucket, and a
    // number out of a design lands between two letters.
    expect(filterMotors(catalog, filter({ minImpulse: 9 })).map((m) => m.designation)).toEqual(['C6', 'D12']);
    expect(filterMotors(catalog, filter({ maxImpulse: 8.8 })).map((m) => m.designation)).toEqual(['C6', 'B6']);
    expect(filterMotors(catalog, filter({ minImpulse: 8.8, maxImpulse: 9 }))).toHaveLength(2);
    expect(filterMotors(catalog, filter({ minImpulse: 100 }))).toEqual([]);
  });

  it('filters by what goes in the mount, on both bore and length', () => {
    // Its own rows, because this is the one facet that reads a field the shared
    // fixture has no reason to carry.
    const row = (designation: string, diameter: number, length?: number): CatalogMotor => ({
      designation,
      manufacturer: 'Estes',
      class: 'C',
      diameter,
      impulse: 8.8,
      burn: 1.7,
      mass: 24,
      length,
    });
    const mounted = [row('fits', 18, 70), row('tooFat', 24, 70), row('tooLong', 18, 120), row('noLength', 18)];
    // An 18 mm tube 70 mm long, plus the default 6.35 mm of overhang.
    const kept = filterMotors(mounted, filter({ fit: { bore: 18, maxLength: 76.35 } }));
    expect(kept.map((m) => m.designation)).toEqual(['fits', 'noLength']);
  });

  it('filters to the motors sold without an ejection charge', () => {
    const row = (designation: string, delays?: string): CatalogMotor => ({
      designation,
      manufacturer: 'Estes',
      class: 'C',
      diameter: 18,
      impulse: 8.8,
      burn: 1.7,
      mass: 24,
      delays,
    });
    const rows = [row('pluggedOnly', 'P'), row('both', '0,3,5,P'), row('delayed', '4,6,8'), row('unknown')];
    const kept = filterMotors(rows, filter({ plugged: true }));
    expect(kept.map((m) => m.designation)).toEqual(['pluggedOnly', 'both']);
  });

  it('AND-s facets together', () => {
    const r = filterMotors(catalog, filter({ classes: new Set(['C']), manufacturers: new Set(['Quest']) }));
    expect(r).toHaveLength(1);
    expect(r[0]!.manufacturer).toBe('Quest');
  });
});

describe('facet lists', () => {
  it('allClasses is de-duped and sorted A→…', () => {
    expect(allClasses(catalog)).toEqual(['B', 'C', 'D']);
  });

  it('allManufacturers is de-duped and alphabetical', () => {
    expect(allManufacturers(catalog)).toEqual(['Estes', 'Quest']);
  });
});

describe('findCatalogMotor', () => {
  it('matches designation exactly (first candidate wins)', () => {
    expect(findCatalogMotor(catalog, 'C6')!.manufacturer).toBe('Estes');
  });

  it('prefers the requested manufacturer', () => {
    expect(findCatalogMotor(catalog, 'C6', 'Quest')!.manufacturer).toBe('Quest');
  });

  it('falls back to a loose match ignoring spaces/dashes', () => {
    expect(findCatalogMotor(catalog, 'C 6')!.designation).toBe('C6');
    expect(findCatalogMotor(catalog, 'd-12')!.designation).toBe('D12');
  });

  it('returns undefined for an empty designation or no match', () => {
    expect(findCatalogMotor(catalog, '')).toBeUndefined();
    expect(findCatalogMotor(catalog, 'X9')).toBeUndefined();
  });
});

describe('findCatalogMotor — full .ork designations vs short catalog names', () => {
  // Catalog keys the SHORT designation; the full name lives in `code`, exactly
  // as our bundled motors.generated.json does (see Fireball.ZL1.DD.multi.ork).
  const cat: CatalogMotor[] = [
    {
      designation: 'H128',
      manufacturer: 'AeroTech',
      class: 'H',
      diameter: 29,
      impulse: 1,
      burn: 1,
      mass: 1,
      code: 'H128W',
    },
    {
      designation: 'I180',
      manufacturer: 'AeroTech',
      class: 'I',
      diameter: 38,
      impulse: 1,
      burn: 1,
      mass: 1,
      code: 'I180W',
    },
    {
      designation: 'I180',
      manufacturer: 'Cesaroni',
      class: 'I',
      diameter: 38,
      impulse: 1,
      burn: 1,
      mass: 1,
      code: '338I180-14A',
    },
    {
      designation: 'J350',
      manufacturer: 'AeroTech',
      class: 'J',
      diameter: 38,
      impulse: 1,
      burn: 1,
      mass: 1,
      code: 'J350W',
    },
    {
      designation: 'J350',
      manufacturer: 'Loki',
      class: 'J',
      diameter: 38,
      impulse: 1,
      burn: 1,
      mass: 1,
      code: 'J350-SF',
    },
    {
      designation: 'G84',
      manufacturer: 'Cesaroni',
      class: 'G',
      diameter: 29,
      impulse: 1,
      burn: 1,
      mass: 1,
      code: '131G84-10A',
    },
  ];

  it('matches an AeroTech full name via the code field', () => {
    expect(findCatalogMotor(cat, 'H128W', 'AeroTech')!.designation).toBe('H128');
  });

  it('matches a Cesaroni full name (case + delay) via the code field', () => {
    const m = findCatalogMotor(cat, '131G84-10A', 'Cesaroni Technology')!;
    expect(m.designation).toBe('G84');
    expect(m.manufacturer).toBe('Cesaroni');
  });

  it('disambiguates duplicate short names by manufacturer', () => {
    expect(findCatalogMotor(cat, 'I180W', 'AeroTech')!.manufacturer).toBe('AeroTech');
    expect(findCatalogMotor(cat, '338I180-14A', 'Cesaroni')!.manufacturer).toBe('Cesaroni');
  });

  it('resolves a variant suffix by stripping it (J350W-OLD → J350 AeroTech)', () => {
    const m = findCatalogMotor(cat, 'J350W-OLD', 'AeroTech')!;
    expect(m.designation).toBe('J350');
    expect(m.manufacturer).toBe('AeroTech');
  });

  it('still returns undefined when the motor genuinely is not present', () => {
    expect(findCatalogMotor(cat, 'K1100T', 'AeroTech')).toBeUndefined();
  });
});

/**
 * One malformed row must cost that row, not the catalog.
 *
 * `isCatalog` was `every(isCatalogMotor)`, and remoteData rejects a body its
 * predicate refuses, so a single bad row on the data host threw the whole
 * ~1500-motor catalog away (and, once the in-build copy carried the same row,
 * left the picker empty). The intent all along (docs/AUDIT.md, seventh pass)
 * was row-by-row: drop the bad rows, keep the rest.
 */
describe('loadCatalog with a malformed row', () => {
  const good = (designation: string): CatalogMotor => ({
    designation,
    manufacturer: 'Estes',
    class: 'C',
    diameter: 18,
    impulse: 8.8,
    burn: 1.7,
    mass: 24,
  });

  beforeEach(() => {
    // The real fetchCatalog rejects a body its `valid` predicate refuses; the
    // stub keeps that contract so the gate is exercised, not bypassed.
    vi.mocked(fetchCatalog).mockReset();
  });

  const serve = (body: unknown) =>
    vi
      .mocked(fetchCatalog)
      .mockImplementation((name, valid) =>
        valid && !valid(body)
          ? Promise.reject(new Error(`Could not load the ${name} catalog (unexpected catalog shape)`))
          : Promise.resolve(body as never),
      );

  it('drops the bad row and keeps the rest', async () => {
    serve([good('C6'), { designation: 42, manufacturer: 'x' }, null, good('D12')]);
    const rows = await loadCatalog();
    expect(rows.map((m) => m.designation)).toEqual(['C6', 'D12']);
  });

  it('still rejects a catalog that is not an array', async () => {
    serve({ error: 'rebuilding' });
    await expect(loadCatalog()).rejects.toThrow(/Could not load the motors catalog/);
  });

  it('still rejects a catalog with no usable row at all', async () => {
    serve([{ designation: 42 }, 'nope']);
    await expect(loadCatalog()).rejects.toThrow(/Could not load the motors catalog/);
  });
});
