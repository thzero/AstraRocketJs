// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

const KEY = 'astrarrocketjs:settings:v1';

beforeEach(() => localStorage.clear());

describe('loadSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('deep-merges partial simulation prefs over the defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ simulation: { timeStep: 0.1 } }));
    const s = loadSettings();
    expect(s.simulation.timeStep).toBe(0.1); // overridden
    expect(s.simulation.maxTime).toBe(DEFAULT_SETTINGS.simulation.maxTime); // default kept
    expect(s.simulation.confirmDelete).toBe(DEFAULT_SETTINGS.simulation.confirmDelete);
  });

  it('deep-merges partial phase colors', () => {
    localStorage.setItem(KEY, JSON.stringify({ phaseColors: { boost: '#000000' } }));
    const s = loadSettings();
    expect(s.phaseColors.boost).toBe('#000000');
    expect(s.phaseColors.coast).toBe(DEFAULT_SETTINGS.phaseColors.coast);
  });

  it('guards playbackSpeed against a non-number', () => {
    localStorage.setItem(KEY, JSON.stringify({ playbackSpeed: 'fast' }));
    expect(loadSettings().playbackSpeed).toBe(DEFAULT_SETTINGS.playbackSpeed);
  });

  it('guards playbackSpeed against the non-numbers that ARE numbers', () => {
    // A stored NaN is the one that hurts: it types as `number`, so only the
    // finiteness check catches it, and it makes the playback clock never
    // advance with no way back but clearing storage. JSON has no NaN literal,
    // which is why each of these has to be written as something JSON can hold.
    for (const raw of ['{"playbackSpeed":null}', '{"playbackSpeed":0}', '{"playbackSpeed":-2}']) {
      localStorage.setItem(KEY, raw);
      expect(loadSettings().playbackSpeed, raw).toBe(DEFAULT_SETTINGS.playbackSpeed);
    }
    // Infinity round-trips through JSON.stringify as null, so reach it directly.
    localStorage.setItem(KEY, JSON.stringify({ playbackSpeed: Number.MAX_VALUE }));
    expect(loadSettings().playbackSpeed).toBe(10); // clamped, not rejected
  });

  it('clamps playbackSpeed into the range the player can actually run', () => {
    localStorage.setItem(KEY, JSON.stringify({ playbackSpeed: 1000 }));
    expect(loadSettings().playbackSpeed).toBe(10);
    localStorage.setItem(KEY, JSON.stringify({ playbackSpeed: 0.0001 }));
    expect(loadSettings().playbackSpeed).toBe(0.05);
    localStorage.setItem(KEY, JSON.stringify({ playbackSpeed: 2 }));
    expect(loadSettings().playbackSpeed).toBe(2); // in range, untouched
  });

  it('drops a partColors value that is not a hex string', () => {
    // These reach a `style` attribute. The round-trip case below stores a valid
    // '#123456' and so cannot see the filter at all - every rejected shape has
    // to be passed in deliberately. A stored object, array or CSS payload used
    // to ride straight through the spread and into the renderer.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        partColors: {
          fins: '#123456',
          nose: 'red; background: url(http://evil/x)',
          body: { toString: 'nope' },
          tubes: ['#fff'],
          rings: 42,
          lugs: null,
          chutes: '#abc',
        },
      }),
    );
    const c = loadSettings().partColors as Record<string, unknown>;
    expect(c.fins).toBe('#123456');
    expect(c.chutes).toBe('#abc'); // 3-digit hex is legitimate
    for (const k of ['nose', 'body', 'tubes', 'rings', 'lugs']) expect(c[k]).toBeUndefined();
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not valid');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults wipAcknowledged to false and round-trips a stored true', () => {
    expect(loadSettings().wipAcknowledged).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ wipAcknowledged: true }));
    expect(loadSettings().wipAcknowledged).toBe(true);
  });

  it('keeps a report unit choice, and falls back rather than trusting an unknown one', () => {
    expect(loadSettings().report.units).toBe('current');
    localStorage.setItem(KEY, JSON.stringify({ report: { units: 'imperial' } }));
    expect(loadSettings().report.units).toBe('imperial');
    // A hand-edited or future-version value must not reach resolveUnitChoice,
    // where anything unrecognized would silently mean "current" anyway.
    localStorage.setItem(KEY, JSON.stringify({ report: { units: 'furlongs' } }));
    expect(loadSettings().report.units).toBe('current');
  });

  it('defaults the CG/CP marker + info-card toggles to on and round-trips a stored false', () => {
    expect(loadSettings().showMarkers).toBe(true);
    expect(loadSettings().showInfoCard).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ showMarkers: false, showInfoCard: false }));
    expect(loadSettings().showMarkers).toBe(false);
    expect(loadSettings().showInfoCard).toBe(false);
  });

  it('clamps a stored tree-pane width into the usable range', () => {
    expect(loadSettings().treePaneWidth).toBe(360);
    localStorage.setItem(KEY, JSON.stringify({ treePaneWidth: 500 }));
    expect(loadSettings().treePaneWidth).toBe(500);
    // The value lands in a style attribute, so a hand-edited or corrupted one
    // must not be able to render a column of 0 or of 90000 pixels - there would
    // be no way back to the splitter to fix it.
    localStorage.setItem(KEY, JSON.stringify({ treePaneWidth: 0 }));
    expect(loadSettings().treePaneWidth).toBe(300);
    localStorage.setItem(KEY, JSON.stringify({ treePaneWidth: 90_000 }));
    expect(loadSettings().treePaneWidth).toBe(640);
    localStorage.setItem(KEY, JSON.stringify({ treePaneWidth: 'wide' }));
    expect(loadSettings().treePaneWidth).toBe(360);
    localStorage.setItem(KEY, JSON.stringify({ treePaneWidth: Number.NaN }));
    expect(loadSettings().treePaneWidth).toBe(360);
  });

  it('clamps a stored side-pane width, and shares one value across the three columns', () => {
    expect(loadSettings().sidePaneWidth).toBe(380);
    localStorage.setItem(KEY, JSON.stringify({ sidePaneWidth: 420 }));
    expect(loadSettings().sidePaneWidth).toBe(420);
    localStorage.setItem(KEY, JSON.stringify({ sidePaneWidth: 10 }));
    expect(loadSettings().sidePaneWidth).toBe(300);
    localStorage.setItem(KEY, JSON.stringify({ sidePaneWidth: 5000 }));
    expect(loadSettings().sidePaneWidth).toBe(640);
    localStorage.setItem(KEY, JSON.stringify({ sidePaneWidth: null }));
    expect(loadSettings().sidePaneWidth).toBe(380);
  });

  it('defaults maximizeCenter to off and round-trips a stored true', () => {
    expect(loadSettings().maximizeCenter).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ maximizeCenter: true }));
    expect(loadSettings().maximizeCenter).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ maximizeCenter: 'yes' }));
    expect(loadSettings().maximizeCenter).toBe(false);
  });

  it('defaults the import notes to expanded and round-trips a stored false', () => {
    // Open by default: a note says what a file could NOT bring across, which is
    // worth seeing once before it is folded away for good.
    expect(loadSettings().showImportNotes).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ showImportNotes: false }));
    expect(loadSettings().showImportNotes).toBe(false);
    // A non-boolean (hand-edited, or a future version's shape) falls back to the
    // default rather than reaching the card as a truthy string.
    localStorage.setItem(KEY, JSON.stringify({ showImportNotes: 'no' }));
    expect(loadSettings().showImportNotes).toBe(true);
  });
});

