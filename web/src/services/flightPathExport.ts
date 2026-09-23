import Mustache from 'mustache';
import type { FlightResult, FlightEvent, FlightSeries } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import { componentName, isDefaultComponentName } from './warningText';

/**
 * Templated flight-path export — a TypeScript port of OpenRocket's
 * `info.openrocket.core.file.flightpath` subsystem (KML / GPX / waypoint CSV).
 *
 * The desktop version reads latitude/longitude straight from the simulated
 * flight (OpenRocket derives them from the launch position during the run). Our
 * engine ships only the lateral drift (`Px` east, `Py` north, meters from the
 * pad) in the default flight series — the same trajectory the 3D path view
 * draws — so we project those onto geographic coordinates here, about the
 * configured launch site, using a spherical Earth (OpenRocket's default
 * geodetic model). MSL altitude is the AGL altitude plus the launch altitude.
 *
 * A {@link FlightPathModel} is built once, then rendered by the chosen format.
 * The three built-in renderers reproduce the reference Mustache templates.
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** The single-point waypoints that can be emitted for each flight branch. */
export type WaypointKind =
  'pad' | 'liftoff' | 'burnout' | 'apogee' | 'recovery' | 'landing' | 'maxvelocity' | 'maxacceleration';

/** Waypoint kinds in display/emit order (matches the reference enum). */
export const WAYPOINT_KINDS: WaypointKind[] = [
  'pad',
  'liftoff',
  'burnout',
  'apogee',
  'recovery',
  'landing',
  'maxvelocity',
  'maxacceleration',
];

/** Distance units offered for the human-facing altitude/distance columns. */
export type DistanceUnit = 'm' | 'ft' | 'km' | 'mi';

/**
 * A translator, in the shape `i18next` already hands out.
 *
 * The export takes ONE of these rather than a per-waypoint label callback,
 * because the file's language is a property of the file: the caller binds this
 * to the export language and every string in the output follows, from the
 * waypoint names to the balloon labels. A caller that wants the app's language
 * passes the app's `t`.
 */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * The i18n key for each waypoint kind.
 *
 * Lives here rather than in the dialog because the export's vocabulary is the
 * export's business: the dialog reads it for its checkboxes, and the builder
 * reads it for the names it writes into the file, and a rename has one place
 * to happen.
 */
export const WAYPOINT_LABEL_KEY: Record<WaypointKind, string> = {
  pad: 'pathExport.wp.pad',
  liftoff: 'pathExport.wp.liftoff',
  burnout: 'pathExport.wp.burnout',
  apogee: 'pathExport.wp.apogee',
  recovery: 'pathExport.wp.recovery',
  landing: 'pathExport.wp.landing',
  maxvelocity: 'pathExport.wp.maxVelocity',
  maxacceleration: 'pathExport.wp.maxAcceleration',
};

/**
 * The strings the built-in templates write into the file, by the name a
 * template refers to them by: `{{labels.peakAltitude}}`.
 *
 * They are on the MODEL rather than inline in the template so that the export
 * language can differ from the app's. A phrase whose word order changes between
 * languages is not in here - it is composed through `t()` with its values and
 * arrives as one finished string (see `distanceBearing` and `stageLanding`),
 * because a template that glues translated fragments together in English order
 * produces English word order in every language.
 */
const LABEL_KEYS = [
  'rocket',
  'time',
  'configuration',
  'launchSite',
  'latLon',
  'aboveSeaLevel',
  'abovePad',
  'fromThePad',
  'maxAltitude',
  'maxVelocity',
  'maxAcceleration',
  'maxRange',
  'timeToApogee',
  'flightTime',
  'altitude',
  'position',
  'coordinates',
  'landing',
  'device',
  'flightPath',
  'groundTrack',
] as const;

function buildLabels(t: Translate): Record<string, string> {
  return Object.fromEntries(LABEL_KEYS.map((k) => [k, t(`pathExport.doc.${k}`)]));
}

/**
 * What exported altitudes are measured from. Mirrors the desktop's
 * `FlightPathExportOptions.AltitudeReference`.
 *
 * It matters because the launch altitude defaults to zero: a site actually
 * 1200 m up then reports its flight in meters above the pad, and placing that
 * against sea level buries the whole track under the terrain.
 *
 * `clamped` is ours, not the desktop's: it drapes the track and the pins flat on
 * the terrain, which is what you want when the question is what the rocket drifts
 * OVER rather than how high it went. The value still travels fine in a desktop
 * template, because the model carries the resolved `<altitudeMode>` as a string.
 */
export type AltitudeReference = 'automatic' | 'ground' | 'sealevel' | 'clamped';

/**
 * Where a stage's own track begins. Mirrors the desktop's
 * `FlightPathExportOptions.StageTrackStart`.
 *
 * A branch created at stage separation starts life as a verbatim copy of its
 * parent's points, so every non-primary branch repeats the ascent the stages
 * flew bolted together.
 */
export type StageTrackStart = 'separation' | 'pad';

/**
 * `automatic` resolved against a launch altitude: a launch altitude the user
 * actually set means the flight can be placed at its true elevation; the
 * default of zero means it cannot.
 */
/** `toFixed`, but a non-finite or absent value reads as a dash, not a throw. */
function fixed(v: number | null | undefined, digits: number): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '-';
}

/**
 * A time in seconds to one decimal, or EMPTY for a moment the flight never
 * reached. Empty rather than a dash because the balloons use these as Mustache
 * sections, and an empty string is false there — the line disappears instead of
 * reporting a flight time the run does not have.
 */
function seconds(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '';
}

export function resolveAltitudeReference(
  reference: AltitudeReference,
  launchAltitudeMeters: number,
): Exclude<AltitudeReference, 'automatic'> {
  if (reference !== 'automatic') return reference;
  return launchAltitudeMeters !== 0 && Number.isFinite(launchAltitudeMeters) ? 'sealevel' : 'ground';
}

/** The KML `<altitudeMode>` a resolved reference is expressed in. */
const KML_ALTITUDE_MODE: Record<Exclude<AltitudeReference, 'automatic'>, string> = {
  ground: 'relativeToGround',
  sealevel: 'absolute',
  clamped: 'clampToGround',
};

