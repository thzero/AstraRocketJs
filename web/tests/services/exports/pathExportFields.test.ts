import { describe, expect, it } from 'vitest';
import {
  PATH_EXPORT_FIELDS,
  hydrateExportOptions,
  persistedExportSettings,
} from '../../../src/services/exports/pathExportFields';
import { defaultExportOptions, type FlightPathExportOptions } from '../../../src/services/exports/flightPathExport';
import type { PathExportSettings } from '../../../src/services/storage/settings';

/**
 * The dialog loads and saves its remembered options from one table, so the two
 * directions cannot cover different fields. These cases hold the table to that:
 * every option but the mission name has exactly one row, and every row survives
 * a save, a trip through JSON (the localStorage form) and a load.
 */

const both = { altitude: true, distance: true };

/** A value for every remembered option that differs from `defaultExportOptions('m')`. */
const CHANGED: Omit<FlightPathExportOptions, 'missionName'> = {
  waypoints: new Set(['apogee', 'landing']),
  includeFlightPath: false,
  includeGroundTrack: false,
  pathStride: 7,
  altitudeUnit: 'ft',
  distanceUnit: 'km',
  altitudeReference: 'ground',
  waypointAltitudeReference: 'sealevel',
  drawShadow: true,
  stageTrackStart: 'pad',
  showWaypointLabels: false,
  colorWaypointPins: false,
  includeDescriptions: false,
  language: 'es',
  labelWaypointsWithMission: true,
  branchColors: new Map([[0, 0x112233]]),
  branchGroundColors: new Map([[1, 0x445566]]),
  branchPinColors: new Map([[2, 0x778899]]),
};

const roundTrip = (opts: FlightPathExportOptions, explicit = both): FlightPathExportOptions =>
  hydrateExportOptions(
    defaultExportOptions('m'),
    JSON.parse(JSON.stringify(persistedExportSettings(opts, explicit))) as PathExportSettings,
  );

describe('path export field table', () => {
  it('has one row per remembered option, and none for the mission name', () => {
    const options = PATH_EXPORT_FIELDS.map((f) => f.option);
    const remembered = Object.keys(defaultExportOptions('m')).filter((k) => k !== 'missionName');
    expect([...options].sort()).toEqual([...remembered].sort());
    expect(new Set(options).size).toBe(options.length);
    expect(new Set(PATH_EXPORT_FIELDS.map((f) => f.setting)).size).toBe(PATH_EXPORT_FIELDS.length);
  });

  it('saves exactly the fields the table lists', () => {
    const stored = persistedExportSettings(defaultExportOptions('m'), both);
    expect(Object.keys(stored)).toEqual(PATH_EXPORT_FIELDS.map((f) => f.setting));
    expect(stored).not.toHaveProperty('missionName');
  });

  it('round-trips every row', () => {
    // A row added to the table without a changed value fails here, so no field
    // is remembered without a proof that it comes back.
    expect(Object.keys(CHANGED).sort()).toEqual(PATH_EXPORT_FIELDS.map((f) => f.option).sort());
    const opts: FlightPathExportOptions = { ...defaultExportOptions('m'), ...CHANGED, missionName: 'M1' };
    const back = roundTrip(opts);
    for (const f of PATH_EXPORT_FIELDS) {
      expect(back[f.option], f.option).toEqual(opts[f.option]);
      expect(back[f.option], f.option).not.toEqual(defaultExportOptions('m')[f.option]);
    }
    expect(back.missionName).toBe('');
  });

  it('leaves a unit absent until it is an explicit choice', () => {
    const opts: FlightPathExportOptions = { ...defaultExportOptions('m'), altitudeUnit: 'ft', distanceUnit: 'km' };
    const stored = persistedExportSettings(opts, { altitude: false, distance: true });
    expect(stored).not.toHaveProperty('altitudeUnit');
    expect(stored.distanceUnit).toBe('km');
    const back = hydrateExportOptions(defaultExportOptions('mi'), stored);
    expect(back.altitudeUnit).toBe('mi');
    expect(back.distanceUnit).toBe('km');
  });

  it('falls back per field on an unreadable value, and keeps an empty waypoint list', () => {
    const back = hydrateExportOptions(defaultExportOptions('m'), {
      labelWaypointsWithMission: false,
      waypoints: [],
      altitudeUnit: 'furlong',
      altitudeReference: 'orbit',
      stageTrackStart: 'nowhere',
      pathStride: 3,
    });
    expect(back.waypoints.size).toBe(0);
    expect(back.altitudeUnit).toBe('m');
    expect(back.altitudeReference).toBe('automatic');
    expect(back.stageTrackStart).toBe('separation');
    expect(back.pathStride).toBe(3);
  });
});
