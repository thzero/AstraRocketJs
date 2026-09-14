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
  resolveAltitudeReference,
  EXPORT_FALLBACK_LATITUDE,
  EXPORT_FALLBACK_LONGITUDE,
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

const model = () =>
  buildFlightPathModel(
    result,
    launch,
    { simName: 'Sim 1', rocketName: 'My <Rocket>', motorName: 'C6' },
    defaultExportOptions(),
    label,
  );

/** The same flight, staged, for the fields that only exist across branches. */
const staged = {
  ...result,
  branches: [
    { name: 'Sustainer', events: result.events, series: result.series },
    { name: 'Booster', events: result.events, series: result.series },
  ],
} as unknown as FlightResult;

/**
 * A booster that let go at t=1 — the moment the middle sample was taken. Its
 * series is a verbatim copy of the stack's, which is exactly what the real
 * engine hands over, so index 0 is the shared pad and index 1 is separation.
 */
const separated = {
  ...result,
  branches: [
    { name: 'Sustainer', events: result.events, series: result.series },
    {
      name: 'Booster',
      events: [...result.events, { type: 'STAGE_SEPARATION', time: 1.0 }],
      series: result.series,
    },
  ],
} as unknown as FlightResult;

const build = (res: FlightResult, over: Partial<ReturnType<typeof defaultExportOptions>> = {}, site = launch) =>
  buildFlightPathModel(
    res,
    site,
    { simName: 'Sim 1', rocketName: 'My <Rocket>', motorName: 'C6' },
    { ...defaultExportOptions(), ...over },
    label,
  );

/**
 * These fields exist so a Mustache template written for desktop OpenRocket
 * renders correctly here. Mustache resolves an unknown key to an empty string,
 * so a missing one is not an error — it is a KML with no colours and
 * coordinates that have lost their altitude. Hence the belt-and-braces checks.
 */
