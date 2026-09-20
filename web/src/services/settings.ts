import type { PartKey } from './partColors';
import type { CompleteLaunch } from './requiredLaunch';
import { DEFAULT_CSV_COLUMNS } from './flightColumns';
import {
  METRIC_UNITS,
  UNIT_CHOICES,
  type UnitChoice,
  normalizeUnitOverrides,
  normalizeUnits,
  type UnitOverrides,
  type UnitSelection,
} from '../prefs/units';

/**
 * Bounds for the component-tree column (see `Settings.treePaneWidth`).
 *
 * The minimum is where the design actions stop fitting on one row: they need
 * about 253px and the column spends 32 on padding. It was 320, when that
 * padding was 48. The maximum is judgment - past it the names have long since
 * stopped truncating.
 */
export const TREE_PANE_MIN = 300;
export const TREE_PANE_MAX = 640;
export const TREE_PANE_DEFAULT = 360;

/**
 * Bounds for the right-hand column (see `Settings.sidePaneWidth`).
 *
 * The minimum is where the Results tiles stop working: they are a 3-up grid, and
 * narrower than this "Static margin @ rail exit" wraps onto three lines.
 */
export const SIDE_PANE_MIN = 300;
export const SIDE_PANE_MAX = 640;
export const SIDE_PANE_DEFAULT = 380;

/** What the center pane keeps, whichever divider is being dragged. */
export const CENTER_PANE_MIN = 320;

/** A stored column width, forced back into the usable range. */
const clampPane = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;

const clampTreePane = (v: unknown): number => clampPane(v, TREE_PANE_MIN, TREE_PANE_MAX, TREE_PANE_DEFAULT);
const clampSidePane = (v: unknown): number => clampPane(v, SIDE_PANE_MIN, SIDE_PANE_MAX, SIDE_PANE_DEFAULT);

// Sea-level, calm, standard-atmosphere defaults (Cape Canaveral latitude).
const DEFAULT_LAUNCH: CompleteLaunch = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  launchRodDirectionDeg: 90,
  launchIntoWind: false,
  windAverage: 0,
  windStdDev: 0,
  windDirectionDeg: 90,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  temperatureC: null,
  pressureHPa: null,
  geodetic: 'spherical',
};

/**
 * App-wide user preferences (not tied to a design): 3D part-color overrides,
 * flight-path phase colors, and the default playback speed. Persisted to
 * localStorage synchronously so the very first render already has the user's
 * choices. Consumed reactively via the SettingsProvider / useSettings hook.
 */
/** Global simulation preferences (OpenRocket's Simulation prefs), applied to every run. */
export interface SimulationSettings {
  /** RK4 integration step (s) — smaller is more accurate but slower. OR default 0.05. */
  timeStep: number;
  /** Cap on simulated flight time (s) — ends a run that never lands. OR default 1200. */
  maxTime: number;
  /**
   * The most the rocket may rotate in one RK4 step, RADIANS. The stepper
   * shortens dt to respect it, so this buys accuracy through a fast pitch-over
   * without paying for it over the whole coast. OR default: 3 degrees.
   */
  maxAngleStep: number;
  /** Fixed seed for wind-turbulence reproducibility; null = random each run. */
  randomSeed: number | null;
  /** Ask for confirmation before deleting a simulation. */
  confirmDelete: boolean;
  /** Auto-run an outdated simulation when its results view is opened. */
  autoRunOutdated: boolean;
  /**
   * Recovery-deployment speed (m/s) at/above which a SINGLE-deployment recovery
   * is too fast (zippering / hardware damage). Below = green.
   *
   * Drives two things that used to disagree: the deploy-speed tile's color, and
   * the kernel's own deployment warning — which ran on its own hard-coded 20 m/s
   * until this was passed through, so moving this slider changed the tile and
   * nothing else.
   */
  deploymentSpeedWarn: number;
  /**
   * Dual-deployment (a stage carrying a drogue) uses these for the MAIN instead
   * of `deploymentSpeedWarn`: out too fast risks the same damage, out too slow
   * means a long descent and a long walk. OpenRocket's defaults are 100 ft/s and
   * 50 ft/s, which is where these SI values come from.
   */
  mainHighSpeedWarn: number;
  mainLowSpeedWarn: number;
  /**
   * Dual deployment, the DROGUE side: at apogee the rocket is barely moving, and
   * a drogue let out below this speed may never see enough airflow to inflate.
   * OpenRocket's default is 10 ft/s, hence 3.048.
   *
   * Upstream ships this check commented out; PATCH(drogue-low-speed) in
   * `BasicEventSimulationEngine` enables it, so the value is read rather than
   * merely carried. Like the two main thresholds it only applies when the
   * deploying stage actually has a device marked as a drogue.
   */
  drogueLowSpeedWarn: number;
  /** Minimum safe rod/rail-exit velocity (m/s): the rod-exit tile is green at or
   *  above this, and warns below it (too slow to be stable off the rail). */
  railExitVelocityMin: number;
}