export interface FlightPathExportOptions {
  /** Which waypoints to emit. */
  waypoints: Set<WaypointKind>;
  /** Emit the full 3D flight-path line. */
  includeFlightPath: boolean;
  /** Emit the ground track (path clamped to the ground). */
  includeGroundTrack: boolean;
  /** Keep every Nth sampled path point (1 = keep all). */
  pathStride: number;
  /** Unit for the human-facing altitude columns/labels. */
  altitudeUnit: DistanceUnit;
  /** Unit for the human-facing horizontal-distance column. */
  distanceUnit: DistanceUnit;
  /**
   * What the exported TRACK's altitudes are measured from. GPS Visualizer sets
   * this and the waypoint reference below from two separate dropdowns, and it is
   * right to: a flight is worth seeing suspended in the air, while the pins that
   * label it are easier to read against the ground they sit over.
   */
  altitudeReference: AltitudeReference;
  /** What the exported WAYPOINTS' altitudes are measured from. */
  waypointAltitudeReference: AltitudeReference;
  /**
   * Draw a line from the track and each pin straight down to the ground — KML's
   * `<extrude>`, which Google Earth renders as a curtain under the path and a
   * plumb line under a pin. It is how you read WHERE a point in the air sits on
   * the map. Meaningless once the thing is already on the ground, so it is
   * ignored for a clamped reference.
   */
  drawShadow: boolean;
  /** Where each stage's track begins — see {@link StageTrackStart}. */
  stageTrackStart: StageTrackStart;
  /**
   * Whether waypoint names are drawn on the map. A near-vertical flight stacks
   * its waypoints into a few hundred meters of screen, and the reader may
   * prefer bare markers they can click.
   */
  showWaypointLabels: boolean;
  /**
   * Whether waypoint pins carry their stage's color. That needs an icon
   * fetched from Google's servers, so it can be turned off for a file that has
   * to render without a network.
   */
  colorWaypointPins: boolean;
  /**
   * Whether the KML carries the summary balloons — the flight's numbers on the
   * document, the stage's on its folder, and each waypoint's on its own pin.
   * On by default; off for a file going somewhere the descriptions would only
   * get in the way.
   */
  includeDescriptions: boolean;
  /**
   * The language the FILE is written in, or '' to follow the app.
   *
   * Same argument as the two unit fields beside it: a KML going to someone else
   * may want their language whatever the app happens to be showing, and the
   * choice belongs to the file. Empty is a real, selectable value rather than
   * an absence, so it is stored like any other.
   */
  language: string;
  /**
   * A name for this flight, folded into the document name and into every folder
   * and track name. Several exports opened in one Google Earth session are
   * otherwise indistinguishable: every two-stage design contributes a folder
   * called "Sustainer" and a track called "Sustainer flight path", and two
   * designs can each own a "Simulation 1". Empty means no prefix anywhere, and
   * every name is written exactly as it was before this option existed.
   */
  missionName: string;
  /**
   * Whether the mission name also prefixes the waypoint markers. Off by
   * default: a near-vertical flight packs every marker into a few screen
   * pixels, where the labels already overlap enough to have a switch of their
   * own, and making each one longer is strictly worse. It earns its place only
   * when two flights' markers genuinely sit on top of each other.
   */
  labelWaypointsWithMission: boolean;
  /**
   * Per-stage FLIGHT-PATH color overrides, keyed by the branch's index in the
   * built model. Sparse on purpose: a stage left on its palette color stores
   * nothing, so the palette can change later without stranding saved values.
   *
   * Kept under the old name rather than renamed to `branchPathColors`, so
   * existing callers and tests still read correctly.
   */
  branchColors: Map<number, number>;
  /**
   * Per-stage GROUND-TRACK color overrides. Same shape, same sparseness.
   *
   * This used to be derived: the ground track was the path color darkened 45%
   * and drawn at 82% alpha. The derivation existed for a good reason - from
   * directly overhead the ground track sits under the flight path, and one
   * color reads as one line - but it washed out against satellite imagery and
   * the user had nothing to fix it with, because the color was never a value
   * they owned. It is its own color now, with its own palette.
   */
  branchGroundColors: Map<number, number>;
  /**
   * Per-stage WAYPOINT-PIN color overrides. Same shape again.
   *
   * Pins had no color of their own; the template reused the flight path's.
   */
  branchPinColors: Map<number, number>;
}

/**
 * Default options: every waypoint, both tracks, keep all points. The two
 * distance units START from the user's `distance` preference, so someone who
 * works in feet doesn't have to re-pick feet on every export — but they stay
 * separate fields, because the file's unit is a property of the FILE and a
 * KML meant for someone else may want meters whatever the app is showing.
 * A preference this dialog has no unit for (yd, km, mi is covered; anything
 * else) falls back to meters rather than writing a unit the format can't name.
 */
/**
 * Narrow a stored string to a union member, or undefined.
 *
 * The settings store keeps these as plain strings because it must survive a
 * value written by another build; the legal set lives HERE, next to the union,
 * so there is one place to update when a member is added.
 */
export function asWaypointKinds(values: readonly string[] | undefined): Set<WaypointKind> | undefined {
  if (!values) return undefined;
  const legal = new Set<string>(WAYPOINT_KINDS);
  return new Set(values.filter((v): v is WaypointKind => legal.has(v)));
}

export function asDistanceUnit(value: string | undefined): DistanceUnit | undefined {
  return value === 'm' || value === 'ft' || value === 'km' || value === 'mi' ? value : undefined;
}

export function asAltitudeReference(value: string | undefined): AltitudeReference | undefined {
  return value === 'automatic' || value === 'ground' || value === 'sealevel' || value === 'clamped' ? value : undefined;
}

export function asStageTrackStart(value: string | undefined): StageTrackStart | undefined {
  return value === 'separation' || value === 'pad' ? value : undefined;
}

export function defaultExportOptions(preferred?: string): FlightPathExportOptions {
  const unit: DistanceUnit = preferred === 'ft' || preferred === 'km' || preferred === 'mi' ? preferred : 'm';
  return {
    waypoints: new Set(WAYPOINT_KINDS),
    includeFlightPath: true,
    includeGroundTrack: true,
    pathStride: 1,
    altitudeUnit: unit,
    distanceUnit: unit,
    altitudeReference: 'automatic',
    waypointAltitudeReference: 'automatic',
    drawShadow: false,
    stageTrackStart: 'separation',
    showWaypointLabels: true,
    colorWaypointPins: true,
    includeDescriptions: true,
    language: '',
    // Not persisted, and deliberately: a mission name left over from the last
    // export silently mislabels this one, which is worse than retyping it.
    missionName: '',
    labelWaypointsWithMission: false,
    branchColors: new Map(),
    branchGroundColors: new Map(),
    branchPinColors: new Map(),
  };
}

/**
 * Per-branch track colors, so the stages of a staged flight can be told apart.
 * The desktop's palette, value for value, so a stage keeps its color between
 * the two apps — and so a template written against one renders the same in the
 * other.
 */
const BRANCH_COLORS = [
  0x0072bd, 0xd95319, 0xedb120, 0x7e318e, 0x77ac30, 0x4dbeee, 0xa2142f, 0xc56a7a, 0xff7f50, 0x556b2f,
];

/**
 * Ground-track palette. Entry *i* is chosen to CONTRAST with entry *i* of
 * `BRANCH_COLORS`, because a ground track sits directly beneath its flight path
 * when the map is viewed from overhead: blue path / red ground, orange / teal,
 * yellow / purple, and so on.
 *
 * More saturated than a darkened shade would be, because a ground track is read
 * against satellite imagery rather than a white plot background. That is the
 * whole reason this palette exists instead of `darken(pathColor)`.
 */
const GROUND_COLORS = [
  0xff2d55, 0x00b3a4, 0x8e44ad, 0x2ecc40, 0xe01b84, 0xd35400, 0x1abc9c, 0x2e86c1, 0x27ae60, 0xe74c3c,
];

/** Wrap an index into a palette. Floor-mod, so a negative index cannot reach
 *  off the front - the index comes from data, not from a loop counter. */
function paletteAt(palette: readonly number[], index: number): number {
  const n = palette.length;
  return palette[((index % n) + n) % n]!;
}

/**
 * The FLIGHT-PATH color a branch falls on when it has no override.
 */
export function defaultBranchColor(index: number): number {
  return paletteAt(BRANCH_COLORS, index);
}

/**
 * The GROUND-TRACK color a branch falls on when it has no override.
 */
export function defaultGroundColor(index: number): number {
  return paletteAt(GROUND_COLORS, index);
}

/**
 * The WAYPOINT-PIN color a branch falls on when it has no override.
 *
 * Pins want to match the flight path today, so this delegates. That is NOT the
 * old derivation: this is a default that happens to equal another default,
 * resolved once at build time, and an override replaces it without touching
 * anything else. Keeping it as its own named function means giving pins their
 * own palette later is a one-line change.
 */
export function defaultPinColor(index: number): number {
  return defaultBranchColor(index);
}

/** A branch color as the `RRGGBB` a color input wants. */
export function rgbToHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** `#RRGGBB` back to a number; anything unparseable reads as black. */
/**
 * `#rrggbb` to a PACKED 0xRRGGBB integer, which is what KML colors want.
 *
 * Distinct from `reportPdf.hexToRgbTuple`, which returns an [r,g,b] triple for
 * jsPDF. They had the same name and different return types; TypeScript caught
 * a swap at the call site, but the names gave no hint which was which.
 */
export function hexToRgbInt(hex: string): number {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(v) ? v & 0xffffff : 0;
}
const hex2 = (v: number): string => (v & 0xff).toString(16).padStart(2, '0');

