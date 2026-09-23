import { describe, it, expect } from 'vitest';
import {
  buildFlightPathModel,
  defaultBranchColor,
  defaultGroundColor,
  defaultPinColor,
  defaultExportOptions,
  exportBranchNames,
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
  hexToRgbInt,
  type WaypointKind,
} from './flightPathExport';
import type { FlightResult } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import { localeTranslator } from '../testing/localeTranslator';

// A tiny two-branch-free flight: launch → drift 100 m east / 200 m north,
// climbing to 100 m AGL, with a couple of events.
const result = {
  summary: { maxAltitude: 100, maxVelocity: 50, maxAcceleration: 20, timeToApogee: 1, flightTime: 2 },
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

const label = localeTranslator(en);

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

/**
 * Out to 300 m and back to 50 m, so the farthest point and the landing point
 * are different numbers. A rocket that drifts downrange under the chute and
 * then partway back is the ordinary case, and reporting the landing distance
 * as the range understates the ground the flight actually covered.
 */
const driftBack = {
  summary: { maxAltitude: 100, maxVelocity: 50, maxAcceleration: 20, timeToApogee: 1, flightTime: 3 },
  series: {
    time: [0, 1, 2, 3],
    altitude: [0, 100, 50, 0],
    velocity: [0, 50, 10, 5],
    acceleration: [20, 5, -2, -9.8],
    Px: [0, 0, 0, 0],
    Py: [0, 150, 300, 50],
  },
  events: [
    { type: 'LIFTOFF', time: 0 },
    { type: 'APOGEE', time: 1 },
    { type: 'GROUND_HIT', time: 3 },
  ],
} as unknown as FlightResult;

/**
 * A run that ended while the rocket was still in the air — what OpenRocket's
 * `BasicEventSimulationEngine` produces when it reaches the maximum simulation
 * time, and (with no events at all) when a run is aborted before a motor fires.
 */
const neverLanded = {
  ...result,
  events: [
    { type: 'LIFTOFF', time: 0.0 },
    { type: 'APOGEE', time: 1.0 },
  ],
} as unknown as FlightResult;

/**
 * A rendered KML with its balloon markup taken back out, so an assertion reads
 * like the balloon Google Earth draws rather than like the escaped source.
 *
 * The markup itself is checked once, on its own, rather than repeated into
 * every assertion that happens to sit near a label.
 */
const asBalloonText = (kml: string): string => kml.replace(/&lt;\/?b&gt;/g, '').replace(/&lt;br\/&gt;/g, '\n');

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
 * so a missing one is not an error — it is a KML with no colors and
 * coordinates that have lost their altitude. Hence the belt-and-braces checks.
 */
/**
 * `hexToRgbInt` is what turns the branch color picker into an exported KML
 * color, and it had no test at all - its renamed twin `hexToRgbTuple` in
 * `reportPdf` has a full block covering bad input, and this one had nothing.
 * They used to share the name `hexToRgb`.
 */
describe('hexToRgbInt', () => {
  it('packs #rrggbb into one 0xRRGGBB integer', () => {
    expect(hexToRgbInt('#ff8800')).toBe(0xff8800);
    expect(hexToRgbInt('ff8800')).toBe(0xff8800); // the hash is optional
    expect(hexToRgbInt('#000000')).toBe(0);
    expect(hexToRgbInt('#FFFFFF')).toBe(0xffffff);
  });

  it('reads unparseable input as black rather than NaN', () => {
    // A NaN here would reach `hex2` and render `NaN` into the KML color
    // literal, which Google Earth rejects for the whole placemark.
    for (const bad of ['', '#', 'rebeccapurple', '#zzzzzz', '  ']) {
      expect(hexToRgbInt(bad), `hexToRgbInt(${JSON.stringify(bad)})`).toBe(0);
    }
  });

  it('masks off anything above the low 24 bits', () => {
    // An 8-digit value (a #rrggbbaa from some other picker) must not leak its
    // alpha into the packed RGB - KML carries alpha as a separate leading byte.
    expect(hexToRgbInt('#ff8800cc')).toBe(0x8800cc);
  });

  it('does NOT expand 3-digit shorthand', () => {
    // Recorded rather than endorsed: unlike `hexToRgbTuple`, which rejects a
    // 3-digit value outright, this parses `#f80` as 0x000f80. The only caller
    // is an `<input type="color">`, which always hands over six digits, so
    // nothing reaches it - but the two functions differ here and a future
    // caller should know it.
    expect(hexToRgbInt('#f80')).toBe(0xf80);
  });
});

describe('desktop model parity', () => {
  it('gives each branch a palette color and contiguous index', () => {
    const m = build(staged);
    expect(m.branches.map((b) => b.index)).toEqual([0, 1]);
    expect(m.branches[0]!.colorRgb).toBe('0072bd');
    expect(m.branches[1]!.colorRgb).toBe('d95319');
  });

  it('writes KML colors as aabbggrr, not the rgb it started from', () => {
    // KML orders the bytes backwards from hex web colors, which is exactly the
    // kind of thing that silently renders blue as red.
    const b = build(staged).branches[0]!;
    expect(b.pathColorKml).toBe('ffbd7200'); // 0072bd reversed
    expect(b.groundColorKml).toBe('ff552dff'); // ff2d55 reversed
    expect(b.pinColorKml).toBe('ffbd7200'); // pin defaults to the path color
  });

  it('renders every color opaque, whether defaulted or picked', () => {
    // Alpha used to depend on HOW the color was obtained: the derived ground
    // shade was drawn at 0xd0 and a picked one at 0xff, so choosing exactly the
    // default gave a different result from leaving it alone. A color is a
    // value, not a value plus a provenance flag.
    const defaulted = build(staged).branches[0]!;
    const picked = build(staged, {
      branchGroundColors: new Map([[0, 0xff2d55]]), // the default, chosen explicitly
    }).branches[0]!;
    expect(picked.groundColorKml).toBe(defaulted.groundColorKml);
    for (const c of [defaulted.pathColorKml, defaulted.groundColorKml, defaulted.pinColorKml]) {
      expect(c.slice(0, 2)).toBe('ff');
    }
  });

  it('qualifies waypoint labels only when the flight actually staged', () => {
    const single = build(result).branches[0]!;
    const apogee = single.waypoints.find((w) => w.type === 'apogee')!;
    expect(apogee.qualifiedLabel).toBe(apogee.label);

    const both = build(staged);
    expect(both.branches[0]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Sustainer Apogee');
    expect(both.branches[1]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Booster Apogee');
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

/**
 * Several exports opened in one Google Earth session are otherwise
 * indistinguishable: every two-stage design contributes a folder called
 * "Sustainer" and a track called "Sustainer flight path", and two designs can
 * each own a "Simulation 1".
 */
describe('mission name', () => {
  it('names the document, the folders and the tracks, but not the markers', () => {
    const m = build(staged, { missionName: 'Sod Blaster' });
    expect(m.title).toBe('Sod Blaster Sim 1');
    expect(m.branches.map((b) => b.name)).toEqual(['Sod Blaster Sustainer', 'Sod Blaster Booster']);
    // The KML builds " flight path" / " ground track" off the folder name, so
    // naming the branch names the tracks too.
    expect(renderKml(m)).toContain('<name>Sod Blaster Sustainer flight path</name>');
    // The markers stay short: this is the opt-in half, and it was not opted in.
    expect(m.branches[0]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Sustainer Apogee');
  });

  it('reaches the markers only when asked to', () => {
    const m = build(staged, { missionName: 'Sod Blaster', labelWaypointsWithMission: true });
    const apogee = m.branches[0]!.waypoints.find((w) => w.type === 'apogee')!;
    // Qualified first, then prefixed: the stage stays next to the event.
    expect(apogee.qualifiedLabel).toBe('Sod Blaster Sustainer Apogee');
    // The unqualified label is what the GPX and the CSV carry, and is untouched.
    expect(apogee.label).toBe('Apogee');
  });

  it('does not double a mission the name already leads with', () => {
    // The obvious thing to type is the name of the thing you flew, which is
    // also what the branch is called. Without the guard: "Sustainer Sustainer".
    const m = build(staged, { missionName: 'Sustainer', labelWaypointsWithMission: true });
    expect(m.branches[0]!.name).toBe('Sustainer');
    expect(m.branches[0]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Sustainer Apogee');
    // Case is not part of the question a reader is asking.
    expect(build(staged, { missionName: 'sustainer' }).branches[0]!.name).toBe('Sustainer');
  });

  it('leaves every name exactly as it was when there is no mission', () => {
    const m = build(staged);
    expect(m.title).toBe('Sim 1');
    expect(m.branches.map((b) => b.name)).toEqual(['Sustainer', 'Booster']);
    expect(m.branches[1]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Booster Apogee');
  });

  it('treats a blank mission as no mission, not as a leading space', () => {
    const m = build(staged, { missionName: '   ', labelWaypointsWithMission: true });
    expect(m.title).toBe('Sim 1');
    expect(m.branches[0]!.name).toBe('Sustainer');
    expect(m.branches[0]!.waypoints.find((w) => w.type === 'apogee')!.qualifiedLabel).toBe('Sustainer Apogee');
    // And a name with slack around it still reads as the name.
    expect(build(staged, { missionName: '  Sod Blaster  ' }).title).toBe('Sod Blaster Sim 1');
  });
});

describe('stage colors', () => {
  it('indexes the palette with a floor-mod, so any stage count works', () => {
    expect(defaultBranchColor(0)).toBe(0x0072bd);
    expect(defaultBranchColor(10)).toBe(0x0072bd); // wraps rather than running out
    expect(defaultBranchColor(-1)).toBe(0x556b2f); // and cannot reach off the front
  });

  it('lets an override replace one stage and leaves the rest on the palette', () => {
    const m = build(staged, { branchColors: new Map([[1, 0x112233]]) });
    expect(m.branches[0]!.colorRgb).toBe('0072bd'); // untouched
    expect(m.branches[1]!.colorRgb).toBe('112233');
  });

  it('a stage path color can be set on its own', () => {
    // The point of the whole design: setting one role leaves the others on
    // THEIR defaults rather than dragging them along.
    const b = build(staged, { branchColors: new Map([[0, 0x112233]]) }).branches[0]!;
    expect(b.pathColorKml).toBe('ff332211'); // KML is aabbggrr, so 112233 -> ff332211
    expect(b.groundColorKml).toBe('ff552dff'); // still the ground palette
    expect(b.pinColorKml).toBe('ffbd7200'); // still the pin default
  });

  it('a stage ground-track color can be set on its own', () => {
    const b = build(staged, { branchGroundColors: new Map([[0, 0x112233]]) }).branches[0]!;
    expect(b.groundColorKml).toBe('ff332211');
    expect(b.pathColorKml).toBe('ffbd7200'); // untouched
    expect(b.pinColorKml).toBe('ffbd7200');
  });

  it('a stage pin color can be set on its own', () => {
    const b = build(staged, { branchPinColors: new Map([[0, 0x112233]]) }).branches[0]!;
    expect(b.pinColorKml).toBe('ff332211');
    expect(b.pathColorKml).toBe('ffbd7200'); // neither track moves
    expect(b.groundColorKml).toBe('ff552dff');
  });

  it('a stage can carry three independent colors at once', () => {
    const b = build(staged, {
      branchColors: new Map([[0, 0x112233]]),
      branchGroundColors: new Map([[0, 0x445566]]),
      branchPinColors: new Map([[0, 0x778899]]),
    }).branches[0]!;
    expect(b.colorRgb).toBe('112233');
    expect(b.groundColorRgb).toBe('445566');
    expect(b.pinColorRgb).toBe('778899');
    expect(b.pathColorKml).toBe('ff332211');
    expect(b.groundColorKml).toBe('ff665544');
    expect(b.pinColorKml).toBe('ff998877');
  });

  it('each color lands on its own KML element', () => {
    // Assert on the RENDERED bytes, with the surrounding <Style id> included.
    // The model can be right while the template wires the wrong field into the
    // wrong element - and the pin used to share the path's token, so a careless
    // find-and-replace repaints the flight path.
    const kml = renderKml(
      build(staged, {
        branchColors: new Map([[0, 0x112233]]),
        branchGroundColors: new Map([[0, 0x445566]]),
        branchPinColors: new Map([[0, 0x778899]]),
      }),
    );
    expect(kml).toContain('<Style id="flightPath0"><LineStyle><color>ff332211</color>');
    expect(kml).toContain('<Style id="groundTrack0"><LineStyle><color>ff665544</color>');
    // The pin, structurally: the color inside the waypoint style's
    // IconStyle, which is the element that used to carry the path's token.
    const iconStyle = /<Style id="waypoint0">[\s\S]*?<IconStyle>\s*<color>([0-9a-f]{8})<\/color>/.exec(kml);
    expect(iconStyle?.[1]).toBe('ff998877');
    // ...and the flight-path line still has its own, unchanged by the pin.
    expect(kml).toContain('<Style id="flightPath0"><LineStyle><color>ff332211</color>');
  });

  it('the ground palette contrasts with the path palette per stage', () => {
    // A ground track sits under its flight path from overhead, so entry i of
    // one palette must not look like entry i of the other.
    for (let i = 0; i < 10; i++) {
      expect(defaultGroundColor(i)).not.toBe(defaultBranchColor(i));
    }
    expect(defaultGroundColor(0)).toBe(0xff2d55);
    expect(defaultGroundColor(10)).toBe(0xff2d55); // wraps
    expect(defaultGroundColor(-1)).toBe(0xe74c3c); // and cannot reach off the front
    expect(defaultPinColor(3)).toBe(defaultBranchColor(3)); // pins follow the path DEFAULT
  });

  it('offers the color picker exactly the branches the model will number', () => {
    // The picker keys its swatches by index, so a disagreement here would paint
    // a stage the color of the one beside it.
    const meta = { simName: 'Sim 1', rocketName: 'My <Rocket>', motorName: 'C6' };
    expect(exportBranchNames(staged, meta)).toEqual(build(staged).branches.map((b) => b.name));
    expect(exportBranchNames(result, meta)).toEqual(['My <Rocket>']);
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
    // the recovery label is the event word, qualified by the device
    expect(w.find((x) => x.type === 'recovery')!.label).toBe('Main chute Ejection');
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

    // WGS84 at 40 deg N, to the centimeter.
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

  it('gives each stage its own styles, colors and qualified waypoint names', () => {
    const k = renderKml(build(staged));
    expect(k).toContain('id="flightPath0"');
    expect(k).toContain('id="flightPath1"');
    expect(k).toContain('<styleUrl>#waypoint1</styleUrl>');
    // Two stages, two different line colors - one hardcoded red for both is
    // what made a staged flight unreadable.
    const colors = [...k.matchAll(/<LineStyle><color>([0-9a-f]{8})</g)].map((m) => m[1]);
    expect(new Set(colors).size).toBeGreaterThan(1);
    // A pin reading "Apogee" twice is ambiguous once there is more than one stage.
    expect(k).toContain('<name>Booster Apogee</name>');
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

  it('drops the pin icon when color pins are turned off', () => {
    expect(kml).toContain('maps.google.com/mapfiles/kml/pushpin');
    expect(renderKml(build(result, { colorWaypointPins: false }))).not.toContain('maps.google.com');
  });

  it('hides waypoint names with a zero label scale, keeping the clickable pin', () => {
    expect(kml).not.toContain('<LabelStyle>');
    const quiet = renderKml(build(result, { showWaypointLabels: false }));
    expect(quiet).toContain('<LabelStyle><scale>0</scale></LabelStyle>');
    expect(quiet).toContain('<name>Apogee</name>'); // still there to click
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

describe('flight summary', () => {
  it('carries the whole-flight numbers the balloons report', () => {
    const m = model();
    expect(m.maxAltitude).toBe('100.0');
    expect(m.maxRange).toBe('223.6'); // hypot(100, 200) at the last sample
    expect(m.timeToApogee).toBe('1.0');
    expect(m.flightTime).toBe('2.0');
    // The two peaks are SI whatever the distance unit is, and until now nothing
    // in the model said so.
    expect([m.velocityUnit, m.accelerationUnit]).toEqual(['m/s', 'm/s²']);
    expect([m.launchLatitudeStr, m.launchLongitudeStr]).toEqual(['40.000000', '-105.000000']);
    expect(m.launchAltitude).toBe('1600.0');
  });

  it('reports where and when each stage came down', () => {
    const branch = build(driftBack).branches[0]!;
    expect(branch.hasLanding).toBe(true);
    expect(branch.landingDistance).toBe('50.0');
    expect(branch.landingBearing).toBe('0'); // due north
    expect(branch.landingTime).toBe('3.0');
    // Six decimals, like every other coordinate in the file - about 10 cm, and
    // the same string whatever the magnitude of the number.
    expect(branch.landingLatitudeStr).toBe('40.000450');
    expect(branch.landingLongitudeStr).toBe('-105.000000');
  });

  it('reports the FARTHEST point as the range, not the landing point', () => {
    // The whole reason both numbers are exported: a chute drifts the rocket out
    // and partway back, and the range-safety figure is the excursion.
    const m = build(driftBack);
    expect(m.branches[0]!.maxRangeMeters).toBeCloseTo(300, 6);
    expect(m.maxRange).toBe('300.0');
    expect(m.branches[0]!.landingDistance).toBe('50.0');
  });

  it('scans a separated stage range over the WHOLE branch', () => {
    // Unlike the peak-velocity waypoint, which starts at separation so a spent
    // booster reports its own peak. A range is a claim about where that
    // airframe WENT, and it went wherever the stack took it.
    const m = build(separated);
    expect(m.branches[1]!.maxRangeMeters).toBeCloseTo(m.branches[0]!.maxRangeMeters, 6);
  });

  it('reports no landing for a flight that never hit the ground', () => {
    const branch = build(neverLanded).branches[0]!;
    expect(branch.hasLanding).toBe(false);
    expect([branch.landingDistance, branch.landingBearing, branch.landingTime]).toEqual(['', '', '']);
    expect([branch.landingLatitudeStr, branch.landingLongitudeStr]).toEqual(['', '']);
    // ...and the balloons lose those lines rather than inventing a touchdown at
    // the altitude the rocket was still flying at.
    const kml = renderKml(build(neverLanded));
    expect(kml).not.toContain('Landing:');
    expect(kml).not.toContain('Landing coordinates:');
    expect(kml).not.toContain(' landing: ');
    expect(kml).toContain('Max range:'); // the rest of the balloon survives
  });

  it('finds the landing even when the landing waypoint is switched off', () => {
    // The summary is scanned from the branch events, not read back out of the
    // generated waypoints, so turning the marker off cannot blind it.
    const m = build(driftBack, { waypoints: new Set<WaypointKind>(['apogee']) });
    expect(m.branches[0]!.hasLanding).toBe(true);
    expect(m.branches[0]!.landingDistance).toBe('50.0');
  });
});

describe('kernel component names', () => {
  /**
   * A parachute the user never renamed. The TeaVM kernel carries no resource
   * bundles, so `getName()` falls through to `getComponentName()`, which is
   * itself a bundle lookup - and the bare `DebugTranslator` the engine wires in
   * returns the key in brackets. The name reaches us as `[Parachute.Parachute]`.
   */
  const unnamed = {
    ...result,
    events: [
      { type: 'LIFTOFF', time: 0.0 },
      { type: 'APOGEE', time: 1.0 },
      { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 1.0, source: '[Parachute.Parachute]' },
      { type: 'GROUND_HIT', time: 2.0 },
    ],
  } as unknown as FlightResult;

  it('never writes a bundle key where a component name belongs', () => {
    const m = build(unnamed);
    const recovery = m.branches[0]!.waypoints.find((w) => w.type === 'recovery')!;
    expect(recovery.device).toBe('Parachute');

    const kml = renderKml(m);
    expect(kml).not.toContain('[Parachute.Parachute]');
    expect(asBalloonText(kml)).toContain('Device: Parachute');
  });

  it('names an unnamed device pin for the EVENT alone', () => {
    // A default name says nothing the balloon's device line does not, so it
    // earns no room in the pin's name.
    const m = build(unnamed);
    expect(m.branches[0]!.waypoints.find((w) => w.type === 'recovery')!.label).toBe('Ejection');
    expect(renderKml(m)).toContain('<name>Ejection</name>');
  });

  it('qualifies the event word with a device the user named', () => {
    // Not the device alone, which drops the event vocabulary every other pin
    // uses, and not the event alone, which makes a dual-deployment flight two
    // identical pins.
    const dual = {
      ...result,
      events: [
        { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 1.0, source: 'Drogue' },
        { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 2.0, source: 'Main' },
      ],
    } as unknown as FlightResult;
    const m = build(dual);
    // In time order, which is the order they happened and the order the pins
    // are written in.
    expect(m.branches[0]!.waypoints.filter((w) => w.type === 'recovery').map((w) => w.label)).toEqual([
      'Drogue Ejection',
      'Main Ejection',
    ]);
    const kml = renderKml(m);
    expect(kml).toContain('<name>Drogue Ejection</name>');
    expect(kml).toContain('<name>Main Ejection</name>');
    // The device never names a pin on its own - the event word always carries.
    expect(kml).not.toContain('<name>Drogue</name>');
    expect(kml).not.toContain('<name>Main</name>');
  });

  it('yields a plain Ejection when no component raised the deployment', () => {
    // An event with no source at all, which is not the same as one carrying the
    // kernel's default name: there is nothing to qualify with and nothing for
    // the balloon's Device line, so that line goes too.
    const m = build({
      ...result,
      events: [{ type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 1.0 }],
    } as unknown as FlightResult);
    const recovery = m.branches[0]!.waypoints.find((w) => w.type === 'recovery')!;
    expect(recovery.label).toBe('Ejection');
    expect(recovery.device).toBe('');
    expect(asBalloonText(renderKml(m))).not.toContain('Device:');
  });

  it('does not double a device already named for the event', () => {
    // The stage qualifier's own guard, inherited: it drops the qualifier when
    // the LABEL already starts with it, so a device called "Ejection" gives one
    // word rather than two. It is that direction only - a device called
    // "Ejection charge" still qualifies to "Ejection charge Ejection", which is
    // silly but is not a name anybody gives a parachute, and widening the guard
    // would change how stage names qualify too.
    const named = (source: string) =>
      build({
        ...result,
        events: [{ type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 1.0, source }],
      } as unknown as FlightResult).branches[0]!.waypoints.find((w) => w.type === 'recovery')!.label;
    expect(named('Ejection')).toBe('Ejection');
    expect(named('Drogue')).toBe('Drogue Ejection');
  });

  it('stacks the stage and the device on a staged flight', () => {
    const staged2 = (source: string) =>
      build({
        ...result,
        branches: [
          { name: 'Sustainer', events: [], series: result.series },
          {
            name: 'Booster',
            events: [{ type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 1.0, source }],
            series: result.series,
          },
        ],
      } as unknown as FlightResult).branches[1]!.waypoints.find((w) => w.type === 'recovery')!.qualifiedLabel;

    // Long, and exactly what that pin is.
    expect(staged2('Drogue')).toBe('Booster Drogue Ejection');
    // ...and the guard survives the stacking: a chute the user actually called
    // "Booster Chute" must not come out "Booster Booster Chute Ejection". The
    // stage prefix is dropped because the name it would prefix already leads
    // with it.
    expect(staged2('Booster Chute')).toBe('Booster Chute Ejection');
  });

  it('names the device in the EXPORT language, not the app language', () => {
    // It used to be the one English word among translated pin names, because
    // the de-bracketing produced a humanized key rather than a translation.
    const kml = renderKml(
      buildFlightPathModel(
        unnamed,
        launch,
        { simName: 'Sim 1', rocketName: 'R', motorName: 'C6' },
        defaultExportOptions(),
        localeTranslator(es),
      ),
    );
    expect(kml).toContain(`<name>${es.pathExport.wp.recovery}</name>`); // the event, translated
    expect(asBalloonText(kml)).toContain(`${es.pathExport.doc.device}: ${es.part.parachute}`);
    expect(kml).not.toContain('Parachute');
  });

  it('leaves a name the user actually typed alone', () => {
    // Only the bracket form is a key. Everything else is somebody's name for
    // their own part, and rewriting it would be the worse bug.
    const m = build(result);
    const recovery = m.branches[0]!.waypoints.find((w) => w.type === 'recovery')!;
    expect(recovery.device).toBe('Main chute');
  });
});

describe('export language', () => {
  /**
   * Expectations are read OUT of the Spanish bundle rather than written into
   * this file. It keeps the test about the wiring - did the export take its
   * strings from the language it was handed, and compose them in that
   * language's word order - rather than about the wording, which a translator
   * should be free to improve without breaking a test.
   */
  const esDoc = es.pathExport.doc;
  const fill = (template: string, vars: Record<string, string>): string =>
    template.replace(/{{(\w+)}}/g, (_m, name: string) => vars[name] ?? '');

  const spanish = () =>
    renderKml(
      buildFlightPathModel(
        result,
        launch,
        { simName: 'Sim 1', rocketName: 'My <Rocket>', motorName: 'C6' },
        defaultExportOptions(),
        localeTranslator(es),
      ),
    );

  it('writes every string in the file, not just the waypoint names', () => {
    // The point of the override. Translating the eight pin names and leaving
    // the balloons and the track names in English is not a language choice.
    const k = asBalloonText(spanish());
    expect(k).toContain(`<name>${es.pathExport.wp.apogee}</name>`); // waypoint
    expect(k).toContain(`${esDoc.flightPath}</name>`); // track names
    expect(k).toContain(`${esDoc.groundTrack}</name>`);
    expect(k).toContain(`${esDoc.maxAltitude}: 100.0 m`); // document balloon
    expect(k).toContain(`${esDoc.maxRange}: 223.6 m ${esDoc.fromThePad}`); // folder balloon
    expect(k).toContain(`${esDoc.coordinates}: 40.000901, -104.999414`); // waypoint balloon
    expect(k).toContain(`${esDoc.device}: Main chute`);
    // ...and nothing of the English is left behind.
    expect(k).not.toContain('Max altitude');
    expect(k).not.toContain('flight path</name>');
  });

  it('puts the stage name where the language puts it', () => {
    // English hangs it in front ("Sustainer landing"); Spanish puts it after
    // the noun. A template gluing `{{name}}` onto a translated word could only
    // ever produce English word order, which is why this one is composed
    // through `t()` instead.
    expect(asBalloonText(spanish())).toContain(`${fill(esDoc.stageLanding, { stage: 'My &lt;Rocket&gt;' })}:`);
    expect(asBalloonText(renderKml(model()))).toContain('My &lt;Rocket&gt; landing:');
  });

  it('orders a distance and a bearing the way the language does', () => {
    const expected = fill(esDoc.distanceBearing, { distance: '223.6', unit: 'm', bearing: '27' });
    expect(spanish()).toContain(expected);
    expect(renderKml(model())).toContain('223.6 m at 27\u00b0');
  });

  it('leaves the numbers and the geometry alone', () => {
    // Only the words are translated. A coordinate is not a word, and a reader
    // in either language opens the same flight.
    const k = spanish();
    expect(k).toContain('<coordinates>-105,40,1600</coordinates>');
    expect(k).toContain('<altitudeMode>absolute</altitudeMode>');
    expect(k).toContain('id="flightPath0"');
  });
});

describe('KML summary balloons', () => {
  const kml = renderKml(model());

  it('bolds every label, and leaves no line without one', () => {
    // A balloon is a list of one-line facts, and a wall of same-weight text is
    // not scannable. The label is bold and the value is not, including on the
    // time line - which was the one line with no label at all.
    expect(kml).toContain('&lt;b&gt;Max altitude:&lt;/b&gt; 100.0');
    expect(kml).toContain('&lt;b&gt;Time:&lt;/b&gt; T+');
    // Every line of every balloon: as many bold runs as there are lines.
    for (const [, body] of kml.matchAll(/<description>([\s\S]*?)<\/description>/g)) {
      const lines = body!.split('&lt;br/&gt;').filter((l) => l.trim());
      expect(lines.length).toBe(body!.split('&lt;b&gt;').length - 1);
    }
  });

  it('puts the flight summary on the document', () => {
    const doc = asBalloonText(kml.slice(0, kml.indexOf('<Style')));
    expect(doc).toContain('Configuration: C6');
    // A labeled pair. Nothing in a bare `40.000000, -105.000000` says which is
    // which, and KML's own coordinate triples are lon,lat,alt - so a reader who
    // knows the format has an active reason to read it backwards, and at a real
    // launch site both readings are plausible.
    expect(doc).toContain('Launch site: 40.000000, -105.000000 (lat, lon), 1600.0 m above sea level');
    expect(doc).toContain('Max altitude: 100.0 m');
    expect(doc).toContain('Max velocity: 50.0 m/s');
    expect(doc).toContain('Max acceleration: 20.0 m/s²');
    // The range keeps its origin, like the bearings do.
    expect(doc).toContain('Max range: 223.6 m from the pad');
    expect(doc).toContain('Time to apogee: 1.0 s');
    expect(doc).toContain('Flight time: 2.0 s');
    expect(doc).toContain('Rocket: My &lt;Rocket&gt;'); // labeled, like every other line
    // The landing leads with the coordinate: a distance and a bearing read the
    // map, but they do not walk you to the rocket. Semicolons between the
    // clauses, because the coordinate carries a comma of its own and an
    // all-comma line reads as one run-on group. The bearing keeps its origin:
    // a bare angle beside a coordinate can be read as a heading of travel.
    expect(doc).toContain('landing: 40.001801, -104.998829 (lat, lon); 223.6 m at 27° from the pad; T+2.0 s');
  });

  it('puts the range and the landing on the stage folder', () => {
    const folder = asBalloonText(kml.slice(kml.indexOf('<Folder>'), kml.indexOf('<Placemark>')));
    // No line repeating the folder's own name back at the reader: Google Earth
    // prints it above the balloon already.
    expect(folder).not.toContain('Stage:');
    expect(folder).toContain('Max range: 223.6 m from the pad');
    // The same fact presented the same way as in the document summary: leading
    // with the coordinate, on one line. A separate "Landing coordinates" line
    // demoted the very thing the document leads on, and gave one file two
    // presentations of one fact.
    expect(folder).toContain('Landing: 40.001801, -104.998829 (lat, lon); 223.6 m at 27° from the pad; T+2.0 s');
  });

  it('puts the point own numbers on each waypoint', () => {
    const at = kml.indexOf('<name>Apogee</name>');
    const apogee = asBalloonText(kml.slice(at, kml.indexOf('</Placemark>', at)));
    // One notation AND one precision for one quantity: the landing lines say
    // T+2.0 s, so a waypoint must not say T+1.00 s.
    expect(apogee).toContain('Time: T+1.0 s');
    expect(apogee).not.toContain('T+1.00 s');
    // One label, two references: the same word twice down two lines was the
    // duplication a bold label makes obvious.
    expect(apogee).toContain('Altitude: 100.0 m above the pad, 1700.0 m above sea level');
    expect(apogee).toContain('Position: 111.8 m at 27° from the pad');
    expect(apogee).toContain('Coordinates: 40.000901, -104.999414 (lat, lon)');
    // Only an ejection names a device; every other pin loses the line.
    expect(apogee).not.toContain('Device:');
    expect(asBalloonText(kml)).toContain('Device: Main chute');
  });

  it('gives every described feature an empty Snippet, before the description', () => {
    // Without it Google Earth prints the first lines of the description under
    // the feature name in the Places tree, turning the waypoint list into a
    // wall of text. KML fixes the order: name, Snippet, description, styleUrl.
    expect(kml.split('<Snippet></Snippet>').length).toBe(kml.split('<description>').length);
    for (const [, between] of kml.matchAll(/<Snippet><\/Snippet>([\s\S]*?)<description>/g)) {
      expect(between!.trim()).toBe('');
    }
  });

  it('shows the range and the landing as the different numbers they are', () => {
    // The default fixture flies straight out, so its range and its landing
    // distance are the same 223.6 m and the balloon states one number twice.
    // Correct, but it does not exercise the distinction the two figures exist
    // for. This one drifts out to 300 m and comes back to 50 m.
    const k = renderKml(build(driftBack));
    const doc = asBalloonText(k.slice(0, k.indexOf('<Style')));
    expect(doc).toContain('Max range: 300.0 m from the pad');
    expect(doc).toContain('(lat, lon); 50.0 m at 0° from the pad; T+3.0 s');
  });

  it('leaves the sea-level lines out when the site has no altitude', () => {
    // OpenRocket's launch altitude defaults to 0. Reporting a height "above sea
    // level" that is really a height above the pad is the exact error the
    // automatic altitude reference already exists to prevent.
    const k = asBalloonText(renderKml(build(result, {}, { ...launch, launchAltitudeM: 0 } as LaunchConditions)));
    expect(k).not.toContain('above sea level');
    expect(k).toContain('Launch site: 40.000000, -105.000000 (lat, lon)\n'); // no elevation clause
    expect(k).toContain('above the pad'); // the height that IS known survives
  });

  it('leaves the configuration line out when there is no named configuration', () => {
    const m = model();
    m.configuration = '';
    expect(renderKml(m)).not.toContain('Configuration:');
  });

  it('writes no descriptions at all when they are switched off', () => {
    const k = renderKml(build(result, { includeDescriptions: false }));
    expect(k).not.toContain('<description>');
    expect(k).not.toContain('<Snippet>');
    // ...and it is otherwise the same file.
    expect(k).toContain('<coordinates>-105,40,1600</coordinates>');
    expect(k).toContain('<name>Apogee</name>');
    expect(k).toContain('id="flightPath0"');
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
    expect(out).toContain('[Apogee]');
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
