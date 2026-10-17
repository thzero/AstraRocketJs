import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/services/storage/settings';
import en from '../../../src/i18n/locales/en.json';

/**
 * The launch-defaults note says a new simulation starts here in still air
 * where desktop starts one in a wind, into the wind. Both halves are read
 * from where they live rather than restated: desktop's figures from the
 * preferences source the kernel runs with, the app's from its own defaults.
 * A change on either side has to reword or retire the note.
 */
describe('the launch-defaults note', () => {
  const java = (rel: string) => readFileSync(new URL(`../../../../engine-java/src/${rel}`, import.meta.url), 'utf8');

  it('quotes the wind desktop seeds a new simulation with', () => {
    const prefs = java('shims/java/info/openrocket/core/preferences/ApplicationPreferences.java');
    const average = prefs.match(/setAverage\(getDouble\(WIND_AVERAGE,\s*([\d.]+)\)\)/);
    if (!average) throw new Error('ApplicationPreferences.java seeds no WIND_AVERAGE');
    const options = java('java/info/openrocket/core/simulation/SimulationOptions.java');
    const intoWind = options.match(/getBoolean\(ApplicationPreferences\.LAUNCH_INTO_WIND,\s*(true|false)\)/);
    if (!intoWind) throw new Error('SimulationOptions.java seeds no LAUNCH_INTO_WIND');

    const note = en.settings.launchStillAir;
    expect(note).toContain(`${Number(average[1])} m/s`);
    expect(intoWind[1]).toBe('true');
    expect(note).toContain('into the wind');
  });

  it('is true of the app: a new simulation starts in still air', () => {
    const d = DEFAULT_SETTINGS.launchDefaults;
    expect(d.windAverage).toBe(0);
    expect(d.windStdDev).toBe(0);
    expect(d.launchIntoWind).toBe(false);
    expect(en.settings.launchStillAir).toContain('still air');
  });
});
