import { describe, it, expect } from 'vitest';
import {
  filterMotors,
  allClasses,
  allManufacturers,
  findCatalogMotor,
  hasCurve,
  type CatalogMotor,
  type MotorFilter,
} from './motorDb';

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
    { designation: 'H128', manufacturer: 'AeroTech', class: 'H', diameter: 29, impulse: 1, burn: 1, mass: 1, code: 'H128W' },
    { designation: 'I180', manufacturer: 'AeroTech', class: 'I', diameter: 38, impulse: 1, burn: 1, mass: 1, code: 'I180W' },
    { designation: 'I180', manufacturer: 'Cesaroni', class: 'I', diameter: 38, impulse: 1, burn: 1, mass: 1, code: '338I180-14A' },
    { designation: 'J350', manufacturer: 'AeroTech', class: 'J', diameter: 38, impulse: 1, burn: 1, mass: 1, code: 'J350W' },
    { designation: 'J350', manufacturer: 'Loki', class: 'J', diameter: 38, impulse: 1, burn: 1, mass: 1, code: 'J350-SF' },
    { designation: 'G84', manufacturer: 'Cesaroni', class: 'G', diameter: 29, impulse: 1, burn: 1, mass: 1, code: '131G84-10A' },
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
