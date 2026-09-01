import { describe, it, expect } from 'vitest';
import {
  filterMotors,
  allClasses,
  allManufacturers,
  findCatalogMotor,
  type CatalogMotor,
  type MotorFilter,
} from './motorDb';

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