describe('saveSettings', () => {
  it('round-trips through localStorage', () => {
    const custom = { ...DEFAULT_SETTINGS, playbackSpeed: 2, partColors: { fins: '#123456' } };
    saveSettings(custom);
    const s = loadSettings();
    expect(s.playbackSpeed).toBe(2);
    expect(s.partColors.fins).toBe('#123456');
  });
});

/**
 * `launchDefaults` reaches simConditions() and then simulate() for every NEW
 * simulation, and was spread-merged unchecked — while the `simulation` block
 * directly above it has clamped for exactly this reason since it was written.
 */
describe('launchDefaults is validated per field', () => {
  const load = (launchDefaults: unknown) => {
    localStorage.setItem(KEY, JSON.stringify({ launchDefaults }));
    return loadSettings().launchDefaults;
  };

  it('falls back for a required number that is a string, null or NaN', () => {
    // NaN cannot survive JSON (it writes as null), so null is what a corrupt
    // blob actually reads back as — plus a string, which a hand-edit gives.
    expect(load({ launchRodLengthM: null }).launchRodLengthM).toBe(DEFAULT_SETTINGS.launchDefaults.launchRodLengthM);
    expect(load({ windAverage: '5' }).windAverage).toBe(DEFAULT_SETTINGS.launchDefaults.windAverage);
    expect(load({ latitudeDeg: {} }).latitudeDeg).toBe(DEFAULT_SETTINGS.launchDefaults.latitudeDeg);
  });

  it('keeps a legitimate value, including zero', () => {
    expect(load({ launchRodAngleDeg: 0 }).launchRodAngleDeg).toBe(0);
    expect(load({ windAverage: 7.5 }).windAverage).toBe(7.5);
  });

  it('leaves an absent optional field absent rather than inventing one', () => {
    expect(load({}).longitudeDeg).toBe(DEFAULT_SETTINGS.launchDefaults.longitudeDeg);
    expect(load({ longitudeDeg: 12 }).longitudeDeg).toBe(12);
    expect(load({ longitudeDeg: 'east' }).longitudeDeg).toBe(DEFAULT_SETTINGS.launchDefaults.longitudeDeg);
  });

  it('keeps null temperature and pressure, which MEAN the ISA standard atmosphere', () => {
    // The one place null is an answer, not a missing value — so it must survive.
    expect(load({ temperatureC: null, pressureHPa: null }).temperatureC).toBeNull();
    expect(load({ temperatureC: null, pressureHPa: null }).pressureHPa).toBeNull();
    expect(load({ temperatureC: 'warm' }).temperatureC).toBe(DEFAULT_SETTINGS.launchDefaults.temperatureC);
  });

  it('rejects a geodetic model and a wind profile of the wrong shape', () => {
    expect(load({ geodetic: 'toroidal' }).geodetic).toBe(DEFAULT_SETTINGS.launchDefaults.geodetic);
    expect(load({ geodetic: 'wgs84' }).geodetic).toBe('wgs84');
    expect(load({ windLevels: 'lots' }).windLevels).toBe(DEFAULT_SETTINGS.launchDefaults.windLevels);
  });
});
