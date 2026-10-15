// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { useWorkspaceStore, selectActive, workspaceSnapshot } from '../../src/state/store';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/services/storage/settings';
import { importOrk } from '../../src/services/files/orkFile';
import { wireLoadedOrk } from '../../src/services/files/wireLoadedOrk';
import type { LoadedOrk } from '../../src/services/files/loadOrk';
import type { AtmosphereLevel } from '../../src/services/design/orkTree';

const s = () => useWorkspaceStore.getState();

/** A forecast the Settings defaults carry, as the Weather dialog's Apply leaves it. */
const forecast: AtmosphereLevel[] = [
  { altitudeM: 0, temperatureC: 30, pressureHPa: 1000, relativeHumidity: 0.5 },
  { altitudeM: 3000, temperatureC: 10, pressureHPa: 700, relativeHumidity: 0.3 },
];

const withForecastDefault = () =>
  saveSettings({
    ...DEFAULT_SETTINGS,
    launchDefaults: { ...DEFAULT_SETTINGS.launchDefaults, atmosphereLevels: forecast },
  });

afterEach(() => localStorage.clear());

/**
 * Forecast levels belong to the launch that holds them. Settings defaults fill
 * a new simulation, but a desktop file or a stored simulation without levels
 * flies the standard atmosphere it was set up with.
 */
describe('a forecast atmosphere in the Settings defaults', () => {
  it('stays out of a desktop .ork that flies the standard atmosphere', () => {
    const bytes = readFileSync(resolve(__dirname, '../../public/examples/a-simple-model-rocket.ork'));
    // The file as desktop wrote it: no forecast levels in any simulation.
    const xml = Object.values(unzipSync(new Uint8Array(bytes)))
      .map((f) => strFromU8(f))
      .join('');
    expect(xml).toContain('creator="OpenRocket');
    expect(xml).not.toContain('forecastlevel');

    withForecastDefault();
    const res = importOrk(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const w = wireLoadedOrk(res as unknown as LoadedOrk, loadSettings().launchDefaults);

    expect(w.sims.length).toBeGreaterThan(0);
    for (const sim of w.sims) expect(sim.launch).not.toHaveProperty('atmosphereLevels');
  });

  it('stays out of a stored simulation whose forecast was cleared', () => {
    withForecastDefault();
    s().resetWorkspace();
    expect(selectActive(s()).launch.atmosphereLevels).toEqual(forecast);
    s().patchLaunch({ atmosphereLevels: undefined });
    const stored = JSON.parse(JSON.stringify(workspaceSnapshot(s())));
    expect(stored.sims[0].launch).not.toHaveProperty('atmosphereLevels');

    s().hydrate(stored);
    expect(selectActive(s()).launch).not.toHaveProperty('atmosphereLevels');
  });

  it('still fills a new simulation', () => {
    withForecastDefault();
    s().resetWorkspace();
    expect(selectActive(s()).launch.atmosphereLevels).toEqual(forecast);
  });
});