/** A packed 0xRRGGBB as the plain `rrggbb` a web color notation wants. */
const rgbHex = (rgb: number): string => (rgb & 0xffffff).toString(16).padStart(6, '0');

/** RGB → the aabbggrr literal KML wants (alpha first, then B, G, R). */
function kmlColor(rgb: number, alpha: number): string {
  return hex2(alpha) + hex2(rgb) + hex2(rgb >> 8) + hex2(rgb >> 16);
}

/**
 * A waypoint label prefixed with the stage it belongs to, e.g. "Booster
 * Apogee". Only when the flight actually staged — otherwise every stage
 * contributes an identically named "Apogee", "Burnout" and "Landing" and the
 * export is impossible to read. A label that already starts with the stage name
 * is left alone rather than stuttering.
 */
/**
 * A name prefixed with the mission, if there is one. The `startsWith` guard is
 * what keeps a mission named after the rocket from yielding "Sod Blaster Sod
 * Blaster Sustainer" — the common case, since the obvious thing to type is the
 * name of the thing you flew.
 */
function withMission(mission: string, text: string | null | undefined): string {
  if (!mission || !text) return text ?? '';
  return text.toLowerCase().startsWith(mission.toLowerCase()) ? text : `${mission} ${text}`;
}

function qualifyLabel(qualifier: string, label: string, qualify: boolean): string {
  if (!qualify || !qualifier || !label) return label ?? '';
  return label.toLowerCase().startsWith(qualifier.toLowerCase()) ? label : `${qualifier} ${label}`;
}

// ---------------------------------------------------------------------------
// Model (format-agnostic, mirrors FlightPathModel)
// ---------------------------------------------------------------------------

export interface FlightPathWaypoint {
  type: WaypointKind;
  label: string;
  device: string;
  latitude: number;
  longitude: number;
  latitudeStr: string;
  longitudeStr: string;
  /** Altitude above sea level, in meters. GPX elevations are defined this way. */
  altitudeMslMeters: number;
  /** Altitude above the ground, in meters. */
  altitudeAglMeters: number;
  /** The altitude to write into a KML coordinate, in `model.kmlWaypointAltitudeMode`. */
  altitudeKmlMeters: number;
  time: number;
  /** The precise event time, to hundredths. What a template should read. */
  timeStr: string;
  /**
   * The same moment to one decimal, which is what the balloons print.
   *
   * A balloon saying `T+1.00 s` beside a landing saying `T+2.0 s` gives one
   * quantity two notations in one file. One decimal is the one that matches the
   * time to apogee and the flight time already in the document balloon, and it
   * is as much as a balloon has any use for; `timeStr` keeps the precision for
   * anything that wants it.
   */
  timeText: string;
  altitude: string; // above the pad, display unit
  altitudeMsl: string; // above sea level, display unit
  distance: string; // horizontal distance from pad, display unit
  bearing: string; // compass degrees from pad
  /**
   * "111.8 m at 27°" in the export language, distance unit included.
   *
   * Composed here rather than glued together in the template: the preposition
   * and the word order differ by language, and a template writing
   * `{{distance}} {{unit}} {{labels.at}} {{bearing}}` would hold every language
   * to English word order. The parts are all still on the model for a template
   * that wants to build its own.
   */
  rangeText: string;
  /** `label` qualified with its stage, e.g. "Booster Apogee". Same as `label`
   *  for a single-branch flight. */
  qualifiedLabel: string;
  /** Name of the flight branch (stage) this waypoint belongs to. */
  branchName: string;
}

export interface FlightPathPoint {
  latitude: number;
  longitude: number;
  /** Altitude above sea level, in meters. GPX elevations are defined this way. */
  altitudeMslMeters: number;
  /** Altitude above the ground, in meters. */
  altitudeAglMeters: number;
  /** The altitude to write into a KML coordinate, in `model.kmlAltitudeMode`. */
  altitudeKmlMeters: number;
  time: number;
  timeStr: string;
  altitude: string;
}

export interface FlightPathBranch {
  name: string;
  /** Zero-based position in `model.branches`, for building unique style ids. */
  index: number;
  /**
   * This branch's FLIGHT-PATH color as RRGGBB. Kept under the old name (rather
   * than `pathColorRgb`) so a template written before ground and pin got their
   * own colors still renders.
   */
  colorRgb: string;
  /** This branch's GROUND-TRACK color as RRGGBB. */
  groundColorRgb: string;
  /** This branch's WAYPOINT-PIN color as RRGGBB. */
  pinColorRgb: string;
  /** The flight-path color as an opaque KML aabbggrr literal. */
  pathColorKml: string;
  /** The ground-track color as an opaque KML aabbggrr literal. */
  groundColorKml: string;
  /** The waypoint-pin color as an opaque KML aabbggrr literal. */
  pinColorKml: string;
  waypoints: FlightPathWaypoint[];
  path: FlightPathPoint[];
  /** Template convenience (mirrors the desktop model's methods). */
  hasPath: boolean;
  hasWaypoints: boolean;
  /**
   * The farthest this stage got from the pad, horizontally, in meters.
   *
   * Scanned over the WHOLE branch — including the ascent the stages flew bolted
   * together before separation — because the stack's excursion counts against
   * every stage that was part of it. That is deliberately unlike the peak
   * velocity and peak acceleration waypoints, which are scanned from the
   * separation point so a spent booster reports its own peaks: a peak velocity
   * is a claim about what that stage DID, while a range is a claim about where
   * that airframe WENT.
   */
  maxRangeMeters: number;
  /** {@link maxRangeMeters} in the distance unit. */
  maxRange: string;
  /**
   * Whether this stage recorded a ground hit.
   *
   * A normal flight always lands, so this looks like a case that cannot arise.
   * It can: a run that hits the simulation time limit ends without a
   * `GROUND_HIT`, and an aborted one (no motor fired) produces no events at
   * all. The three landing values below are gated behind this rather than
   * falling back to the last sample, so a flight that was still climbing when
   * the run ended does not report a touchdown at the altitude it was flying at.
   */
  hasLanding: boolean;
  /** Horizontal distance from the pad to the landing, in the distance unit. */
  landingDistance: string;
  /** Compass bearing from the pad to the landing, in whole degrees. */
  landingBearing: string;
  /** Seconds after liftoff that this stage came down. */
  landingTime: string;
  /**
   * Where it came down, to six decimals.
   *
   * A distance and a bearing from the pad read the map; they do not walk you to
   * the rocket. This is the pair you type into a handheld, so it is the fact the
   * landing lines lead with.
   */
  landingLatitudeStr: string;
  landingLongitudeStr: string;
  /** This stage's landing as "223.6 m at 27°", like {@link FlightPathWaypoint.rangeText}. */
  landingText: string;
  /** "Sustainer landing" in the export language, with the stage name in the
   *  position that language puts it. */
  landingHeading: string;
}