/** Which sides of the 2D side view carry a measurement ruler. */
export interface RulerSides {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export interface Settings {
  /** The unit each quantity DEFAULTS to, as set in Settings ▸ Units. The tree,
   *  the kernel and every saved file stay SI — this is a display/entry
   *  preference only. */
  units: UnitSelection;
  /** Units changed from an inline unit chip. A separate layer over `units` so a
   *  chip never rewrites the defaults chosen in the dialog; see UnitOverrides. */
  unitOverrides: UnitOverrides;
  /** Per-group color overrides for the 3D model (empty = built-in defaults). */
  partColors: Partial<Record<PartKey, string>>;
  /** Flight-path phase colors. */
  phaseColors: { boost: string; coast: string; descent: string };
  /**
   * How the Aero tables shade their cells.
   *
   * `sky` is one hue that strengthens with the value — a magnitude ramp, which
   * is what the numbers are. `openrocket` is desktop OpenRocket's green-to-red
   * heat, on its own absolute Cd scale and with dark text on light cells, for
   * anyone who reads that faster because they already know it.
   */
  aeroHeat: 'sky' | 'openrocket';
  /** Default flight-path playback speed (×). */
  playbackSpeed: number;
  /** Global simulation preferences. */
  simulation: SimulationSettings;
  /** Default launch conditions for newly-created simulations. */
  /**
   * What a NEW simulation is seeded from, so it is always COMPLETE: the six
   * required launch fields can be blank on a simulation (a cleared field has
   * to be distinguishable from a typed zero) but never here, or every future
   * simulation would start with a hole. The sanitizer below repairs a blank
   * back to the built-in default, and the Settings panel refuses to store one.
   */
  launchDefaults: CompleteLaunch;
  /** Show the CG / CP / margin markers on the 2D & 3D views. */
  showMarkers: boolean;
  /** Show the length · mass · CG · CP · stability info card on the 2D & 3D views. */
  showInfoCard: boolean;
  /** Expand the "All stats" strip under the canvas (collapsed = just its header). */
  showStats: boolean;
  /**
   * Expand the import notes on the loaded-design card (collapsed = just the
   * warning count).
   *
   * Deliberately app-wide rather than per design: it is a reading habit - you
   * either want to see what a file could not bring across or you have stopped
   * caring - and a per-design flag would mean re-collapsing the notes on every
   * `.ork` you open. There is nothing to key it to either, since a design that
   * has not been saved has no stable identity.
   */
  showImportNotes: boolean;
  /**
   * Width of the Design tab's component-tree column, in CSS pixels.
   *
   * The column carries two layers of padding before anything is drawn, so it
   * gives its contents 32px less than this. TREE_PANE_MIN is what the + Stage /
   * + Add / Scale row needs to stay one row; above TREE_PANE_MAX the tree is
   * mostly empty gutter. The splitter also caps itself against the window at
   * drag time, so a width stored on a wide monitor cannot crush the center pane
   * on a narrow one.
   */
  treePaneWidth: number;
  /**
   * Width of the right-hand column, in CSS pixels.
   *
   * ONE width for all three of them - the part editor, the simulation editor and
   * the run's numbers. They were a matching 380 on purpose: right columns of
   * different widths read as an accident rather than as a choice, and that stays
   * true when the width becomes the user's. Sizing it on any tab sizes it on all
   * of them.
   */
  sidePaneWidth: number;
  /**
   * Give the whole window to the center pane, hiding both side columns.
   *
   * An airframe is 15-25x longer than it is wide, so the drawing is starved of
   * horizontal space long before it is starved of vertical: dropping the tree
   * and the property editor is worth about 750px of a 1500px window. The static
   * statistics strip goes too - it is a footer about the design rather than part
   * of the drawing, and it was spending 175px of height on the expand. It
   * applies only on the tabs the center pane is actually on - on Simulations the
   * flag is ignored, or the simulation editor would hide with no toolbar left to
   * bring it back from.
   */
  maximizeCenter: boolean;
  /** Which sides of the 2D side view are framed by a measurement ruler. */
  rulers: RulerSides;
  /** Write the derived <designinfo> statistics block into saved .ork files. Off
   *  by default, so a normal save is byte-identical to before. */
  saveDesignInfo: boolean;
  /** PDF report / template output preferences. */
  report: ReportSettings;
  /** Flight-path export preferences that outlive one export. */
  pathExport: PathExportSettings;
  /**
   * Which flight-chart panels are open, by series key (`altitude`, `thrust`…).
   *
   * A preference rather than component state: the panels you read are a working
   * habit, not a property of one flight, and re-ticking thrust and mass on every
   * visit to the Results tab is the kind of friction nobody reports. The chart
   * owns the list of legal keys and ignores any it does not know, so a value
   * saved by a later version (or hand-edited) cannot blank the view.
   *
   * Empty is allowed and means every panel closed - a deliberate state, since
   * the chips are how you get one back.
   */
  flightSeries: string[];
  /**
   * How the flight CSV is written, remembered between exports the way
   * OpenRocket's export panel remembers its own
   * (`CsvOptionPanel.storePreferences`).
   *
   * Columns are stored by series key. Keys this build cannot fill are dropped at
   * export time rather than here, so a list written by another version costs a
   * column instead of breaking the dialog.
   */
  flightCsv: {
    columns: string[];
    separator: string;
    decimals: number;
    exponential: boolean;
    simDescription: boolean;
    fieldDescriptions: boolean;
    flightEvents: boolean;
    commentChar: string;
  };
  /** Whether the user has dismissed the pre-1.0 "work in progress" notice. */
  wipAcknowledged: boolean;
}

/** Persistent output options for the PDF report (the "Settings" sub-dialog). */
export interface ReportSettings {
  /** Which units the report and the design CSV are written in. `current` follows
   *  the app's units; the other two pin the document to a system regardless of
   *  what the app is showing, which is what you want when it is for someone
   *  else. Absent/unknown reads as `current`. */
  units: UnitChoice;
  /** Template fill color (hex), or '' for outline only. */
  templateFill: string;
  /** Template border color (hex). */
  templateStroke: string;
  /** Page size. */
  paper: 'letter' | 'a4';
  /** Page orientation. */
  orientation: 'portrait' | 'landscape';
}

/**
 * The flight-path export options that outlive one export.
 *
 * This used to be one boolean, on the reasoning that everything else in that
 * dialog describes THIS export and a stale value silently mislabels the next
 * file. That reasoning still holds for exactly one field - the MISSION NAME,
 * which is still deliberately not persisted - and it was over-applied to the
 * rest: which waypoints you want, what units you export in and what colors
 * your stages are is a working habit, and re-picking them on every export is
 * the kind of friction nobody reports.
 *
 * The per-stage colors carry a known consequence, accepted deliberately. They
 * are keyed by the stage's INDEX in the flight data, not by name, because two
 * stages of one rocket can share a name and name-keying would silently make
 * them share a color. So colors restored from here land on whatever stage now
 * occupies index 0, which may be a different rocket entirely. That is the
 * point: the reason to remember colors is a consistent look across exports.
 *
 * Every field is optional-by-validation on load: an older store, a newer one,
 * or a hand-edited one costs at most the field it broke.
 */
export interface PathExportSettings {
  /** Whether the mission name prefixes the waypoint markers as well as the
   *  folder and track names. "Do I want my markers prefixed" is a habit; the
   *  mission name itself is not, and is not stored. */
  labelWaypointsWithMission: boolean;
  /** Which waypoint kinds to emit, by key. Unknown keys are dropped at export
   *  time rather than here, so a list from another build costs a marker. */
  waypoints?: string[];
  includeFlightPath?: boolean;
  includeGroundTrack?: boolean;
  /** Keep every Nth path point. A positive integer. */
  pathStride?: number;
  /**
   * Export units. ABSENT means "follow the app's distance preference", which
   * is what a fresh install does; a stored value is an explicit choice made in
   * the dialog and outranks the app units, because the whole point of the
   * control is exporting in something other than what you are looking at.
   */
  altitudeUnit?: string;
  distanceUnit?: string;
  altitudeReference?: string;
  waypointAltitudeReference?: string;
  drawShadow?: boolean;
  stageTrackStart?: string;
  showWaypointLabels?: boolean;
  colorWaypointPins?: boolean;
  /**
   * Per-stage color overrides, one map per role, each keyed by stage index and
   * valued `rrggbb`. SPARSE: only stages the user actually changed appear, so
   * an untouched install stores three empty objects, the stored form never has
   * to know how many stages exist, and a palette change later does not strand
   * saved values. A dense form would need a placeholder for "default", which
   * is the sentinel problem that absence already solves.
   */
  branchColors?: Record<string, string>;
  branchGroundColors?: Record<string, string>;
  branchPinColors?: Record<string, string>;
}

const DEFAULT_PATH_EXPORT: PathExportSettings = {
  labelWaypointsWithMission: false,
};

/** A sparse index-keyed color map as `{ "0": "112233" }`. */
export function encodeStageColors(colors: Map<number, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [index, rgb] of colors) {
    out[String(index)] = (rgb & 0xffffff).toString(16).padStart(6, '0');
  }
  return out;
}

