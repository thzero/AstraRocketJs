import type { AtmosphereLevel } from '../design/orkTree';

/**
 * What a forecast atmosphere has to be true of before the engine will fly it,
 * asked in one place so the Weather dialog, the .ork reader and the stored
 * defaults cannot disagree.
 *
 * The bridge (AtmosphereProfile) refuses a level with a non-finite number, a
 * temperature at or below absolute zero, a pressure that is not positive, a
 * humidity outside 0..1, two levels at one altitude, and a pressure that does
 * not fall with altitude. Each of those fails the whole run, so a path with no
 * user to tell drops the offending level instead.
 */

const KEYS = ['altitudeM', 'temperatureC', 'pressureHPa', 'relativeHumidity'] as const;

/** An object carrying four finite numbers inside the ranges the bridge takes. */
export function isUsableAtmosphereLevel(l: unknown): l is AtmosphereLevel {
  if (!l || typeof l !== 'object') return false;
  const r = l as Record<string, unknown>;
  if (!KEYS.every((k) => Number.isFinite(r[k]))) return false;
  const v = l as AtmosphereLevel;
  return v.temperatureC > -273.15 && v.pressureHPa > 0 && v.relativeHumidity >= 0 && v.relativeHumidity <= 1;
}

/**
 * The levels the engine can fly, lowest first: every level usable, and each one
 * above and at a lower pressure than the one kept before it. The first level at
 * an altitude wins.
 */
export function usableAtmosphereLevels(levels: readonly unknown[]): AtmosphereLevel[] {
  const sorted = levels.filter(isUsableAtmosphereLevel).sort((a, b) => a.altitudeM - b.altitudeM);
  const kept: AtmosphereLevel[] = [];
  for (const l of sorted) {
    const prev = kept[kept.length - 1];
    if (prev && !(l.altitudeM > prev.altitudeM && l.pressureHPa < prev.pressureHPa)) continue;
    kept.push({
      altitudeM: l.altitudeM,
      temperatureC: l.temperatureC,
      pressureHPa: l.pressureHPa,
      relativeHumidity: l.relativeHumidity,
    });
  }
  return kept;
}