export interface FlightPathModel {
  title: string;
  rocketName: string;
  simulationName: string;
  motor: string;
  configuration: string;
  launchLatitude: number;
  launchLongitude: number;
  launchAltitudeMeters: number;
  /** The launch coordinates fixed to six decimals, for a human-facing line. */
  launchLatitudeStr: string;
  launchLongitudeStr: string;
  /** {@link launchAltitudeMeters} in the altitude unit. */
  launchAltitude: string;
  altitudeUnit: string;
  distanceUnit: string;
  /**
   * Unit labels for the peak velocity and acceleration. Neither has a unit
   * option of its own — both are exported in SI whatever the distance unit is —
   * so until the balloons wanted to name them they reached a template as bare
   * numbers with nothing saying what they were.
   */
  velocityUnit: string;
  accelerationUnit: string;
  includeFlightPath: boolean;
  includeGroundTrack: boolean;
  /** The KML `<altitudeMode>` a path point's `altitudeKmlMeters` is expressed in. */
  kmlAltitudeMode: string;
  /** The KML `<altitudeMode>` a waypoint's `altitudeKmlMeters` is expressed in. */
  kmlWaypointAltitudeMode: string;
  /**
   * Draw `<extrude>` lines from the track and the pins down to the ground.
   * A Mustache SECTION, not a value: a template that predates this field simply
   * renders nothing for it, where `<extrude>{{extrude}}</extrude>` would emit an
   * empty element. Already false when the thing is clamped to the ground.
   */
  extrudePath: boolean;
  extrudeWaypoints: boolean;
  /**
   * Break the flight-path line into terrain-following pieces. KML only honours
   * `<tessellate>` for a clamped line, and without it a clamped path cuts
   * straight through hills instead of draping over them.
   */
  tessellatePath: boolean;
  /** Whether waypoint names are drawn on the map. */
  showWaypointLabels: boolean;
  /** Whether waypoint pins carry their stage's color. */
  colorWaypointPins: boolean;
  maxAltitude: string;
  maxVelocity: string;
  maxAcceleration: string;
  /**
   * The farthest ANY stage got from the pad, horizontally, in the distance
   * unit. Not the landing distance: a rocket can drift downrange under the
   * chute and then partway back, so the range-safety figure is the maximum and
   * where it came down is a separate fact. Both are exported.
   */
  maxRange: string;
  /** Seconds from liftoff to the highest point, to one decimal. */
  timeToApogee: string;
  /** Seconds from liftoff to the end of the flight, to one decimal. */
  flightTime: string;
  /**
   * Whether the summary balloons are written at all. A Mustache SECTION, so a
   * template that predates it renders exactly as it did before.
   */
  includeDescriptions: boolean;
  /**
   * The built-in templates' own strings, in the export language:
   * `{{labels.peakAltitude}}`. See `LABEL_KEYS` for what is in here and what is
   * deliberately not.
   */
  labels: Record<string, string>;
  branches: FlightPathBranch[];
}