/**
 * Back to a Map, skipping anything malformed.
 *
 * Tolerant on purpose: this store is hand-editable and readable by older and
 * newer builds, and a bad pair should cost one stage's color rather than the
 * whole settings object. Sparseness makes that cheap - a dropped entry just
 * means that stage falls back to its palette, which is always a valid state.
 */
export function decodeStageColors(value: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const index = Number.parseInt(key, 10);
    if (!Number.isInteger(index) || index < 0) continue;
    if (typeof raw !== 'string' || !/^[0-9a-fA-F]{6}$/.test(raw)) continue;
    out.set(index, Number.parseInt(raw, 16) & 0xffffff);
  }
  return out;
}

export const DEFAULT_REPORT: ReportSettings = {
  units: 'current',
  templateFill: '',
  templateStroke: '#111827',
  paper: 'letter',
  orientation: 'portrait',
};

/** Playback rate: a real, positive multiplier within a usable range. */
const clampPlayback = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.min(10, Math.max(0.05, v))
    : DEFAULT_SETTINGS.playbackSpeed;

export const DEFAULT_SETTINGS: Settings = {
  units: METRIC_UNITS,
  unitOverrides: {},
  partColors: {},
  phaseColors: { boost: '#fb923c', coast: '#38bdf8', descent: '#34d399' },
  aeroHeat: 'sky',
  playbackSpeed: 0.5,
  simulation: {
    timeStep: 0.05,
    maxTime: 1200,
    // The kernel's own RECOMMENDED_ANGLE_STEP (AbstractRKSimulationStepper),
    // which is what every run used before this was settable.
    maxAngleStep: (3 * Math.PI) / 180,
    randomSeed: null,
    confirmDelete: true,
    autoRunOutdated: false,
    deploymentSpeedWarn: 20,
    mainHighSpeedWarn: 30.48,
    mainLowSpeedWarn: 15.24,
    drogueLowSpeedWarn: 3.048,
    railExitVelocityMin: 15,
  },
  launchDefaults: DEFAULT_LAUNCH,
  showMarkers: true,
  showInfoCard: true,
  showStats: true,
  showImportNotes: true,
  treePaneWidth: TREE_PANE_DEFAULT,
  sidePaneWidth: SIDE_PANE_DEFAULT,
  maximizeCenter: false,
  rulers: { top: true, bottom: true, left: true, right: true },
  saveDesignInfo: false,
  report: DEFAULT_REPORT,
  pathExport: DEFAULT_PATH_EXPORT,
  // The three a flight is usually read by; the rest are one chip away.
  flightSeries: ['altitude', 'velocity', 'acceleration'],
  flightCsv: {
    // The named series, which is what a reader expects to find in the file.
    // Everything else the run records is one tick away in the dialog.
    columns: [...DEFAULT_CSV_COLUMNS],
    separator: ',',
    decimals: 3,
    exponential: false,
    simDescription: true,
    fieldDescriptions: true,
    flightEvents: true,
    commentChar: '#',
  },
  wipAcknowledged: false,
};

