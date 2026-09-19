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
 * The flight-path export options that are a working preference rather than a
 * property of one file. Everything else that dialog offers — the mission name,
 * the per-stage colors, the placement — describes THIS export and starts fresh
 * each time: a stale one silently mislabels the next file.
 */
export interface PathExportSettings {
  /** Whether the mission name prefixes the waypoint markers as well as the
   *  folder and track names. "Do I want my markers prefixed" is a habit; the
   *  mission name itself is not. */
  labelWaypointsWithMission: boolean;
}

export const DEFAULT_PATH_EXPORT: PathExportSettings = {
  labelWaypointsWithMission: false,
};

export const DEFAULT_REPORT: ReportSettings = {
  units: 'current',
  templateFill: '',
  templateStroke: '#111827',
  paper: 'letter',
  orientation: 'portrait',
};

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
      partColors: { ...(s.partColors ?? {}) },
      phaseColors: { ...DEFAULT_SETTINGS.phaseColors, ...(s.phaseColors ?? {}) },
      // An older store has no value here, and an unrecognized one falls back
      // rather than leaving the tables with a style nothing renders.
      aeroHeat: s.aeroHeat === 'openrocket' ? 'openrocket' : DEFAULT_SETTINGS.aeroHeat,
      playbackSpeed: typeof s.playbackSpeed === 'number' ? s.playbackSpeed : DEFAULT_SETTINGS.playbackSpeed,
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
        if (l.windLevels !== undefined && !Array.isArray(l.windLevels)) {
          l.windLevels = DEFAULT_SETTINGS.launchDefaults.windLevels;
        }
        return l;
      })(),
      showMarkers: typeof s.showMarkers === 'boolean' ? s.showMarkers : DEFAULT_SETTINGS.showMarkers,
      showInfoCard: typeof s.showInfoCard === 'boolean' ? s.showInfoCard : DEFAULT_SETTINGS.showInfoCard,
      showStats: typeof s.showStats === 'boolean' ? s.showStats : DEFAULT_SETTINGS.showStats,
      showImportNotes: typeof s.showImportNotes === 'boolean' ? s.showImportNotes : DEFAULT_SETTINGS.showImportNotes,
      rulers: { ...DEFAULT_SETTINGS.rulers, ...legacyRulers, ...savedRulers },
      saveDesignInfo: typeof s.saveDesignInfo === 'boolean' ? s.saveDesignInfo : DEFAULT_SETTINGS.saveDesignInfo,
      report: (() => {
        const r = { ...DEFAULT_REPORT, ...(s.report ?? {}) };
        // A hand-edited or future-version choice falls back rather than being
        // handed to resolveUnitChoice, where it would silently mean `current`.
        if (!UNIT_CHOICES.includes(r.units)) r.units = DEFAULT_REPORT.units;
        return r;
      })(),
      pathExport: {
        labelWaypointsWithMission:
          typeof s.pathExport?.labelWaypointsWithMission === 'boolean'
            ? s.pathExport.labelWaypointsWithMission
            : DEFAULT_PATH_EXPORT.labelWaypointsWithMission,
      },
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
