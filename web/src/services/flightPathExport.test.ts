import { describe, it, expect } from 'vitest';
import {
  buildFlightPathModel,
  defaultExportOptions,
  hasLaunchPosition,
  renderKml,
  renderGpx,
  renderWaypointCsv,
  renderUserTemplate,
  mimeForExtension,
  EXPORT_FORMATS,
  type WaypointKind,
} from './flightPathExport';
import type { FlightResult } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';

// A tiny two-branch-free flight: launch → drift 100 m east / 200 m north,
// climbing to 100 m AGL, with a couple of events.
const result = {
  summary: { maxAltitude: 100, maxVelocity: 50, maxAcceleration: 20 },
  series: {
    time: [0, 1, 2],
    altitude: [0, 100, 0],
    velocity: [0, 50, 10],
    acceleration: [20, 5, -9.8],
    Px: [0, 50, 100], // east (m)
    Py: [0, 100, 200], // north (m)
  },
  events: [
    { type: 'LIFTOFF', time: 0.0 },
    { type: 'APOGEE', time: 1.0 },
    { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 1.0, source: 'Main chute' },
    { type: 'GROUND_HIT', time: 2.0 },
  ],
} as unknown as FlightResult;

const launch: LaunchConditions = {
  latitudeDeg: 40,
  longitudeDeg: -105,
  launchAltitudeM: 1600,
} as LaunchConditions;

const label = (k: WaypointKind) => k; // identity labels for assertions

const model = () => buildFlightPathModel(result, launch, { simName: 'Sim 1', rocketName: 'My <Rocket>', motorName: 'C6' }, defaultExportOptions(), label);