const KEY = 'astrarrocketjs:settings:v1';

/**
 * Validate the stored flight-path export block field by field.
 *
 * Every field is checked independently and a bad one falls back on its own, so
 * a store written by another build (or edited by hand) costs that field rather
 * than the dialog. The enum-ish fields are kept as strings here and checked
 * against the real union at the call site, which owns the legal values.
 */
function loadPathExport(raw: unknown): PathExportSettings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<PathExportSettings>;
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const colors = (v: unknown): Record<string, string> | undefined => {
    const m = decodeStageColors(v);
    return m.size ? encodeStageColors(m) : undefined;
  };
  const out: PathExportSettings = {
    labelWaypointsWithMission: bool(p.labelWaypointsWithMission) ?? DEFAULT_PATH_EXPORT.labelWaypointsWithMission,
  };
  if (Array.isArray(p.waypoints)) {
    out.waypoints = p.waypoints.filter((w): w is string => typeof w === 'string');
  }
  const assign = <K extends keyof PathExportSettings>(k: K, v: PathExportSettings[K]) => {
    if (v !== undefined) out[k] = v;
  };
  assign('includeFlightPath', bool(p.includeFlightPath));
  assign('includeGroundTrack', bool(p.includeGroundTrack));
  // A stride of 0 or a fraction would silently drop the path or never advance.
  if (typeof p.pathStride === 'number' && Number.isInteger(p.pathStride) && p.pathStride >= 1) {
    out.pathStride = p.pathStride;
  }
  assign('altitudeUnit', str(p.altitudeUnit));
  assign('distanceUnit', str(p.distanceUnit));
  assign('altitudeReference', str(p.altitudeReference));
  assign('waypointAltitudeReference', str(p.waypointAltitudeReference));
  assign('drawShadow', bool(p.drawShadow));
  assign('stageTrackStart', str(p.stageTrackStart));
  assign('showWaypointLabels', bool(p.showWaypointLabels));
  assign('colorWaypointPins', bool(p.colorWaypointPins));
  assign('branchColors', colors(p.branchColors));
  assign('branchGroundColors', colors(p.branchGroundColors));
  assign('branchPinColors', colors(p.branchPinColors));
  return out;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings> & { showRulers?: boolean };
    // Migrate the legacy single on/off flag → every side follows it; a saved
    // per-side object (if present) then wins over the migration.
    const legacyRulers =
      typeof s.showRulers === 'boolean'
        ? { top: s.showRulers, bottom: s.showRulers, left: s.showRulers, right: s.showRulers }
        : {};
    const savedRulers =
      s.rulers && typeof s.rulers === 'object'
        ? (Object.fromEntries(
            (['top', 'bottom', 'left', 'right'] as const)
              .filter((k) => typeof s.rulers![k] === 'boolean')
              .map((k) => [k, s.rulers![k]]),
          ) as Partial<RulerSides>)
        : {};
    return {
      // Unknown/absent symbols fall back per quantity, so an older store (which
      // has no `units` at all) keeps exactly the units it was displaying.
      units: normalizeUnits(s.units),
      unitOverrides: normalizeUnitOverrides(s.unitOverrides),
      // Filtered, not spread. These values reach a style attribute, which is
      // exactly the reasoning the treePaneWidth clamp below already states -
      // it just was not applied here, so any value type (an object, an array,
      // a CSS payload) rode straight through to the renderer.
      partColors: Object.fromEntries(
        Object.entries((s.partColors ?? {}) as Record<string, unknown>).filter(
          ([, v]) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v),
        ),
      ) as Partial<Record<PartKey, string>>,
      phaseColors: { ...DEFAULT_SETTINGS.phaseColors, ...(s.phaseColors ?? {}) },
      // An older store has no value here, and an unrecognized one falls back
      // rather than leaving the tables with a style nothing renders.
      aeroHeat: s.aeroHeat === 'openrocket' ? 'openrocket' : DEFAULT_SETTINGS.aeroHeat,
      // Clamped like every adjacent field. `typeof === 'number'` let
      // NaN, 0, Infinity and negatives through, and a stored NaN makes the
      // flight-playback clock never advance with no way back but clearing
      // storage - the same failure the treePaneWidth clamp was added for.
      playbackSpeed: clampPlayback(s.playbackSpeed),
      simulation: (() => {
        const sim = { ...DEFAULT_SETTINGS.simulation, ...(s.simulation ?? {}) };
        // A corrupt/hand-edited timeStep or maxTime ≤ 0 makes the RK4 loop
        // (maxTime/timeStep steps) hang or NaN — clamp back to the default.
        const pos = (v: number, d: number) => (Number.isFinite(v) && v > 0 ? v : d);
        sim.timeStep = pos(sim.timeStep, DEFAULT_SETTINGS.simulation.timeStep);
        sim.maxTime = pos(sim.maxTime, DEFAULT_SETTINGS.simulation.maxTime);
        // Zero or negative would make the stepper's dt go to zero or flip sign.
        sim.maxAngleStep = pos(sim.maxAngleStep, DEFAULT_SETTINGS.simulation.maxAngleStep);
        // These reach the kernel too, so the same guard applies.
        sim.deploymentSpeedWarn = pos(sim.deploymentSpeedWarn, DEFAULT_SETTINGS.simulation.deploymentSpeedWarn);
        sim.mainHighSpeedWarn = pos(sim.mainHighSpeedWarn, DEFAULT_SETTINGS.simulation.mainHighSpeedWarn);
        sim.mainLowSpeedWarn = pos(sim.mainLowSpeedWarn, DEFAULT_SETTINGS.simulation.mainLowSpeedWarn);
        sim.drogueLowSpeedWarn = pos(sim.drogueLowSpeedWarn, DEFAULT_SETTINGS.simulation.drogueLowSpeedWarn);
        return sim;
      })(),
      launchDefaults: (() => {
        // Same reasoning as the `simulation` block above, which has clamped for
        // exactly this reason: every field here reaches simConditions() and then
        // simulate() for each NEW simulation, unchecked. A hand-edited or
        // future-version blob putting a string, null or NaN where the engine
        // wants a number crossed straight into the kernel.
        //
        // The two nullable fields are left alone: `temperatureC` and
        // `pressureHPa` are `number | null` on purpose — null means "the ISA
        // standard atmosphere", which is a real answer, not a missing one.
        const l = { ...DEFAULT_SETTINGS.launchDefaults, ...(s.launchDefaults ?? {}) };
        // Split so the fallback keeps each field's own type: a required number
        // always gets a number back, an optional one may legitimately be absent.
        for (const k of [
          'launchRodLengthM',
          'launchRodAngleDeg',
          'windAverage',
          'windStdDev',
          'launchAltitudeM',
          'latitudeDeg',
        ] as const) {
          if (!Number.isFinite(l[k])) l[k] = DEFAULT_SETTINGS.launchDefaults[k];
        }
        for (const k of ['launchRodDirectionDeg', 'windDirectionDeg', 'longitudeDeg'] as const) {
          // Absent stays absent — only a PRESENT but unusable value falls back.
          if (l[k] !== undefined && !Number.isFinite(l[k])) l[k] = DEFAULT_SETTINGS.launchDefaults[k];
        }
        for (const k of ['temperatureC', 'pressureHPa'] as const) {
          const v = l[k];
          if (v !== null && !Number.isFinite(v)) l[k] = DEFAULT_SETTINGS.launchDefaults[k];
        }
        if (typeof l.launchIntoWind !== 'boolean' && l.launchIntoWind !== undefined) {
          l.launchIntoWind = DEFAULT_SETTINGS.launchDefaults.launchIntoWind;
        }
        if (l.geodetic !== undefined && !['flat', 'spherical', 'wgs84'].includes(l.geodetic)) {
          l.geodetic = DEFAULT_SETTINGS.launchDefaults.geodetic;
        }
        // Elements too, not just the array. Everything in this block
        // reaches simConditions() and then simulate() for each new simulation,
        // and `Array.isArray` let a stored [{altitudeM: "x", speed: null}]
        // walk straight into the kernel.
        if (l.windLevels !== undefined) {
          l.windLevels = Array.isArray(l.windLevels)
            ? l.windLevels.filter(
                (w: unknown) =>
                  !!w &&
                  typeof w === 'object' &&
                  ['altitudeM', 'speed', 'directionDeg', 'stddev'].every((k) =>
                    Number.isFinite((w as Record<string, unknown>)[k]),
                  ),
              )
            : DEFAULT_SETTINGS.launchDefaults.windLevels;
        }
        return l;
      })(),
      showMarkers: typeof s.showMarkers === 'boolean' ? s.showMarkers : DEFAULT_SETTINGS.showMarkers,
      showInfoCard: typeof s.showInfoCard === 'boolean' ? s.showInfoCard : DEFAULT_SETTINGS.showInfoCard,
      showStats: typeof s.showStats === 'boolean' ? s.showStats : DEFAULT_SETTINGS.showStats,
      showImportNotes: typeof s.showImportNotes === 'boolean' ? s.showImportNotes : DEFAULT_SETTINGS.showImportNotes,
      // Clamped rather than trusted: the value reaches a style attribute, and a
      // hand-edited or corrupted one would otherwise render a column of 0 or of
      // 90000 pixels with no way back but clearing storage.
      treePaneWidth: clampTreePane(s.treePaneWidth),
      sidePaneWidth: clampSidePane(s.sidePaneWidth),
      maximizeCenter: typeof s.maximizeCenter === 'boolean' ? s.maximizeCenter : DEFAULT_SETTINGS.maximizeCenter,
      rulers: { ...DEFAULT_SETTINGS.rulers, ...legacyRulers, ...savedRulers },
      saveDesignInfo: typeof s.saveDesignInfo === 'boolean' ? s.saveDesignInfo : DEFAULT_SETTINGS.saveDesignInfo,
      report: (() => {
        const r = { ...DEFAULT_REPORT, ...(s.report ?? {}) };
        // A hand-edited or future-version choice falls back rather than being
        // handed to resolveUnitChoice, where it would silently mean `current`.
        if (!UNIT_CHOICES.includes(r.units)) r.units = DEFAULT_REPORT.units;
        return r;
      })(),
      pathExport: loadPathExport(s.pathExport),
      // Strings only. The chart filters to the keys it actually has, so an
      // unknown one is dropped there rather than being guessed at here.
      flightSeries: Array.isArray(s.flightSeries)
        ? s.flightSeries.filter((x): x is string => typeof x === 'string')
        : DEFAULT_SETTINGS.flightSeries,
      flightCsv: (() => {
        const c = { ...DEFAULT_SETTINGS.flightCsv, ...(s.flightCsv ?? {}) };
        c.columns = Array.isArray(c.columns)
          ? c.columns.filter((x): x is string => typeof x === 'string')
          : DEFAULT_SETTINGS.flightCsv.columns;
        // A hand-edited count would otherwise reach `toFixed`, which throws
        // outside 0..100 and would take the whole export down with it.
        c.decimals = Number.isFinite(c.decimals) ? Math.min(Math.max(Math.round(c.decimals), 0), 12) : 3;
        if (typeof c.separator !== 'string' || !c.separator) c.separator = ',';
        if (typeof c.commentChar !== 'string' || !c.commentChar) c.commentChar = '#';
        return c;
      })(),
      wipAcknowledged: typeof s.wipAcknowledged === 'boolean' ? s.wipAcknowledged : DEFAULT_SETTINGS.wipAcknowledged,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage disabled */
  }
}
