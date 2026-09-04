import Mustache from 'mustache';
import type { FlightResult, FlightEvent, FlightSeries } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';

/**
 * Templated flight-path export — a TypeScript port of OpenRocket's
 * `info.openrocket.core.file.flightpath` subsystem (KML / GPX / waypoint CSV).
 *
 * The desktop version reads latitude/longitude straight from the simulated
 * flight (OpenRocket derives them from the launch position during the run). Our
 * engine ships only the lateral drift (`Px` east, `Py` north, metres from the
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
}

/** Default options: every waypoint, both tracks, keep all points, metric. */
export function defaultExportOptions(): FlightPathExportOptions {
  return {
    waypoints: new Set(WAYPOINT_KINDS),
    includeFlightPath: true,
    includeGroundTrack: true,
    pathStride: 1,
    altitudeUnit: 'm',
    distanceUnit: 'm',
  };
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
  altitudeMslMeters: number;
  time: number;
  timeStr: string;
  altitude: string; // above the pad, display unit
  altitudeMsl: string; // above sea level, display unit
  distance: string; // horizontal distance from pad, display unit
  bearing: string; // compass degrees from pad
}

export interface FlightPathPoint {
  latitude: number;
  longitude: number;
  altitudeMslMeters: number;
  time: number;
  timeStr: string;
  altitude: string;
}

export interface FlightPathBranch {
  name: string;
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
/** Metres → unit multiplier. */
const UNIT_FACTOR: Record<DistanceUnit, number> = { m: 1, ft: 3.280839895, km: 0.001, mi: 0.000621371192 };
/** Decimals shown per unit (larger units get more). */
const UNIT_DECIMALS: Record<DistanceUnit, number> = { m: 1, ft: 1, km: 3, mi: 3 };

/** Render a metres value in the given unit, without the unit symbol. */
function fmtLength(meters: number, unit: DistanceUnit): string {
  if (!Number.isFinite(meters)) return '';
  return (meters * UNIT_FACTOR[unit]).toFixed(UNIT_DECIMALS[unit]);
}

// ---------------------------------------------------------------------------
// Geographic projection
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000; // spherical Earth (OpenRocket's default model)

// ---------------------------------------------------------------------------
// Model builder (mirrors FlightPathModelBuilder)
// ---------------------------------------------------------------------------

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const series = (s: FlightSeries, key: string): (number | null)[] | undefined => s[key] as (number | null)[] | undefined;

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
  const lat0 = launch.latitudeDeg ?? 0;
  const lon0 = launch.longitudeDeg ?? 0;
  const launchAlt = launch.launchAltitudeM ?? 0;
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  // Guard the poles (cos → 0): fall back to no east/west projection.
  const lonScale = Math.abs(cosLat0) < 1e-9 ? 0 : 1 / (EARTH_RADIUS_M * cosLat0);

  const toLat = (north: number): number => lat0 + ((north / EARTH_RADIUS_M) * 180) / Math.PI;
  const toLon = (east: number): number => lon0 + (east * lonScale * 180) / Math.PI;

  const model: FlightPathModel = {
    title: meta.simName,
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
    maxAltitude: fmtLength(result.summary.maxAltitude, options.altitudeUnit),
    maxVelocity: result.summary.maxVelocity.toFixed(1),
    maxAcceleration: result.summary.maxAcceleration.toFixed(1),
    branches: [],
  };

  // Staged flights carry per-branch data (branch 0 = sustainer stack); a single
  // flight is exported as one synthetic branch from the top-level series.
  const rawBranches =
    result.branches && result.branches.length
      ? result.branches
      : [{ name: meta.rocketName || meta.simName || 'Flight', events: result.events, series: result.series }];

  for (const raw of rawBranches) {
    const branch = buildBranch(raw, options, waypointLabel, {
      toLat,
      toLon,
      launchAlt,
      altUnit: options.altitudeUnit,
      distUnit: options.distanceUnit,
    });
    if (branch) model.branches.push(branch);
  }
  return model;
}

interface BranchCtx {
  toLat: (north: number) => number;
  toLon: (east: number) => number;
  launchAlt: number;
  altUnit: DistanceUnit;
  distUnit: DistanceUnit;
}

