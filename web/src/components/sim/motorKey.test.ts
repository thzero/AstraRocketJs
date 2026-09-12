import { describe, it, expect } from 'vitest';
import { keyOf } from './MotorDashboard';
import type { CatalogMotor } from '../../services/motorDb';

const motor = (o: Partial<CatalogMotor>) =>
  ({ manufacturer: 'AeroTech', designation: 'F67', diameter: 29, ...o }) as CatalogMotor;

describe('keyOf', () => {
  it('separates same-name, same-bore motors that differ only by manufacturer code', () => {
    // AeroTech F67W (White Lightning) vs F67C (Classic) — both "F67", both 29 mm,
    // but 61 N·s vs 77 N·s. Keying without `code` collapsed them onto one row key,
    // so they selected and check-boxed as a single motor.
    expect(keyOf(motor({ code: 'F67W' }))).not.toBe(keyOf(motor({ code: 'F67C' })));
  });

  it('is stable for the same motor regardless of unrelated fields', () => {
    const a = motor({ code: 'F67W', impulse: 61.1 });
    const b = motor({ code: 'F67W', impulse: 999 });
    expect(keyOf(a)).toBe(keyOf(b));
  });

  it('still distinguishes by manufacturer, name and bore when no code is present', () => {
    const keys = [
      motor({}),
      motor({ manufacturer: 'Cesaroni' }),
      motor({ designation: 'G77' }),
      motor({ diameter: 38 }),
    ].map(keyOf);
    expect(new Set(keys).size).toBe(4);
  });

  it('treats a missing code as empty rather than the string "undefined"', () => {
    expect(keyOf(motor({}))).toBe('AeroTech|F67|29|');
  });
});

describe('the shipped motor catalog', () => {
  it('has no two motors sharing a key', async () => {
    // Read as raw text (not a JSON import) so tsc never has to typecheck a ~1.6 MB
    // object literal. This guards the copy committed under public/data — the
    // fallback build ships. The separately published catalog is checked by the
    // duplicate count in sync-catalogs.yml's run summary.
    const mods = import.meta.glob('../../../public/data/motors.generated.json', {
      query: '?raw',
      import: 'default',
    });
    const load = Object.values(mods)[0];
    expect(load, 'motors.generated.json should be readable from the test').toBeTypeOf('function');
    const catalog = JSON.parse((await load!()) as string) as CatalogMotor[];

    const seen = new Set<string>();
    const dupes = catalog.map(keyOf).filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(dupes).toEqual([]);
    expect(seen.size).toBe(catalog.length);
  });
});