describe('desktop model parity', () => {
  it('gives each branch a palette colour and contiguous index', () => {
    const m = build(staged);
    expect(m.branches.map((b) => b.index)).toEqual([0, 1]);
    expect(m.branches[0]!.colorRgb).toBe('0072bd');
    expect(m.branches[1]!.colorRgb).toBe('d95319');
  });

  it('writes KML colours as aabbggrr, not the rgb it started from', () => {
    // KML orders the bytes backwards from hex web colours, which is exactly the
    // kind of thing that silently renders blue as red.
    const b = build(staged).branches[0]!;
    expect(b.pathColorKml).toBe('ffbd7200'); // opaque, 0072bd reversed
    expect(b.groundColorKml).toBe('d0553300'); // darkened, translucent
  });

  it('qualifies waypoint labels only when the flight actually staged', () => {
    const single = build(result).branches[0]!;
    const apogee = single.waypoints.find((w) => w.type === 'apogee')!;
    expect(apogee.qualifiedLabel).toBe(apogee.label);

    const both = build(staged);
    expect(both.branches[0]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Sustainer apogee');
    expect(both.branches[1]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Booster apogee');
  });

  it('names the branch on every waypoint', () => {
    const m = build(staged);
    expect(m.branches[1]!.waypoints.every((w) => w.branchName === 'Booster')).toBe(true);
  });

  it('resolves an automatic altitude reference from the launch altitude', () => {
    // A site left at 0 cannot be placed against sea level; a real one can.
    expect(resolveAltitudeReference('automatic', 0)).toBe('ground');
    expect(resolveAltitudeReference('automatic', 1600)).toBe('sealevel');
    expect(resolveAltitudeReference('automatic', NaN)).toBe('ground');
    expect(resolveAltitudeReference('ground', 1600)).toBe('ground'); // explicit wins
  });

  it('carries the KML altitude and its mode together', () => {
    // The pair has to agree: an altitude measured from the ground written into
    // a document that says "absolute" buries the track under the terrain.
    const sea = build(result, { altitudeReference: 'sealevel', waypointAltitudeReference: 'sealevel' });
    const apogee = sea.branches[0]!.waypoints.find((w) => w.type === 'apogee')!;
    expect(sea.kmlAltitudeMode).toBe('absolute');
    expect(apogee.altitudeAglMeters).toBeCloseTo(100, 6);
    expect(apogee.altitudeKmlMeters).toBeCloseTo(1700, 6); // 100 AGL + 1600 site

    const ground = build(result, { altitudeReference: 'ground', waypointAltitudeReference: 'ground' });
    const groundApogee = ground.branches[0]!.waypoints.find((w) => w.type === 'apogee')!;
    expect(ground.kmlAltitudeMode).toBe('relativeToGround');
    expect(groundApogee.altitudeKmlMeters).toBeCloseTo(100, 6);
  });

  it('gives path points the same two altitudes as waypoints', () => {
    const m = build(result, { altitudeReference: 'sealevel' });
    const peak = m.branches[0]!.path.find((pt) => pt.altitudeAglMeters === 100)!;
    expect(peak.altitudeKmlMeters).toBeCloseTo(1700, 6);
    expect(peak.altitudeMslMeters).toBeCloseTo(1700, 6);
  });

  it('passes the display toggles through for templates to gate on', () => {
    const m = build(result, { showWaypointLabels: false, colorWaypointPins: false });
    expect(m.showWaypointLabels).toBe(false);
    expect(m.colorWaypointPins).toBe(false);
  });

  it('leaves no model field empty that a template would render blank', () => {
    // The whole failure mode in one assertion: anything undefined here reaches
    // a template as "" and produces a broken file with no error.
    const m = build(staged);
    for (const [key, value] of Object.entries(m)) {
      expect(value, `model.${key}`).toBeDefined();
    }
    for (const b of m.branches) {
      for (const [key, value] of Object.entries(b)) expect(value, `branch.${key}`).toBeDefined();
      for (const w of b.waypoints) {
        for (const [key, value] of Object.entries(w)) expect(value, `waypoint.${key}`).toBeDefined();
      }
      for (const pt of b.path) {
        for (const [key, value] of Object.entries(pt)) expect(value, `pathPoint.${key}`).toBeDefined();
      }
    }
  });
});

describe('stage track start', () => {
  it('drops the ascent a booster only flew bolted to the sustainer', () => {
    const m = build(separated);
    const booster = m.branches[1]!;
    // Separation was at t=1, so the copied 0 s sample must not be in the track.
    expect(booster.path[0]!.time).toBeCloseTo(1, 6);
    expect(booster.path.some((pt) => pt.time === 0)).toBe(false);
    // …while the stack's own branch still starts on the pad.
    expect(m.branches[0]!.path[0]!.time).toBeCloseTo(0, 6);
  });

  it('keeps the whole track when asked to start every stage on the pad', () => {
    const m = build(separated, { stageTrackStart: 'pad' });
    expect(m.branches[1]!.path[0]!.time).toBeCloseTo(0, 6);
  });

  it('keeps the whole track for a branch that never recorded a separation', () => {
    // `staged` has no STAGE_SEPARATION event, so there is nothing to trim to
    // and trimming to a guessed point would silently lose real track.
    const m = build(staged);
    expect(m.branches[1]!.path[0]!.time).toBeCloseTo(0, 6);
  });

  it('gives the pad waypoint to the stack alone', () => {
    // Leaving the pad is something the whole vehicle does; one pin per stage
    // stacks duplicates on the same spot.
    const m = build(staged);
    expect(m.branches[0]!.waypoints.some((w) => w.type === 'pad')).toBe(true);
    expect(m.branches[1]!.waypoints.some((w) => w.type === 'pad')).toBe(false);
  });

  it("scans a booster's peak speed from separation, not from the pad", () => {
    // The stack's 50 m/s peak happens at t=1. A booster released at t=1 should
    // report the fastest thing IT did afterwards, not the stack's maximum.
    const slowAfter = {
      ...result,
      series: { ...result.series, velocity: [0, 50, 10] },
      branches: [
        { name: 'Sustainer', events: result.events, series: result.series },
        {
          name: 'Booster',
          events: [...result.events, { type: 'STAGE_SEPARATION', time: 2.0 }],
          series: result.series,
        },
      ],
    } as unknown as FlightResult;
    const booster = build(slowAfter).branches[1]!;
    const peak = booster.waypoints.find((w) => w.type === 'maxvelocity')!;
    expect(peak.time).toBeCloseTo(2, 6); // the last sample, after separation
  });
});

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

describe('launch position fallback', () => {
  const site = (lat: number, lon: number) => ({ ...launch, latitudeDeg: lat, longitudeDeg: lon }) as LaunchConditions;

  it('exports from the Kennedy Space Center only when both coordinates are zero', () => {
    const m = build(result, {}, site(0, 0));
    expect(m.launchLatitude).toBe(EXPORT_FALLBACK_LATITUDE);
    expect(m.launchLongitude).toBe(EXPORT_FALLBACK_LONGITUDE);
  });

  it('leaves a single zero alone -- the meridian and the equator are real places', () => {
    // Narrower than desktop OpenRocket, which relocates a site with a zero in
    // either coordinate. A launch site on the prime meridian is legitimate and
    // must not be moved to Florida.
    for (const [lat, lon] of [
      [40, -105],
      [51.48, 0],
      [0, -105],
    ] as const) {
      const m = build(result, {}, site(lat, lon));
      expect([m.launchLatitude, m.launchLongitude]).toEqual([lat, lon]);
    }
  });

  it('flags exactly the positions it substitutes', () => {
    expect(hasLaunchPosition(site(40, -105))).toBe(true);
    expect(hasLaunchPosition(site(51.48, 0))).toBe(true);
    expect(hasLaunchPosition(site(0, -105))).toBe(true);
    expect(hasLaunchPosition(site(0, 0))).toBe(false);
  });

  it('projects with WGS84 degree lengths, not a sphere', () => {
    // The last sample is 100 m east and 200 m north of the pad, so the degrees
    // it moved say what the projection thinks a degree is worth.
    const last = build(result, {}, site(40, -105)).branches[0]!.path.slice(-1)[0]!;
    const perDegreeLat = 200 / (last.latitude - 40);
    const perDegreeLon = 100 / (last.longitude + 105);

    // WGS84 at 40 deg N, to the centimetre.
    expect(perDegreeLat).toBeCloseTo(111034.6, 1);
    expect(perDegreeLon).toBeCloseTo(85393.94, 1);
    // A sphere of radius 6371 km would say 111194.93 and 85180.26 -- 160 m and
    // 214 m per degree out, enough to miss a launch field on a satellite image
    // and enough to disagree with the same flight exported from desktop.
    expect(Math.abs(perDegreeLat - 111194.93)).toBeGreaterThan(100);
    expect(Math.abs(perDegreeLon - 85180.26)).toBeGreaterThan(100);
  });
});

describe('track and waypoint altitude references', () => {
  it('resolves the two independently', () => {
    // The case this exists for: the flight suspended in the air where it belongs,
    // with its pins laid flat on the ground so you can read what they sit over.
    const m = build(result, { altitudeReference: 'sealevel', waypointAltitudeReference: 'clamped' });
    expect(m.kmlAltitudeMode).toBe('absolute');
    expect(m.kmlWaypointAltitudeMode).toBe('clampToGround');
    expect(m.branches[0]!.path[1]!.altitudeKmlMeters).toBeCloseTo(1700, 6); // MSL
    expect(m.branches[0]!.waypoints.find((w) => w.type === 'apogee')!.altitudeKmlMeters).toBeCloseTo(100, 6); // AGL
  });

  it('tessellates a clamped track, and only a clamped one', () => {
    // Without it a clamped line cuts straight through a hill rather than
    // draping over it, which is precisely what you are looking at the map for.
    expect(build(result, { altitudeReference: 'clamped' }).tessellatePath).toBe(true);
    expect(build(result, { altitudeReference: 'sealevel' }).tessellatePath).toBe(false);
  });

  it('drops the shadow for whichever half is already on the ground', () => {
    const both = build(result, { drawShadow: true, altitudeReference: 'ground', waypointAltitudeReference: 'ground' });
    expect([both.extrudePath, both.extrudeWaypoints]).toEqual([true, true]);

    // Nothing to extrude TO once a thing is lying on the terrain, and the two
    // halves are judged separately because they have separate references.
    const mixed = build(result, {
      drawShadow: true,
      altitudeReference: 'clamped',
      waypointAltitudeReference: 'sealevel',
    });
    expect([mixed.extrudePath, mixed.extrudeWaypoints]).toEqual([false, true]);

    const off = build(result, { drawShadow: false, altitudeReference: 'sealevel' });
    expect([off.extrudePath, off.extrudeWaypoints]).toEqual([false, false]);
  });
});

describe('renderKml', () => {
  const kml = renderKml(model());
  it('is well-formed KML with a document name and both track styles', () => {
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<kml')).toBe(true);
    expect(kml).toContain('<name>Sim 1</name>');
    expect(kml).toContain('id="flightPath0"');
    expect(kml).toContain('id="groundTrack0"');
    expect(kml.trimEnd().endsWith('</kml>')).toBe(true);
  });
  it('places the track in the altitude mode the model resolved', () => {
    // The bug this pins: a template that hardcodes `absolute` draws a flight
    // measured from a pad at 0 against SEA level, so at a launch site on real
    // terrain most of the rocket's altitude sits underneath the ground and only
    // the top of the flight is visible in Google Earth.
    const ground = renderKml(build(result, {}, { ...launch, launchAltitudeM: 0 } as LaunchConditions));
    expect(ground).toContain('<altitudeMode>relativeToGround</altitudeMode>');
    expect(ground).not.toContain('<altitudeMode>absolute</altitudeMode>');
    // ...while a site with a real elevation is placed absolutely, as before.
    expect(kml).toContain('<altitudeMode>absolute</altitudeMode>');
    expect(kml).not.toContain('<altitudeMode>relativeToGround</altitudeMode>');
    // The ground track is clamped either way - that is what makes it a ground
    // track - so its own mode must not follow the flight path's.
    expect(ground).toContain('<altitudeMode>clampToGround</altitudeMode>');
    expect(kml).toContain('<altitudeMode>clampToGround</altitudeMode>');
  });

  it('gives each stage its own styles, colours and qualified waypoint names', () => {
    const k = renderKml(build(staged));
    expect(k).toContain('id="flightPath0"');
    expect(k).toContain('id="flightPath1"');
    expect(k).toContain('<styleUrl>#waypoint1</styleUrl>');
    // Two stages, two different line colours - one hardcoded red for both is
    // what made a staged flight unreadable.
    const colors = [...k.matchAll(/<LineStyle><color>([0-9a-f]{8})</g)].map((m) => m[1]);
    expect(new Set(colors).size).toBeGreaterThan(1);
    // A pin reading "apogee" twice is ambiguous once there is more than one stage.
    expect(k).toContain('<name>Booster apogee</name>');
  });

  it('writes the two altitude modes into the halves they belong to', () => {
    const k = renderKml(build(result, { altitudeReference: 'sealevel', waypointAltitudeReference: 'clamped' }));
    const point = k.slice(k.indexOf('<Point>'), k.indexOf('</Point>'));
    const line = k.slice(k.indexOf('<LineString>'), k.indexOf('</LineString>'));
    expect(point).toContain('<altitudeMode>clampToGround</altitudeMode>');
    expect(line).toContain('<altitudeMode>absolute</altitudeMode>');
  });

  it('emits extrude as a section, so an older template is unaffected', () => {
    expect(kml).not.toContain('<extrude>'); // off by default, element omitted entirely
    const shadow = renderKml(build(result, { drawShadow: true, altitudeReference: 'sealevel' }));
    expect(shadow).toContain('<extrude>1</extrude>');
    // A value interpolation would have emitted `<extrude></extrude>` here, which
    // is junk; a Mustache section renders nothing at all.
    expect(shadow).not.toContain('<extrude></extrude>');
  });

  it('tessellates the flight-path line only when it is clamped', () => {
    const clamped = renderKml(build(result, { altitudeReference: 'clamped' }));
    const line = clamped.slice(clamped.indexOf('<LineString>'), clamped.indexOf('</LineString>'));
    expect(line).toContain('<tessellate>1</tessellate>');
    expect(line).toContain('<altitudeMode>clampToGround</altitudeMode>');
  });

  it('drops the pin icon when colour pins are turned off', () => {
    expect(kml).toContain('maps.google.com/mapfiles/kml/pushpin');
    expect(renderKml(build(result, { colorWaypointPins: false }))).not.toContain('maps.google.com');
  });

  it('hides waypoint names with a zero label scale, keeping the clickable pin', () => {
    expect(kml).not.toContain('<LabelStyle>');
    const quiet = renderKml(build(result, { showWaypointLabels: false }));
    expect(quiet).toContain('<LabelStyle><scale>0</scale></LabelStyle>');
    expect(quiet).toContain('<name>apogee</name>'); // still there to click
  });

  it('writes coordinates as lon,lat,alt', () => {
    // pad placemark → longitude first, then latitude, then MSL altitude
    expect(kml).toContain('<coordinates>-105,40,1600</coordinates>');
  });
  it('omits the flight-path line when disabled', () => {
    const opts = defaultExportOptions();
    opts.includeFlightPath = false;
    opts.includeGroundTrack = false;
    const k = renderKml(
      buildFlightPathModel(result, launch, { simName: 'S', rocketName: 'R', motorName: 'C6' }, opts, label),
    );
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

describe('renderUserTemplate (Mustache)', () => {
  it('renders a template using the desktop model field names', () => {
    const src =
      'Rocket: {{rocketName}} / Motor: {{motor}}\n{{#branches}}{{name}}: {{#waypoints}}[{{label}}]{{/waypoints}}{{/branches}}';
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
    expect(csv.split('\r\n')[0]).toBe(
      '"altitude(m)","latitude","longitude","label","symbol","color","label_color","name"',
    );
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
