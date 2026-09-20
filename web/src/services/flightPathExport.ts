import Mustache from 'mustache';
import type { FlightResult, FlightEvent, FlightSeries } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';

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
  timeStr: string;
  altitude: string; // above the pad, display unit
  altitudeMsl: string; // above sea level, display unit
  distance: string; // horizontal distance from pad, display unit
  bearing: string; // compass degrees from pad
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
  altitudeUnit: string;
  distanceUnit: string;
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
 * @param waypointLabel resolves a localized label for a waypoint kind
 */
export function buildFlightPathModel(
  result: FlightResult,
  launch: LaunchConditions,
  meta: FlightPathMeta,
  options: FlightPathExportOptions,
  waypointLabel: (kind: WaypointKind) => string,
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
    altitudeUnit: UNIT_SYMBOL[options.altitudeUnit],
    distanceUnit: UNIT_SYMBOL[options.distanceUnit],
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
    branches: [],
  };

  const rawBranches = rawBranchesOf(result, meta);

  // Only a staged flight needs its waypoints qualified — see `qualifyLabel`.
  const qualify = rawBranches.length > 1;

  for (const [i, raw] of rawBranches.entries()) {
    const branch = buildBranch(raw, options, waypointLabel, {
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
  waypointLabel: (kind: WaypointKind) => string,
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
      altitude: fmtLength(altAgl, ctx.altUnit),
      altitudeMsl: fmtLength(mslMeters, ctx.altUnit),
      distance: fmtLength(distanceAt(i), ctx.distUnit),
      bearing: bearingAt(i).toFixed(0),
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
  };

  // Only the stack leaves the pad; a booster's copy of that moment is not its
  // own event, and emitting it per stage litters the map with duplicate pins.
  if (ctx.primary && options.waypoints.has('pad')) {
    branch.waypoints.push(mkWaypoint(0, 'pad', waypointLabel('pad'), null));
  }

  for (const event of raw.events) {
    const kind = EVENT_TO_WAYPOINT[event.type];
    if (!kind || !options.waypoints.has(kind)) continue;
    const i = indexOfTime(time, event.time, n);
    if (kind === 'recovery') {
      const device = event.source ?? '';
      const label = device || waypointLabel('recovery');
      branch.waypoints.push(mkWaypoint(i, 'recovery', label, device));
    } else {
      branch.waypoints.push(mkWaypoint(i, kind, waypointLabel(kind), null));
    }
  }

  // Scanned from the separation point so a spent booster reports its own peaks.
  // Scanning the copied ascent instead labels the whole stack's maxima as the
  // booster's, at speeds it reached while still bolted to the sustainer.
  if (options.waypoints.has('maxvelocity') && vel && vel.length) {
    branch.waypoints.push(
      mkWaypoint(indexOfMax(vel, start, Math.min(n, vel.length)), 'maxvelocity', waypointLabel('maxvelocity'), null),
    );
  }
  if (options.waypoints.has('maxacceleration') && acc && acc.length) {
    branch.waypoints.push(
      mkWaypoint(
        indexOfMax(acc, start, Math.min(n, acc.length)),
        'maxacceleration',
        waypointLabel('maxacceleration'),
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
const KML_TEMPLATE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
	<Document>
		<name>{{title}}</name>
		<open>1</open>
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
{{#waypoints}}
			<Placemark>
				<name>{{qualifiedLabel}}</name>
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
				<name>{{name}} flight path</name>
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
				<name>{{name}} ground track</name>
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