/** Metadata the flight data itself does not carry. */
export interface FlightPathMeta {
  simName: string;
  rocketName: string;
  motorName: string;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const UNIT_SYMBOL: Record<DistanceUnit, string> = { m: 'm', ft: 'ft', km: 'km', mi: 'mi' };
/** Meters → unit multiplier. */
const UNIT_FACTOR: Record<DistanceUnit, number> = { m: 1, ft: 3.280839895, km: 0.001, mi: 0.000621371192 };
/** Decimals shown per unit (larger units get more). */
const UNIT_DECIMALS: Record<DistanceUnit, number> = { m: 1, ft: 1, km: 3, mi: 3 };

/** Render a meters value in the given unit, without the unit symbol. */
function fmtLength(meters: number, unit: DistanceUnit): string {
  if (!Number.isFinite(meters)) return '';
  return (meters * UNIT_FACTOR[unit]).toFixed(UNIT_DECIMALS[unit]);
}

// ---------------------------------------------------------------------------
// Geographic projection
// ---------------------------------------------------------------------------

/**
 * Coordinates written into the exported file when the design carries no launch
 * position: the Kennedy Space Center, the same fallback desktop OpenRocket uses
 * in `FlightPathModelBuilder.EXPORT_FALLBACK_*`. Dropping a flight on Null
 * Island tells the reader nothing.
 *
 * These are used for the exported coordinates only. Nothing here writes to the
 * design, and its launch position is left exactly as the user set it.
 */
export const EXPORT_FALLBACK_LATITUDE = 28.61;
export const EXPORT_FALLBACK_LONGITUDE = -80.6;

/**
 * True when BOTH coordinates are still zero — the only combination that cannot
 * be a real launch site anyone uses, since (0, 0) is open ocean in the Gulf of
 * Guinea.
 *
 * This is deliberately narrower than desktop OpenRocket, whose
 * `FlightPathModelBuilder` treats a zero in *either* coordinate as unset. A
 * zero longitude is a legitimate position — Greenwich, and everywhere else on
 * the prime meridian — and so is a zero latitude, so OpenRocket's rule would
 * relocate a real launch site that happens to sit on one of those lines.
 */
function launchPositionUnset(launch: LaunchConditions): boolean {
  return (launch.latitudeDeg ?? 0) === 0 && (launch.longitudeDeg ?? 0) === 0;
}

/**
 * WGS84 degree lengths at a latitude, good to a few centimeters per kilometer
 * — the same series desktop OpenRocket projects with, so a track exported from
 * either app lands on the same spot. A spherical Earth would put a 10 km drift
 * tens of meters off.
 */
function metersPerDegree(latitudeDeg: number): { lat: number; lon: number } {
  const phi = (latitudeDeg * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

// ---------------------------------------------------------------------------
// Model builder (mirrors FlightPathModelBuilder)
// ---------------------------------------------------------------------------

/** Coerce a possibly-missing series value to a finite number, or 0. */
const finiteOr0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const series = (s: FlightSeries, key: string): (number | null)[] | undefined => s[key] as (number | null)[] | undefined;

/**
 * Staged flights carry per-branch data (branch 0 = the sustainer stack); a
 * single flight is exported as one synthetic branch from the top-level series.
 */
function rawBranchesOf(
  result: FlightResult,
  meta: FlightPathMeta,
): { name: string; events: FlightEvent[]; series: FlightSeries }[] {
  if (result.branches && result.branches.length) return result.branches;
  return [{ name: meta.rocketName || meta.simName || 'Flight', events: result.events, series: result.series }];
}

/**
 * The two series every branch is built from, or null when the branch produced
 * nothing usable. The one place that decides whether a branch exports at all,
 * so the color picker and the builder cannot disagree about how many there are.
 */
function usableSeries(s: FlightSeries): { time: (number | null)[]; alt: (number | null)[] } | null {
  const time = series(s, 'time');
  const alt = series(s, 'altitude');
  if (!time || !alt || time.length === 0) return null;
  return { time, alt };
}

/**
 * The raw stage names of the branches this flight will actually export, in the
 * order their `index` will be assigned — what the stage-color picker offers a
 * swatch for. Unprefixed: it names the stage, not the file.
 */
export function exportBranchNames(result: FlightResult, meta: FlightPathMeta): string[] {
  return rawBranchesOf(result, meta)
    .filter((b) => usableSeries(b.series) !== null)
    .map((b) => b.name);
}

/**
 * Build the flight-path model from a simulation result and its launch site.
 *
 * @param t resolves the export's strings. Bind it to `options.language` and
 *          every string in the file follows; the app's own `t` writes the file
 *          in whatever the app is showing.
 */
export function buildFlightPathModel(
  result: FlightResult,
  launch: LaunchConditions,
  meta: FlightPathMeta,
  options: FlightPathExportOptions,
  t: Translate,
): FlightPathModel {
  // A position left at (0, 0) was never filled in, and is exported from the
  // Kennedy Space Center rather than from Null Island. The design is untouched.
  const unset = launchPositionUnset(launch);
  const lat0 = unset ? EXPORT_FALLBACK_LATITUDE : (launch.latitudeDeg ?? 0);
  const lon0 = unset ? EXPORT_FALLBACK_LONGITUDE : (launch.longitudeDeg ?? 0);
  const launchAlt = launch.launchAltitudeM ?? 0;

  const perDegree = metersPerDegree(lat0);
  // Guard the poles, where a degree of longitude is zero meters wide and every
  // east offset would divide to infinity. Unreachable for the KSC fallback and
  // for any launch site anyone uses, but a NaN in a coordinate is a broken file.
  const lonPerDegree = Math.abs(perDegree.lon) < 1e-9 ? Infinity : perDegree.lon;

  const toLat = (north: number): number => lat0 + north / perDegree.lat;
  const toLon = (east: number): number => lon0 + east / lonPerDegree;

  // `automatic` only means something once there is a launch altitude to judge,
  // so it is resolved here and the model carries the answer, not the question.
  const altitudeReference = resolveAltitudeReference(options.altitudeReference, launchAlt);
  const waypointReference = resolveAltitudeReference(options.waypointAltitudeReference, launchAlt);
  // A clamped coordinate's altitude is ignored by KML, but writing the AGL value
  // rather than a bare 0 keeps the number meaningful to anything else reading it.
  const kmlAltitudeFor =
    (reference: Exclude<AltitudeReference, 'automatic'>) =>
    (altAgl: number): number =>
      reference === 'sealevel' ? altAgl + launchAlt : altAgl;
  const kmlAltitude = kmlAltitudeFor(altitudeReference);
  const kmlWaypointAltitude = kmlAltitudeFor(waypointReference);

  // Trimmed once here, so a name that is nothing but spaces is no mission at
  // all rather than a leading space on every name in the file.
  const mission = (options.missionName ?? '').trim();

  const model: FlightPathModel = {
    title: withMission(mission, meta.simName),
    rocketName: meta.rocketName,
    simulationName: meta.simName,
    motor: meta.motorName,
    configuration: meta.motorName,
    launchLatitude: lat0,
    launchLongitude: lon0,
    launchAltitudeMeters: launchAlt,
    launchLatitudeStr: lat0.toFixed(6),
    launchLongitudeStr: lon0.toFixed(6),
    launchAltitude: fmtLength(launchAlt, options.altitudeUnit),
    altitudeUnit: UNIT_SYMBOL[options.altitudeUnit],
    distanceUnit: UNIT_SYMBOL[options.distanceUnit],
    // The two peaks are SI whatever the distance unit is, so these are
    // constants rather than a lookup — see the field docs.
    velocityUnit: 'm/s',
    accelerationUnit: 'm/s²',
    includeFlightPath: options.includeFlightPath,
    includeGroundTrack: options.includeGroundTrack,
    kmlAltitudeMode: KML_ALTITUDE_MODE[altitudeReference],
    kmlWaypointAltitudeMode: KML_ALTITUDE_MODE[waypointReference],
    // Nothing to extrude to once a thing is already lying on the ground.
    extrudePath: options.drawShadow && altitudeReference !== 'clamped',
    extrudeWaypoints: options.drawShadow && waypointReference !== 'clamped',
    tessellatePath: altitudeReference === 'clamped',
    showWaypointLabels: options.showWaypointLabels,
    colorWaypointPins: options.colorWaypointPins,
    maxAltitude: fmtLength(result.summary.maxAltitude, options.altitudeUnit),
    // `toFixed` on a non-number throws. A stored result that went through
    // JSON has `null` wherever a NaN/Infinity was, and this ran unguarded
    // while `maxAltitude` above went through `fmtLength`. readResults now
    // rejects such a result outright; this is the second line of defense, on
    // the path a user reaches by exporting after a reload.
    maxVelocity: fixed(result.summary.maxVelocity, 1),
    maxAcceleration: fixed(result.summary.maxAcceleration, 1),
    // Filled in below, once the branches it is the maximum over exist.
    maxRange: '',
    timeToApogee: seconds(result.summary.timeToApogee),
    flightTime: seconds(result.summary.flightTime),
    includeDescriptions: options.includeDescriptions,
    labels: buildLabels(t),
    branches: [],
  };

  const rawBranches = rawBranchesOf(result, meta);

  // Only a staged flight needs its waypoints qualified — see `qualifyLabel`.
  const qualify = rawBranches.length > 1;

  for (const [i, raw] of rawBranches.entries()) {
    const branch = buildBranch(raw, options, t, {
      toLat,
      toLon,
      launchAlt,
      altUnit: options.altitudeUnit,
      distUnit: options.distanceUnit,
      kmlAltitude,
      kmlWaypointAltitude,
      qualify,
      // Empty unless the markers were opted in, so the mission can be folded
      // into the folder and track names without reaching the pins.
      waypointMission: options.labelWaypointsWithMission ? mission : '',
      primary: i === 0,
      stageTrackStart: options.stageTrackStart,
    });
    if (!branch) continue;
    // Assigned on push, not from the loop counter: a branch that yields no
    // usable series is skipped, and the indices must stay contiguous or two
    // branches would share a KML style id.
    branch.index = model.branches.length;
    // Three colors, each one either the user's pick or this stage's own
    // default. Nothing is computed from anything else, so changing one never
    // moves another and a picked color reaches the output byte for byte.
    const rgb = options.branchColors?.get(branch.index) ?? defaultBranchColor(branch.index);
    const groundRgb = options.branchGroundColors?.get(branch.index) ?? defaultGroundColor(branch.index);
    const pinRgb = options.branchPinColors?.get(branch.index) ?? defaultPinColor(branch.index);
    // The folder name carries the mission; the raw stage name stays on the
    // branch context, where the waypoint labels are qualified from it. Prefix
    // the branch name first and qualify from that, and you can no longer have
    // one without the other.
    branch.name = withMission(mission, branch.name);
    branch.colorRgb = rgbHex(rgb);
    branch.groundColorRgb = rgbHex(groundRgb);
    branch.pinColorRgb = rgbHex(pinRgb);
    // All three opaque. Alpha used to depend on whether the color was derived,
    // which meant the same color rendered differently depending on how it got
    // there - picking exactly the default gave a different result from leaving
    // it alone. If translucency is wanted it becomes its own control, with its
    // own default, by the same rule as the colors.
    branch.pathColorKml = kmlColor(rgb, 0xff);
    branch.groundColorKml = kmlColor(groundRgb, 0xff);
    branch.pinColorKml = kmlColor(pinRgb, 0xff);
    model.branches.push(branch);
  }

  // The flight's range is the farthest any one stage reached. A pass over the
  // finished branches rather than a second scan of the series: the per-branch
  // maxima are already the answer, and computing it twice is how the two drift.
  let maxRangeMeters = 0;
  for (const branch of model.branches) {
    if (branch.maxRangeMeters > maxRangeMeters) maxRangeMeters = branch.maxRangeMeters;
  }
  model.maxRange = fmtLength(maxRangeMeters, options.distanceUnit);
  return model;
}

interface BranchCtx {
  toLat: (north: number) => number;
  toLon: (east: number) => number;
  launchAlt: number;
  altUnit: DistanceUnit;
  distUnit: DistanceUnit;
  /** Height above the ground → the altitude a KML coordinate should carry. */
  kmlAltitude: (altAgl: number) => number;
  kmlWaypointAltitude: (altAgl: number) => number;
  /** True when the flight staged, so waypoint labels name their stage. */
  qualify: boolean;
  /**
   * The mission prefix for the waypoint LABELS, or '' for none. Kept apart from
   * the branch name for the reason given where it is applied: the folder and
   * track names can carry the mission while the markers stay short.
   */
  waypointMission: string;
  /**
   * True for the branch the whole vehicle flew. Leaving the pad is something
   * the stack does, not any one stage, so only this branch gets a pad
   * waypoint — and only the others can have a shared ascent to trim.
   */
  primary: boolean;
  /** Where this branch's own flight begins; see {@link StageTrackStart}. */
  stageTrackStart: StageTrackStart;
}

/**
 * The first data index belonging to this branch alone.
 *
 * A separated branch repeats its parent's points from the pad up to the moment
 * it let go. Exporting that prefix again draws the shared ascent once per
 * stage, and attributes the stack's flight — and its peak speed — to a stage
 * that was not yet flying on its own.
 *
 * Falls back to 0 for the primary branch, when the user asked for every track
 * to start on the pad, and for any branch with no recorded separation.
 */
function branchStartIndex(
  events: FlightEvent[],
  time: (number | null)[],
  n: number,
  ctx: Pick<BranchCtx, 'primary' | 'stageTrackStart'>,
): number {
  if (ctx.primary || ctx.stageTrackStart === 'pad') return 0;
  const separation = events.find((e) => e.type === 'STAGE_SEPARATION');
  if (!separation || !Number.isFinite(separation.time)) return 0;
  const idx = indexOfTime(time, separation.time, n);
  return idx > 0 && idx < n ? idx : 0;
}

function buildBranch(
  raw: { name: string; events: FlightEvent[]; series: FlightSeries },
  options: FlightPathExportOptions,
  t: Translate,
  ctx: BranchCtx,
): FlightPathBranch | null {
  const usable = usableSeries(raw.series);
  if (!usable) return null;
  const { time, alt } = usable;

  const east = series(raw.series, 'Px'); // lateral drift east (m)
  const north = series(raw.series, 'Py'); // lateral drift north (m)
  const vel = series(raw.series, 'velocity');
  const acc = series(raw.series, 'acceleration');
  const n = Math.min(time.length, alt.length);
  const start = branchStartIndex(raw.events, time, n, ctx);

  const eastAt = (i: number) => finiteOr0(east?.[i]);
  const northAt = (i: number) => finiteOr0(north?.[i]);
  const distanceAt = (i: number) => Math.hypot(eastAt(i), northAt(i));
  const bearingAt = (i: number) => {
    const deg = (Math.atan2(eastAt(i), northAt(i)) * 180) / Math.PI;
    return (deg + 360) % 360;
  };

  /** "223.6 m at 27°", in the export language. */
  const distanceBearing = (i: number): string =>
    t('pathExport.doc.distanceBearing', {
      distance: fmtLength(distanceAt(i), ctx.distUnit),
      unit: UNIT_SYMBOL[ctx.distUnit],
      bearing: bearingAt(i).toFixed(0),
    });

  const mkWaypoint = (i: number, type: WaypointKind, label: string, device: string | null): FlightPathWaypoint => {
    const altAgl = finiteOr0(alt[i]);
    const latitude = ctx.toLat(northAt(i));
    const longitude = ctx.toLon(eastAt(i));
    const mslMeters = altAgl + ctx.launchAlt;
    const t = finiteOr0(time[i]);
    return {
      type,
      label,
      device: device ?? '',
      latitude,
      longitude,
      latitudeStr: latitude.toFixed(6),
      longitudeStr: longitude.toFixed(6),
      altitudeMslMeters: mslMeters,
      altitudeAglMeters: altAgl,
      altitudeKmlMeters: ctx.kmlWaypointAltitude(altAgl),
      time: t,
      timeStr: t.toFixed(2),
      timeText: seconds(t),
      altitude: fmtLength(altAgl, ctx.altUnit),
      altitudeMsl: fmtLength(mslMeters, ctx.altUnit),
      distance: fmtLength(distanceAt(i), ctx.distUnit),
      bearing: bearingAt(i).toFixed(0),
      rangeText: distanceBearing(i),
      qualifiedLabel: withMission(ctx.waypointMission, qualifyLabel(raw.name, label, ctx.qualify)),
      branchName: raw.name,
    };
  };

  // index / colors are filled in by the caller, which knows the branch's
  // position among the ones that actually produced data.
  const branch: FlightPathBranch = {
    name: raw.name,
    index: 0,
    colorRgb: '',
    groundColorRgb: '',
    pinColorRgb: '',
    pathColorKml: '',
    groundColorKml: '',
    pinColorKml: '',
    waypoints: [],
    path: [],
    hasPath: false,
    hasWaypoints: false,
    maxRangeMeters: 0,
    maxRange: '',
    hasLanding: false,
    landingDistance: '',
    landingBearing: '',
    landingTime: '',
    landingLatitudeStr: '',
    landingLongitudeStr: '',
    landingText: '',
    landingHeading: t('pathExport.doc.stageLanding', { stage: raw.name }),
  };

  // From 0, not from `start`: see `maxRangeMeters` on FlightPathBranch for why
  // a separated stage owns the whole stack's excursion.
  for (let i = 0; i < n; i++) {
    const d = distanceAt(i);
    if (d > branch.maxRangeMeters) branch.maxRangeMeters = d;
  }
  branch.maxRange = fmtLength(branch.maxRangeMeters, ctx.distUnit);

  // Scanned from the branch's own events, NOT read back out of the waypoints
  // built below: the user can switch the landing marker off, and the summary
  // still has to know where the stage came down.
  const groundHit = raw.events.find((e) => e.type === 'GROUND_HIT' && Number.isFinite(e.time));
  if (groundHit) {
    const i = indexOfTime(time, groundHit.time, n);
    branch.hasLanding = true;
    branch.landingDistance = fmtLength(distanceAt(i), ctx.distUnit);
    branch.landingBearing = bearingAt(i).toFixed(0);
    branch.landingTime = seconds(groundHit.time);
    branch.landingLatitudeStr = ctx.toLat(northAt(i)).toFixed(6);
    branch.landingLongitudeStr = ctx.toLon(eastAt(i)).toFixed(6);
    branch.landingText = distanceBearing(i);
  }

  // Only the stack leaves the pad; a booster's copy of that moment is not its
  // own event, and emitting it per stage litters the map with duplicate pins.
  if (ctx.primary && options.waypoints.has('pad')) {
    branch.waypoints.push(mkWaypoint(0, 'pad', t(WAYPOINT_LABEL_KEY.pad), null));
  }

  for (const event of raw.events) {
    const kind = EVENT_TO_WAYPOINT[event.type];
    if (!kind || !options.waypoints.has(kind)) continue;
    const i = indexOfTime(time, event.time, n);
    if (kind === 'recovery') {
      // A device the user never renamed reaches us as the bundle key its
      // default name is looked up under - `[Parachute.Parachute]` - because the
      // TeaVM kernel carries no resource bundles. Translated with the EXPORT's
      // translator, so it follows the language box like every other word in
      // the file rather than being the one English one among them.
      const raw = event.source ?? '';
      const device = componentName(raw, t);
      // The event word, QUALIFIED by the device: "Drogue Ejection", not
      // "Drogue" and not a bare "Ejection". Naming the pin for the device
      // alone loses the event vocabulary that every other pin uses; naming it
      // for the event alone makes a dual-deployment flight two identical pins.
      // Only a name the user chose qualifies - a default one says nothing the
      // balloon's device line does not. Same qualifier helper the stage names
      // use, so it inherits the guard against doubling a name that already
      // starts with the qualifier, and a staged flight stacks the two into
      // "Booster Drogue Ejection", which is long and is exactly what that pin
      // is.
      const named = raw !== '' && !isDefaultComponentName(raw);
      const label = qualifyLabel(device, t(WAYPOINT_LABEL_KEY.recovery), named);
      branch.waypoints.push(mkWaypoint(i, 'recovery', label, device));
    } else {
      branch.waypoints.push(mkWaypoint(i, kind, t(WAYPOINT_LABEL_KEY[kind]), null));
    }
  }

  // Scanned from the separation point so a spent booster reports its own peaks.
  // Scanning the copied ascent instead labels the whole stack's maxima as the
  // booster's, at speeds it reached while still bolted to the sustainer.
  if (options.waypoints.has('maxvelocity') && vel && vel.length) {
    branch.waypoints.push(
      mkWaypoint(
        indexOfMax(vel, start, Math.min(n, vel.length)),
        'maxvelocity',
        t(WAYPOINT_LABEL_KEY.maxvelocity),
        null,
      ),
    );
  }
  if (options.waypoints.has('maxacceleration') && acc && acc.length) {
    branch.waypoints.push(
      mkWaypoint(
        indexOfMax(acc, start, Math.min(n, acc.length)),
        'maxacceleration',
        t(WAYPOINT_LABEL_KEY.maxacceleration),
        null,
      ),
    );
  }

  branch.waypoints.sort((a, b) => a.time - b.time);

  if (options.includeFlightPath || options.includeGroundTrack) {
    const stride = Math.max(1, options.pathStride);
    const pushPoint = (i: number) => {
      const altAgl = finiteOr0(alt[i]);
      const t = finiteOr0(time[i]);
      branch.path.push({
        latitude: ctx.toLat(northAt(i)),
        longitude: ctx.toLon(eastAt(i)),
        altitudeMslMeters: altAgl + ctx.launchAlt,
        altitudeAglMeters: altAgl,
        altitudeKmlMeters: ctx.kmlAltitude(altAgl),
        time: t,
        timeStr: t.toFixed(2),
        altitude: fmtLength(altAgl, ctx.altUnit),
      });
    };
    for (let i = start; i < n; i += stride) pushPoint(i);
    // Always include the final point so the track ends at landing. Measured
    // from `start`, not from 0, or a strided separated branch drops its last
    // point whenever the trimmed length happens to land on the stride.
    if (n > start && (n - 1 - start) % stride !== 0) pushPoint(n - 1);
  }

  branch.hasPath = branch.path.length > 0;
  branch.hasWaypoints = branch.waypoints.length > 0;
  return branch;
}

/** OpenRocket flight-event type → waypoint kind. */
const EVENT_TO_WAYPOINT: Record<string, WaypointKind | undefined> = {
  LIFTOFF: 'liftoff',
  BURNOUT: 'burnout',
  APOGEE: 'apogee',
  RECOVERY_DEVICE_DEPLOYMENT: 'recovery',
  GROUND_HIT: 'landing',
};

function indexOfTime(time: (number | null)[], t: number, n: number): number {
  let best = 0;
  let bestDiff = Infinity;
  const limit = Math.min(n, time.length);
  for (let i = 0; i < limit; i++) {
    const diff = Math.abs(finiteOr0(time[i]) - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

function indexOfMax(values: (number | null)[], from: number, n: number): number {
  let maxIndex = from;
  let max = -Infinity;
  for (let i = from; i < n; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v) && v > max) {
      max = v;
      maxIndex = i;
    }
  }
  return maxIndex;
}

// ---------------------------------------------------------------------------
// Built-in renderers
// ---------------------------------------------------------------------------
//
// Each built-in format renders through the shared Mustache path using its own
// template source (EXPORT_FORMATS[].source). There is no hand-written renderer
// to drift from the template — the file you download and re-import IS what
// produces the built-in output. Templates live next to the format registry.

/** Render the model as KML (Google Earth). */
export function renderKml(model: FlightPathModel): string {
  return renderUserTemplate(KML_TEMPLATE_SOURCE, 'kml', model);
}

/** Render the model as a GPX 1.1 track. */
export function renderGpx(model: FlightPathModel): string {
  return renderUserTemplate(GPX_TEMPLATE_SOURCE, 'gpx', model);
}

/** Render the model as a waypoint CSV (one row per waypoint). */
export function renderWaypointCsv(model: FlightPathModel): string {
  return renderUserTemplate(WAYPOINTS_CSV_TEMPLATE_SOURCE, 'csv', model);
}

// ---------------------------------------------------------------------------
// Format registry
// ---------------------------------------------------------------------------

export interface ExportFormat {
  id: 'kml' | 'gpx' | 'waypoints-csv';
  /** Output file extension without a dot. */
  extension: string;
  /** MIME type for the download blob. */
  mime: string;
  render: (model: FlightPathModel) => string;
  /** The Mustache template source, offered for download as a starting point for
   *  custom templates. It renders through {@link renderUserTemplate} to output
   *  equivalent to this format's built-in renderer. */
  source: string;
  /** Suggested filename when downloading {@link ExportFormat.source}. */
  templateFilename: string;
}

// The built-in Mustache templates, mirroring OpenRocket's bundled templates.
// They are the "download to modify" starting points; the model field names match
// so an edited copy re-imports and renders through renderUserTemplate.
//
// The KML balloons' HTML is written PRE-ESCAPED (`&lt;b&gt;`, not `<b>`), and
// deliberately not wrapped in CDATA. `escaperFor('kml')` escapes every value
// this template substitutes, because they are user-supplied names that would
// otherwise break the XML — and inside a CDATA block the XML parser does not
// decode those escapes, so a rocket named `Bill & Ted` would reach the balloon
// as the literal text `Bill &amp; Ted`. A CDATA block is breakable too: a name
// containing `]]>` would close it early and produce an invalid document.
// Pre-escaping makes the two consistent — the template's own markup and the
// values are each escaped exactly once, the parser decodes them together, and
// the balloon gets the HTML the template meant and the name the user typed.
// The degree sign is a literal UTF-8 character rather than `&deg;` for the same
// reason: one layer of entity decoding, not two.
const KML_TEMPLATE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
	<Document>
		<name>{{title}}</name>
		<open>1</open>
{{#includeDescriptions}}
		<Snippet></Snippet>
		<description>&lt;b&gt;{{labels.rocket}}:&lt;/b&gt; {{rocketName}}&lt;br/&gt;
{{#configuration}}&lt;b&gt;{{labels.configuration}}:&lt;/b&gt; {{configuration}}&lt;br/&gt;
{{/configuration}}&lt;b&gt;{{labels.launchSite}}:&lt;/b&gt; {{launchLatitudeStr}}, {{launchLongitudeStr}} {{labels.latLon}}{{#launchAltitudeMeters}}, {{launchAltitude}} {{altitudeUnit}} {{labels.aboveSeaLevel}}{{/launchAltitudeMeters}}&lt;br/&gt;
&lt;b&gt;{{labels.maxAltitude}}:&lt;/b&gt; {{maxAltitude}} {{altitudeUnit}}&lt;br/&gt;
&lt;b&gt;{{labels.maxVelocity}}:&lt;/b&gt; {{maxVelocity}} {{velocityUnit}}&lt;br/&gt;
&lt;b&gt;{{labels.maxAcceleration}}:&lt;/b&gt; {{maxAcceleration}} {{accelerationUnit}}&lt;br/&gt;
&lt;b&gt;{{labels.maxRange}}:&lt;/b&gt; {{maxRange}} {{distanceUnit}} {{labels.fromThePad}}&lt;br/&gt;
{{#timeToApogee}}&lt;b&gt;{{labels.timeToApogee}}:&lt;/b&gt; {{timeToApogee}} s&lt;br/&gt;
{{/timeToApogee}}{{#flightTime}}&lt;b&gt;{{labels.flightTime}}:&lt;/b&gt; {{flightTime}} s&lt;br/&gt;
{{/flightTime}}{{#branches}}{{#hasLanding}}&lt;b&gt;{{landingHeading}}:&lt;/b&gt; {{landingLatitudeStr}}, {{landingLongitudeStr}} {{labels.latLon}}; {{landingText}} {{labels.fromThePad}}; T+{{landingTime}} s&lt;br/&gt;
{{/hasLanding}}{{/branches}}</description>
{{/includeDescriptions}}
{{#branches}}
		<Style id="flightPath{{index}}"><LineStyle><color>{{pathColorKml}}</color><width>3</width></LineStyle></Style>
		<Style id="groundTrack{{index}}"><LineStyle><color>{{groundColorKml}}</color><width>2</width></LineStyle></Style>
		<Style id="waypoint{{index}}">
{{#colorWaypointPins}}
			<IconStyle>
				<color>{{pinColorKml}}</color>
				<Icon><href>https://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png</href></Icon>
				<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>
			</IconStyle>
{{/colorWaypointPins}}
{{^showWaypointLabels}}
			<LabelStyle><scale>0</scale></LabelStyle>
{{/showWaypointLabels}}
		</Style>
{{/branches}}
{{#branches}}
		<Folder>
			<name>{{name}}</name>
{{#includeDescriptions}}
			<Snippet></Snippet>
			<description>&lt;b&gt;{{labels.maxRange}}:&lt;/b&gt; {{maxRange}} {{distanceUnit}} {{labels.fromThePad}}&lt;br/&gt;
{{#hasLanding}}&lt;b&gt;{{labels.landing}}:&lt;/b&gt; {{landingLatitudeStr}}, {{landingLongitudeStr}} {{labels.latLon}}; {{landingText}} {{labels.fromThePad}}; T+{{landingTime}} s&lt;br/&gt;
{{/hasLanding}}</description>
{{/includeDescriptions}}
{{#waypoints}}
			<Placemark>
				<name>{{qualifiedLabel}}</name>
{{#includeDescriptions}}
				<Snippet></Snippet>
				<description>&lt;b&gt;{{labels.time}}:&lt;/b&gt; T+{{timeText}} s&lt;br/&gt;
&lt;b&gt;{{labels.altitude}}:&lt;/b&gt; {{altitude}} {{altitudeUnit}} {{labels.abovePad}}{{#launchAltitudeMeters}}, {{altitudeMsl}} {{altitudeUnit}} {{labels.aboveSeaLevel}}{{/launchAltitudeMeters}}&lt;br/&gt;
&lt;b&gt;{{labels.position}}:&lt;/b&gt; {{rangeText}} {{labels.fromThePad}}&lt;br/&gt;
&lt;b&gt;{{labels.coordinates}}:&lt;/b&gt; {{latitudeStr}}, {{longitudeStr}} {{labels.latLon}}{{#device}}&lt;br/&gt;
&lt;b&gt;{{labels.device}}:&lt;/b&gt; {{device}}{{/device}}</description>
{{/includeDescriptions}}
				<styleUrl>#waypoint{{index}}</styleUrl>
				<Point>
{{#extrudeWaypoints}}					<extrude>1</extrude>
{{/extrudeWaypoints}}					<altitudeMode>{{kmlWaypointAltitudeMode}}</altitudeMode>
					<coordinates>{{longitude}},{{latitude}},{{altitudeKmlMeters}}</coordinates>
				</Point>
			</Placemark>
{{/waypoints}}
{{#includeFlightPath}}
{{#hasPath}}
			<Placemark>
				<name>{{name}} {{labels.flightPath}}</name>
				<styleUrl>#flightPath{{index}}</styleUrl>
				<LineString>
{{#extrudePath}}					<extrude>1</extrude>
{{/extrudePath}}{{#tessellatePath}}					<tessellate>1</tessellate>
{{/tessellatePath}}					<altitudeMode>{{kmlAltitudeMode}}</altitudeMode>
					<coordinates>
{{#path}}						{{longitude}},{{latitude}},{{altitudeKmlMeters}}
{{/path}}					</coordinates>
				</LineString>
			</Placemark>
{{/hasPath}}
{{/includeFlightPath}}
{{#includeGroundTrack}}
{{#hasPath}}
			<Placemark>
				<name>{{name}} {{labels.groundTrack}}</name>
				<styleUrl>#groundTrack{{index}}</styleUrl>
				<LineString>
					<tessellate>1</tessellate>
					<altitudeMode>clampToGround</altitudeMode>
					<coordinates>
{{#path}}						{{longitude}},{{latitude}},{{altitudeMslMeters}}
{{/path}}					</coordinates>
				</LineString>
			</Placemark>
{{/hasPath}}
{{/includeGroundTrack}}
		</Folder>
{{/branches}}
	</Document>
</kml>
`;

const GPX_TEMPLATE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OpenRocket" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>{{title}}</name>
  </metadata>
{{#branches}}
{{#waypoints}}
  <wpt lat="{{latitude}}" lon="{{longitude}}">
    <ele>{{altitudeMslMeters}}</ele>
    <name>{{label}}</name>
  </wpt>
{{/waypoints}}
{{/branches}}
{{#branches}}
{{#hasPath}}
  <trk>
    <name>{{name}}</name>
    <trkseg>
{{#path}}    <trkpt lat="{{latitude}}" lon="{{longitude}}"><ele>{{altitudeMslMeters}}</ele></trkpt>
{{/path}}    </trkseg>
  </trk>
{{/hasPath}}
{{/branches}}
</gpx>
`;

// CRLF line endings, matching the app's other CSV exports (Excel-friendly).
const WAYPOINTS_CSV_TEMPLATE_SOURCE =
  '"altitude({{altitudeUnit}})","latitude","longitude","label","symbol","color","label_color","name"\r\n' +
  '{{#branches}}{{#waypoints}}"{{altitude}}","{{latitudeStr}}","{{longitudeStr}}","{{type}}","pushpin","yellow","white","{{rocketName}} {{motor}} {{label}} - {{altitude}} {{altitudeUnit}} - {{distance}} {{distanceUnit}} @ {{bearing}} deg"\r\n' +
  '{{/waypoints}}{{/branches}}\r\n';

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: 'kml',
    extension: 'kml',
    mime: 'application/vnd.google-earth.kml+xml',
    render: renderKml,
    source: KML_TEMPLATE_SOURCE,
    templateFilename: 'flightpath.kml.mustache',
  },
  {
    id: 'gpx',
    extension: 'gpx',
    mime: 'application/gpx+xml',
    render: renderGpx,
    source: GPX_TEMPLATE_SOURCE,
    templateFilename: 'flightpath.gpx.mustache',
  },
  {
    id: 'waypoints-csv',
    extension: 'csv',
    mime: 'text/csv;charset=utf-8',
    render: renderWaypointCsv,
    source: WAYPOINTS_CSV_TEMPLATE_SOURCE,
    templateFilename: 'waypoints.csv.mustache',
  },
];

/**
 * True when the design carries a launch position the export can use as-is.
 * False means {@link buildFlightPathModel} substitutes the Kennedy Space
 * Center, which the dialog warns about.
 */
export function hasLaunchPosition(launch: LaunchConditions): boolean {
  return !launchPositionUnset(launch);
}

// ---------------------------------------------------------------------------
// User-supplied Mustache templates
// ---------------------------------------------------------------------------

/** Choose the value escaper by output extension (mirrors the desktop exporter). */
function escaperFor(extension: string): (raw: string) => string {
  switch (extension.toLowerCase()) {
    case 'kml':
    case 'gpx':
    case 'xml':
      return (raw) =>
        raw
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
    case 'csv':
      // Neutralize spreadsheet formula injection: a file-sourced value (e.g. a
      // rocket named `=HYPERLINK(...)`) must not execute when the CSV is opened
      // in Excel/Sheets. Prefix a `'` when it leads with a formula trigger, then
      // double quotes for RFC-4180 (the template wraps values in quotes).
      //
      // A leading `-` is a trigger only when what follows is not a number: the
      // pre-formatted numeric fields (longitude, altitude, distance) go through
      // this same escaper, and quoting `-80.600000` turned every
      // western-hemisphere longitude and every below-pad altitude into text.
      return (raw) => (/^[=+@\t\r]|^-(?![\d.])/.test(raw) ? `'${raw}` : raw).replace(/"/g, '""');
    default:
      return (raw) => raw;
  }
}

/** Best-effort MIME type for a downloaded export file, by extension. */
export function mimeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case 'kml':
      return 'application/vnd.google-earth.kml+xml';
    case 'gpx':
      return 'application/gpx+xml';
    case 'csv':
      return 'text/csv;charset=utf-8';
    case 'xml':
      return 'application/xml;charset=utf-8';
    case 'json':
      return 'application/json;charset=utf-8';
    default:
      return 'text/plain;charset=utf-8';
  }
}

/**
 * Render a user-supplied Mustache template against the model, escaping values by
 * the output extension. The model uses the same field names as OpenRocket's
 * desktop `FlightPathModel`, so existing OpenRocket export templates render
 * verbatim. Only the rendered text is ever downloaded — never injected into the
 * DOM — so a template cannot script the app.
 */
export function renderUserTemplate(source: string, extension: string, model: FlightPathModel): string {
  // Mustache.escape is a module-level hook; set it for this synchronous render
  // and restore it so concurrent callers/formats are unaffected.
  const previous = Mustache.escape;
  Mustache.escape = escaperFor(extension);
  try {
    return Mustache.render(source, model);
  } finally {
    Mustache.escape = previous;
  }
}