describe('buildFlightPathModel', () => {
  it('projects Px/Py drift onto lat/lon about the launch site', () => {
    const m = model();
    const b = m.branches[0]!;
    const pad = b.waypoints.find((w) => w.type === 'pad')!;
    // Pad sits exactly at the launch site.
    expect(pad.latitude).toBeCloseTo(40, 6);
    expect(pad.longitude).toBeCloseTo(-105, 6);
    // MSL = AGL + launch altitude.
    expect(pad.altitudeMslMeters).toBe(1600);

    // Apogee drifted +100 m north, +50 m east → latitude/longitude increase.
    const apogee = b.waypoints.find((w) => w.type === 'apogee')!;
    expect(apogee.latitude).toBeGreaterThan(40);
    expect(apogee.longitude).toBeGreaterThan(-105);
    expect(apogee.altitudeMslMeters).toBe(1700); // 100 AGL + 1600
  });

  it('emits all enabled waypoints, sorted by time, with recovery device name', () => {
    const m = model();
    const w = m.branches[0]!.waypoints;
    const types = w.map((x) => x.type);
    expect(types).toContain('pad');
    expect(types).toContain('liftoff');
    expect(types).toContain('apogee');
    expect(types).toContain('recovery');
    expect(types).toContain('landing');
    expect(types).toContain('maxvelocity');
    expect(types).toContain('maxacceleration');
    // sorted by time
    const times = w.map((x) => x.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // recovery label falls back to the device name
    expect(w.find((x) => x.type === 'recovery')!.label).toBe('Main chute');
    // max velocity is at index 1 (v=50)
    expect(w.find((x) => x.type === 'maxvelocity')!.timeStr).toBe('1.00');
  });

  it('honours the waypoint selection', () => {
    const opts = defaultExportOptions();
    opts.waypoints = new Set<WaypointKind>(['apogee']);
    const m = buildFlightPathModel(result, launch, { simName: 'S', rocketName: 'R', motorName: 'C6' }, opts, label);
    expect(m.branches[0]!.waypoints.map((w) => w.type)).toEqual(['apogee']);
  });

  it('samples the path with stride and always keeps the final point', () => {
    const opts = defaultExportOptions();
    opts.pathStride = 2;
    const m = buildFlightPathModel(result, launch, { simName: 'S', rocketName: 'R', motorName: 'C6' }, opts, label);
    // n=3, stride 2 → indices 0, 2; (n-1)%2===0 so no extra append → 2 points.
    expect(m.branches[0]!.path.map((p) => p.time)).toEqual([0, 2]);
  });
});

describe('renderKml', () => {
  const kml = renderKml(model());
  it('is well-formed KML with a document name and both track styles', () => {
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<kml')).toBe(true);
    expect(kml).toContain('<name>Sim 1</name>');
    expect(kml).toContain('id="flightPath"');
    expect(kml).toContain('id="groundTrack"');
    expect(kml.trimEnd().endsWith('</kml>')).toBe(true);
  });
  it('writes coordinates as lon,lat,alt', () => {
    // pad placemark → longitude first, then latitude, then MSL altitude
    expect(kml).toContain('<coordinates>-105,40,1600</coordinates>');
  });
  it('omits the flight-path line when disabled', () => {
    const opts = defaultExportOptions();
    opts.includeFlightPath = false;
    opts.includeGroundTrack = false;
    const k = renderKml(buildFlightPathModel(result, launch, { simName: 'S', rocketName: 'R', motorName: 'C6' }, opts, label));
    expect(k).not.toContain('#flightPath');
    expect(k).not.toContain('#groundTrack');
  });
});

describe('renderGpx', () => {
  it('emits waypoints and a track segment', () => {
    const gpx = renderGpx(model());
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<wpt lat="40" lon="-105">');
    expect(gpx).toContain('<trkpt lat="40" lon="-105"><ele>1600</ele></trkpt>');
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });
});

describe('renderWaypointCsv', () => {
  it('has the header and one quoted row per waypoint', () => {
    const csv = renderWaypointCsv(model());
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('"altitude(m)","latitude","longitude","label","symbol","color","label_color","name"');
    // 7 waypoints (all kinds present in this flight)
    expect(lines.length).toBe(1 + 7);
    expect(lines[1]!.startsWith('"')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('escaping', () => {
  it('XML-escapes text fields in KML/GPX', () => {
    const m = model(); // rocketName "My <Rocket>", but title is simName
    m.branches[0]!.name = 'A & B <c>';
    const kml = renderKml(m);
    expect(kml).toContain('<name>A &amp; B &lt;c&gt;</name>');
  });
  it('CSV-escapes embedded quotes by doubling', () => {
    const m = model();
    m.rocketName = 'He said "hi"';
    const csv = renderWaypointCsv(m);
    expect(csv).toContain('He said ""hi""');
  });
});

describe('hasLaunchPosition', () => {
  it('is false at (0,0) and true otherwise', () => {
    expect(hasLaunchPosition({ latitudeDeg: 0, longitudeDeg: 0 } as LaunchConditions)).toBe(false);
    expect(hasLaunchPosition({ latitudeDeg: 40, longitudeDeg: 0 } as LaunchConditions)).toBe(true);
  });
});

describe('renderUserTemplate (Mustache)', () => {
  it('renders a template using the desktop model field names', () => {
    const src = 'Rocket: {{rocketName}} / Motor: {{motor}}\n{{#branches}}{{name}}: {{#waypoints}}[{{label}}]{{/waypoints}}{{/branches}}';
    const out = renderUserTemplate(src, 'txt', model());
    expect(out).toContain('Rocket: My <Rocket> / Motor: C6'); // txt → no escaping
    expect(out).toContain('[apogee]');
  });

  it('reproduces the reference KML coordinate loop with hasPath/section gating', () => {
    // A trimmed version of the bundled flightpath.kml.mustache.
    const src = [
      '<name>{{title}}</name>',
      '{{#branches}}{{#includeFlightPath}}{{#hasPath}}',
      '<coords>{{#path}}{{longitude}},{{latitude}},{{altitudeMslMeters}} {{/path}}</coords>',
      '{{/hasPath}}{{/includeFlightPath}}{{/branches}}',
    ].join('\n');
    const out = renderUserTemplate(src, 'kml', model());
    expect(out).toContain('<name>Sim 1</name>');
    expect(out).toContain('-105,40,1600'); // pad point lon,lat,alt
  });

  it('escapes by extension: XML for kml, doubled quotes for csv, none for txt', () => {
    const m = model();
    m.title = 'A & B "<c>"';
    expect(renderUserTemplate('{{title}}', 'kml', m)).toBe('A &amp; B &quot;&lt;c&gt;&quot;');
    expect(renderUserTemplate('{{title}}', 'csv', m)).toBe('A & B ""<c>""');
    expect(renderUserTemplate('{{title}}', 'txt', m)).toBe('A & B "<c>"');
  });

  it('restores the escaper after rendering (no leakage between formats)', () => {
    const m = model();
    m.title = '<x>';
    renderUserTemplate('{{title}}', 'kml', m); // XML escaper during this call
    expect(renderUserTemplate('{{title}}', 'txt', m)).toBe('<x>'); // txt unaffected afterwards
  });
});

describe('EXPORT_FORMATS built-in template sources', () => {
  it('each format ships a downloadable Mustache source and filename', () => {
    for (const f of EXPORT_FORMATS) {
      expect(f.source.length).toBeGreaterThan(0);
      expect(f.templateFilename.endsWith('.mustache')).toBe(true);
    }
  });

  it('the downloadable KML template re-renders to valid KML', () => {
    const kml = renderUserTemplate(EXPORT_FORMATS[0]!.source, 'kml', model());
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toContain('<coordinates>-105,40,1600</coordinates>');
    expect(kml).toContain('#flightPath');
    expect(kml.trimEnd().endsWith('</kml>')).toBe(true);
  });

  it('the downloadable GPX template re-renders a waypoint and track point', () => {
    const gpx = renderUserTemplate(EXPORT_FORMATS[1]!.source, 'gpx', model());
    expect(gpx).toContain('<wpt lat="40" lon="-105">');
    expect(gpx).toContain('<trkpt lat="40" lon="-105"><ele>1600</ele></trkpt>');
  });

  it('the downloadable waypoint-CSV template re-renders the header row', () => {
    const csv = renderUserTemplate(EXPORT_FORMATS[2]!.source, 'csv', model());
    expect(csv.split('\r\n')[0]).toBe('"altitude(m)","latitude","longitude","label","symbol","color","label_color","name"');
  });
});

describe('mimeForExtension', () => {
  it('maps known extensions and falls back to text/plain', () => {
    expect(mimeForExtension('kml')).toContain('google-earth');
    expect(mimeForExtension('gpx')).toContain('gpx');
    expect(mimeForExtension('csv')).toContain('csv');
    expect(mimeForExtension('weird')).toContain('text/plain');
  });
});