function buildBranch(
  raw: { name: string; events: FlightEvent[]; series: FlightSeries },
  options: FlightPathExportOptions,
  waypointLabel: (kind: WaypointKind) => string,
  ctx: BranchCtx,
): FlightPathBranch | null {
  const time = series(raw.series, 'time');
  const alt = series(raw.series, 'altitude');
  if (!time || !alt || time.length === 0) return null;

  const east = series(raw.series, 'Px'); // lateral drift east (m)
  const north = series(raw.series, 'Py'); // lateral drift north (m)
  const vel = series(raw.series, 'velocity');
  const acc = series(raw.series, 'acceleration');
  const n = Math.min(time.length, alt.length);

  const eastAt = (i: number) => num(east?.[i]);
  const northAt = (i: number) => num(north?.[i]);
  const distanceAt = (i: number) => Math.hypot(eastAt(i), northAt(i));
  const bearingAt = (i: number) => {
    const deg = (Math.atan2(eastAt(i), northAt(i)) * 180) / Math.PI;
    return (deg + 360) % 360;
  };

  const mkWaypoint = (i: number, type: WaypointKind, label: string, device: string | null): FlightPathWaypoint => {
    const altAgl = num(alt[i]);
    const latitude = ctx.toLat(northAt(i));
    const longitude = ctx.toLon(eastAt(i));
    const mslMeters = altAgl + ctx.launchAlt;
    const t = num(time[i]);
    return {
      type,
      label,
      device: device ?? '',
      latitude,
      longitude,
      latitudeStr: latitude.toFixed(6),
      longitudeStr: longitude.toFixed(6),
      altitudeMslMeters: mslMeters,
      time: t,
      timeStr: t.toFixed(2),
      altitude: fmtLength(altAgl, ctx.altUnit),
      altitudeMsl: fmtLength(mslMeters, ctx.altUnit),
      distance: fmtLength(distanceAt(i), ctx.distUnit),
      bearing: bearingAt(i).toFixed(0),
    };
  };

  const branch: FlightPathBranch = { name: raw.name, waypoints: [], path: [], hasPath: false, hasWaypoints: false };

  if (options.waypoints.has('pad')) {
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

  if (options.waypoints.has('maxvelocity') && vel && vel.length) {
    branch.waypoints.push(
      mkWaypoint(indexOfMax(vel, Math.min(n, vel.length)), 'maxvelocity', waypointLabel('maxvelocity'), null),
    );
  }
  if (options.waypoints.has('maxacceleration') && acc && acc.length) {
    branch.waypoints.push(
      mkWaypoint(indexOfMax(acc, Math.min(n, acc.length)), 'maxacceleration', waypointLabel('maxacceleration'), null),
    );
  }

  branch.waypoints.sort((a, b) => a.time - b.time);

  if (options.includeFlightPath || options.includeGroundTrack) {
    const stride = Math.max(1, options.pathStride);
    const pushPoint = (i: number) => {
      const altAgl = num(alt[i]);
      const t = num(time[i]);
      branch.path.push({
        latitude: ctx.toLat(northAt(i)),
        longitude: ctx.toLon(eastAt(i)),
        altitudeMslMeters: altAgl + ctx.launchAlt,
        time: t,
        timeStr: t.toFixed(2),
        altitude: fmtLength(altAgl, ctx.altUnit),
      });
    };
    for (let i = 0; i < n; i += stride) pushPoint(i);
    // Always include the final point so the track ends at landing.
    if (n > 0 && (n - 1) % stride !== 0) pushPoint(n - 1);
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
    const diff = Math.abs(num(time[i]) - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

function indexOfMax(values: (number | null)[], n: number): number {
  let maxIndex = 0;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
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
    <Style id="flightPath"><LineStyle><color>ffff0000</color><width>3</width></LineStyle></Style>
    <Style id="groundTrack"><LineStyle><color>ff000000</color><width>2</width></LineStyle></Style>
{{#branches}}
    <Folder>
      <name>{{name}}</name>
{{#waypoints}}
      <Placemark>
        <name>{{label}}</name>
        <Point>
          <altitudeMode>absolute</altitudeMode>
          <coordinates>{{longitude}},{{latitude}},{{altitudeMslMeters}}</coordinates>
        </Point>
      </Placemark>
{{/waypoints}}
{{#includeFlightPath}}
{{#hasPath}}
      <Placemark>
        <name>{{name}} flight path</name>
        <styleUrl>#flightPath</styleUrl>
        <LineString>
          <extrude>0</extrude>
          <tessellate>1</tessellate>
          <altitudeMode>absolute</altitudeMode>
          <coordinates>
{{#path}}          {{longitude}},{{latitude}},{{altitudeMslMeters}}
{{/path}}          </coordinates>
        </LineString>
      </Placemark>
{{/hasPath}}
{{/includeFlightPath}}
{{#includeGroundTrack}}
{{#hasPath}}
      <Placemark>
        <name>{{name}} ground track</name>
        <styleUrl>#groundTrack</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>
{{#path}}          {{longitude}},{{latitude}},{{altitudeMslMeters}}
{{/path}}          </coordinates>
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

/** True when the launch site is at (0,0) — the exported track lands on Null Island. */
export function hasLaunchPosition(launch: LaunchConditions): boolean {
  return (launch.latitudeDeg ?? 0) !== 0 || (launch.longitudeDeg ?? 0) !== 0;
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
      return (raw) => raw.replace(/"/g, '""');
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
